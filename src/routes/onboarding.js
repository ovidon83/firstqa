/**
 * Onboarding Routes
 * End-to-end flow: workspace -> trial -> tools -> indexing -> first review
 * Human QA narrative: hire -> sign contract -> first day access -> setup -> first review
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const { getOctokit } = require('../services/githubChecksService');
const {
  indexAllUserRepos,
  userHasAnyProductKnowledge,
  triggerFirstTimeIndexForUserRepos
} = require('../services/knowledgeBase/firstTimeIndexTrigger');

const STEPS = [
  { id: 1, slug: 'workspace', title: 'Set up your workspace' },
  { id: 2, slug: 'trial', title: 'Start your trial' },
  { id: 3, slug: 'tools', title: 'Give Ovi access' },
  { id: 4, slug: 'indexing', title: 'Ovi is learning' },
  { id: 5, slug: 'first-review', title: "Ovi's first review" },
  { id: 6, slug: 'done', title: 'All set' }
];

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

router.use(requireAuth);

async function getOnboardingState(userId) {
  if (!isSupabaseConfigured()) {
    return { step: 1, companyName: '', teamSize: null, trialStartedAt: null };
  }
  try {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('company_name, team_size, onboarding_step, onboarding_completed_at, trial_started_at, trial_ends_at')
      .eq('id', userId)
      .single();
    if (error) return { step: 1, companyName: '', teamSize: null, trialStartedAt: null };
    return {
      step: data?.onboarding_step ?? 1,
      companyName: data?.company_name ?? '',
      teamSize: data?.team_size ?? null,
      trialStartedAt: data?.trial_started_at ?? null,
      trialEndsAt: data?.trial_ends_at ?? null,
      completedAt: data?.onboarding_completed_at ?? null
    };
  } catch (e) {
    return { step: 1, companyName: '', teamSize: null, trialStartedAt: null };
  }
}

async function updateOnboardingState(userId, updates) {
  if (!isSupabaseConfigured()) return;
  try {
    await supabaseAdmin
      .from('users')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', userId);
  } catch (e) {
    console.warn('Onboarding update failed (migration may not be run):', e.message);
  }
}

function renderStep(req, res, view, locals = {}) {
  const user = req.session.user;
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.render(view, {
    user,
    steps: STEPS,
    baseUrl,
    ...locals
  });
}

// Redirect to current step
router.get('/', async (req, res) => {
  const state = await getOnboardingState(req.session.user.id);
  if (state.completedAt || state.step >= 6) {
    return res.redirect('/dashboard');
  }
  const stepSlug = STEPS.find(s => s.id === state.step)?.slug || 'workspace';
  res.redirect(`/onboarding/${stepSlug}`);
});

// Step 1: Workspace
router.get('/workspace', async (req, res) => {
  const state = await getOnboardingState(req.session.user.id);
  if (state.completedAt) return res.redirect('/dashboard');
  renderStep(req, res, 'onboarding/workspace', {
    step: 1,
    companyName: state.companyName,
    teamSize: state.teamSize,
    progress: 1
  });
});

router.post('/workspace', async (req, res) => {
  const { company_name, team_size } = req.body;
  if (!company_name?.trim()) {
    return res.redirect('/onboarding/workspace?error=' + encodeURIComponent('Company name is required'));
  }
  const validSizes = ['1-5', '6-20', '21-50', '50+'];
  if (!validSizes.includes(team_size)) {
    return res.redirect('/onboarding/workspace?error=' + encodeURIComponent('Please select team size'));
  }
  await updateOnboardingState(req.session.user.id, {
    company_name: (company_name || '').trim(),
    team_size,
    onboarding_step: 2
  });
  res.redirect('/onboarding/trial');
});

// Step 2: Trial
router.get('/trial', async (req, res) => {
  const state = await getOnboardingState(req.session.user.id);
  if (state.completedAt) return res.redirect('/dashboard');
  if (state.step < 2) return res.redirect('/onboarding/workspace');
  renderStep(req, res, 'onboarding/trial', {
    step: 2,
    progress: 2
  });
});

router.post('/trial', async (req, res) => {
  const now = new Date();
  const trialEnds = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  await updateOnboardingState(req.session.user.id, {
    trial_started_at: now.toISOString(),
    trial_ends_at: trialEnds.toISOString(),
    analyses_limit: 10,
    onboarding_step: 3
  });
  res.redirect('/onboarding/tools');
});

router.get('/trial/skip', async (req, res) => {
  await updateOnboardingState(req.session.user.id, { onboarding_step: 3 });
  res.redirect('/onboarding/tools');
});

// Step 3: Tools
router.get('/tools', async (req, res) => {
  const state = await getOnboardingState(req.session.user.id);
  if (state.completedAt) return res.redirect('/dashboard');
  if (state.step < 3) return res.redirect('/onboarding/trial');

  let integrations = { github: [], bitbucket: null, jira: null, linear: null };
  if (isSupabaseConfigured()) {
    const { data } = await supabaseAdmin
      .from('integrations')
      .select('provider, account_id, account_name')
      .eq('user_id', req.session.user.id);
    if (data) {
      integrations.github = data.filter(i => i.provider === 'github');
      integrations.bitbucket = data.find(i => i.provider === 'bitbucket');
      integrations.jira = data.find(i => i.provider === 'jira');
      integrations.linear = data.find(i => i.provider === 'linear');
    }
  }

  const hasCodeRepo = integrations.github.length > 0 || !!integrations.bitbucket;

  renderStep(req, res, 'onboarding/tools', {
    step: 3,
    progress: 3,
    integrations,
    hasCodeRepo,
    connected: req.query.connected
  });
});

router.post('/tools/continue', async (req, res) => {
  let hasCodeRepo = false;
  if (isSupabaseConfigured()) {
    const { data } = await supabaseAdmin
      .from('integrations')
      .select('provider')
      .eq('user_id', req.session.user.id);
    hasCodeRepo = data?.some(i => i.provider === 'github' || i.provider === 'bitbucket') ?? false;
  }
  if (!hasCodeRepo) {
    return res.redirect('/onboarding/tools?error=' + encodeURIComponent('Connect at least one code repository to continue'));
  }
  await updateOnboardingState(req.session.user.id, { onboarding_step: 4 });
  res.redirect('/onboarding/indexing');
});

// Step 4: Indexing
router.get('/indexing', async (req, res) => {
  const state = await getOnboardingState(req.session.user.id);
  if (state.completedAt) return res.redirect('/dashboard');
  if (state.step < 4) return res.redirect('/onboarding/tools');

  let jobId = null;
  let hasKnowledge = false;
  let repoStatus = [];

  if (isSupabaseConfigured()) {
    hasKnowledge = await userHasAnyProductKnowledge(req.session.user.id);

    const { data: githubInts } = await supabaseAdmin
      .from('integrations')
      .select('account_id')
      .eq('user_id', req.session.user.id)
      .eq('provider', 'github');

    if (githubInts?.length) {
      const { getOctokit } = require('../services/githubChecksService');
      for (const int of githubInts) {
        try {
          const octokit = await getOctokit(parseInt(int.account_id, 10));
          if (!octokit) continue;
          const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 5 });
          for (const repo of data?.repositories || []) {
            const repoId = repo.full_name;
            const { count } = await supabaseAdmin
              .from('product_knowledge')
              .select('*', { count: 'exact', head: true })
              .eq('repo_id', repoId)
              .limit(1);
            const { data: job } = await supabaseAdmin
              .from('knowledge_sync_jobs')
              .select('id, status, progress')
              .eq('repo_id', repoId)
              .eq('job_type', 'initial_analysis')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            repoStatus.push({
              repoId,
              hasKnowledge: (count || 0) > 0,
              jobId: job?.id,
              status: job?.status,
              progress: job?.progress ?? 0
            });
            if (job?.id && job?.status === 'running') jobId = job.id;
          }
          break;
        } catch (e) {
          console.warn('Indexing status check failed:', e.message);
        }
      }
    }
  }

  const allIndexed = repoStatus.length > 0 && repoStatus.every(r => r.hasKnowledge);
  const anyRunning = repoStatus.some(r => r.status === 'running');

  renderStep(req, res, 'onboarding/indexing', {
    step: 4,
    progress: 4,
    hasKnowledge,
    repoStatus,
    jobId,
    allIndexed,
    anyRunning
  });
});

router.post('/indexing/start', async (req, res) => {
  const userId = req.session.user.id;
  const hasKnowledge = await userHasAnyProductKnowledge(userId);
  if (!hasKnowledge && process.env.ENABLE_KNOWLEDGE_SYNC === 'true') {
    triggerFirstTimeIndexForUserRepos(userId).catch(e => console.warn('Index trigger failed:', e.message));
  }
  res.redirect('/onboarding/indexing');
});

router.get('/api/indexing-status', async (req, res) => {
  const userId = req.session.user.id;
  let repoStatus = [];

  if (isSupabaseConfigured()) {
    const { data: githubInts } = await supabaseAdmin
      .from('integrations')
      .select('account_id')
      .eq('user_id', userId)
      .eq('provider', 'github');

    if (githubInts?.length) {
      for (const int of githubInts) {
        try {
          const octokit = await getOctokit(parseInt(int.account_id, 10));
          if (!octokit) continue;
          const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 10 });
          for (const repo of data?.repositories || []) {
            const repoId = repo.full_name;
            const { count } = await supabaseAdmin
              .from('product_knowledge')
              .select('*', { count: 'exact', head: true })
              .eq('repo_id', repoId)
              .limit(1);
            const { data: job } = await supabaseAdmin
              .from('knowledge_sync_jobs')
              .select('id, status, progress')
              .eq('repo_id', repoId)
              .eq('job_type', 'initial_analysis')
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            repoStatus.push({
              repoId,
              hasKnowledge: (count || 0) > 0,
              status: job?.status,
              progress: job?.progress ?? 0
            });
          }
          break;
        } catch (e) {
          console.warn('Status check failed:', e.message);
        }
      }
    }
  }

  const allIndexed = repoStatus.length > 0 && repoStatus.every(r => r.hasKnowledge);
  const anyRunning = repoStatus.some(r => r.status === 'running');

  res.json({ repoStatus, allIndexed, anyRunning });
});

router.post('/indexing/continue', async (req, res) => {
  await updateOnboardingState(req.session.user.id, { onboarding_step: 5 });
  res.redirect('/onboarding/first-review');
});

// Step 5: First review
router.get('/first-review', async (req, res) => {
  const state = await getOnboardingState(req.session.user.id);
  if (state.completedAt) return res.redirect('/dashboard');
  if (state.step < 5) return res.redirect('/onboarding/indexing');

  let prs = [];
  if (isSupabaseConfigured()) {
    const { data: githubInts } = await supabaseAdmin
      .from('integrations')
      .select('account_id')
      .eq('user_id', req.session.user.id)
      .eq('provider', 'github');

    if (githubInts?.length) {
      try {
        const octokit = await getOctokit(parseInt(githubInts[0].account_id, 10));
        if (octokit) {
          const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 5 });
          for (const repo of data?.repositories || []) {
            const [owner, repoName] = repo.full_name.split('/');
            try {
              const { data: prData } = await octokit.pulls.list({
                owner,
                repo: repoName,
                state: 'open',
                per_page: 3,
                sort: 'updated'
              });
              for (const pr of prData || []) {
                prs.push({
                  repo: repo.full_name,
                  number: pr.number,
                  title: pr.title,
                  branch: pr.head?.ref || '',
                  additions: pr.additions ?? 0,
                  deletions: pr.deletions ?? 0,
                  url: pr.html_url
                });
              }
            } catch (e) {
              console.warn(`Could not list PRs for ${repo.full_name}:`, e.message);
            }
          }
        }
      } catch (e) {
        console.warn('First review PR fetch failed:', e.message);
      }
    }
  }

  renderStep(req, res, 'onboarding/first-review', {
    step: 5,
    progress: 5,
    prs
  });
});

router.post('/first-review/complete', async (req, res) => {
  const now = new Date().toISOString();
  await updateOnboardingState(req.session.user.id, {
    onboarding_step: 6,
    onboarding_completed_at: now
  });
  res.redirect('/dashboard?onboarding=complete');
});

module.exports = router;
