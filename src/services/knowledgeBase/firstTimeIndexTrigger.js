/**
 * First-time product knowledge index trigger
 * Shared logic for triggering codebase analysis when a repo has no knowledge yet.
 * Used by GitHub, Bitbucket, Linear, and Jira analysis flows.
 */

const { supabaseAdmin, isSupabaseConfigured } = require('../../lib/supabase');

const INDEX_CAP = parseInt(process.env.FIRST_TIME_INDEX_REPO_CAP || '5', 10);

/** Extract owner/repo from GitHub PR URL */
const GITHUB_PR_URL_RE = /github\.com\/([^\/]+\/[^\/]+)\/(?:pull|pulls)\/\d+/i;

function extractRepoFromGitHubUrl(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(GITHUB_PR_URL_RE);
  return m ? m[1] : null;
}

/**
 * Extract repo(s) from ticket content - description, comments, attachment URLs
 */
function extractReposFromTicketContent(description = '', comments = [], attachmentUrls = []) {
  const seen = new Set();
  const repos = [];
  const add = (repo) => {
    if (repo && !seen.has(repo)) {
      seen.add(repo);
      repos.push(repo);
    }
  };
  add(extractRepoFromGitHubUrl(description));
  for (const c of comments) {
    add(extractRepoFromGitHubUrl(typeof c === 'string' ? c : (c.body || c.text || '')));
  }
  for (const url of attachmentUrls) {
    add(extractRepoFromGitHubUrl(url));
  }
  return repos.filter(Boolean);
}

/**
 * Check if repo needs first-time indexing (no knowledge, no running/completed job)
 */
async function repoNeedsFirstTimeIndex(repoId) {
  if (!isSupabaseConfigured()) return false;
  const { count: pkCount } = await supabaseAdmin
    .from('product_knowledge')
    .select('*', { count: 'exact', head: true })
    .eq('repo_id', repoId)
    .limit(1);
  if ((pkCount || 0) > 0) return false;
  const { data: lastJob } = await supabaseAdmin
    .from('knowledge_sync_jobs')
    .select('id, status')
    .eq('repo_id', repoId)
    .eq('job_type', 'initial_analysis')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastJob?.status === 'running' || lastJob?.status === 'completed') return false;
  return true;
}

/**
 * Trigger first-time index for a GitHub repo
 * @param {string} repoFullName - owner/repo
 * @param {number} installationId - GitHub App installation ID
 * @param {Function} [postComment] - Optional (body) => postComment(...)
 */
function triggerGitHubFirstTimeIndex(repoFullName, installationId, postComment = null) {
  if (process.env.ENABLE_KNOWLEDGE_SYNC !== 'true' || !installationId) return;
  repoNeedsFirstTimeIndex(repoFullName).then(needs => {
    if (!needs) return;
    console.log(`📚 First analysis for ${repoFullName} - starting background codebase indexing`);
    const { analyzeRepository } = require('./codebaseAnalyzer');
    analyzeRepository(repoFullName, installationId, 'main', postComment ? { postComment } : null).catch(e => {
      console.warn('First-time index failed:', e.message);
    });
  }).catch(() => {});
}

/**
 * Trigger first-time index for a Bitbucket repo
 * Currently GitHub-only: Bitbucket codebase analyzer not implemented yet.
 */
function triggerBitbucketFirstTimeIndex(workspace, repoSlug) {
  if (process.env.ENABLE_KNOWLEDGE_SYNC !== 'true') return;
  const repoId = `${workspace}/${repoSlug}`;
  repoNeedsFirstTimeIndex(repoId).then(needs => {
    if (!needs) return;
    console.log(`📚 Bitbucket repo ${repoId} has no knowledge - Bitbucket codebase analyzer not yet implemented`);
    // TODO: Implement Bitbucket codebase analyzer
  }).catch(() => {});
}

/**
 * Check if user has ANY repo with product knowledge
 */
async function userHasAnyProductKnowledge(userId) {
  if (!isSupabaseConfigured()) return true; // Assume yes to skip indexing
  const { data: githubIntegrations } = await supabaseAdmin
    .from('integrations')
    .select('account_id')
    .eq('user_id', userId)
    .eq('provider', 'github');
  if (!githubIntegrations?.length) return false;
  const { getOctokit } = require('../githubChecksService');
  for (const int of githubIntegrations) {
    const installationId = parseInt(int.account_id, 10);
    try {
      const octokit = await getOctokit(installationId);
      if (!octokit) continue;
      const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 });
      const repoList = data?.repositories || [];
      for (const repo of repoList) {
        const { count } = await supabaseAdmin
          .from('product_knowledge')
          .select('*', { count: 'exact', head: true })
          .eq('repo_id', repo.full_name)
          .limit(1);
        if ((count || 0) > 0) return true;
      }
    } catch (e) {
      console.warn('Could not check knowledge for installation:', e.message);
    }
  }
  return false;
}

/**
 * Index all user repos that need it (cap at INDEX_CAP). prioritizedRepos first.
 * Calls onAllComplete when done. Runs sequentially.
 */
async function indexAllUserRepos(userId, { prioritizedRepos = [], onAllComplete = null }) {
  if (process.env.ENABLE_KNOWLEDGE_SYNC !== 'true' || !isSupabaseConfigured()) {
    if (onAllComplete) onAllComplete();
    return;
  }
  try {
    const { data: githubIntegrations } = await supabaseAdmin
      .from('integrations')
      .select('account_id')
      .eq('user_id', userId)
      .eq('provider', 'github');
    if (!githubIntegrations?.length) {
      if (onAllComplete) onAllComplete();
      return;
    }
    const { getOctokit } = require('../githubChecksService');
    const { analyzeRepository } = require('./codebaseAnalyzer');

    const toIndex = [];

    for (const int of githubIntegrations) {
      const installationId = parseInt(int.account_id, 10);
      try {
        const octokit = await getOctokit(installationId);
        if (!octokit) continue;
        const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 });
        const repoList = data?.repositories || [];
        for (const repo of repoList) {
          const repoFullName = repo.full_name;
          if (await repoNeedsFirstTimeIndex(repoFullName)) {
            toIndex.push({ repoFullName, defaultBranch: repo.default_branch || 'main', installationId });
          }
        }
      } catch (e) {
        console.warn('Could not list repos for installation:', e.message);
      }
    }

    const ordered = [];
    for (const repo of prioritizedRepos) {
      const entry = toIndex.find(t => t.repoFullName === repo);
      if (entry) {
        ordered.push(entry);
        toIndex.splice(toIndex.indexOf(entry), 1);
      }
    }
    ordered.push(...toIndex);
    const capped = ordered.slice(0, INDEX_CAP);

    for (const { repoFullName, defaultBranch, installationId } of capped) {
      console.log(`📚 Indexing ${repoFullName} (first-time ticket analysis)`);
      await analyzeRepository(repoFullName, installationId, defaultBranch).catch(e =>
        console.warn(`Index failed for ${repoFullName}:`, e.message)
      );
    }

    if (onAllComplete) onAllComplete();
  } catch (e) {
    console.warn('indexAllUserRepos failed:', e.message);
    if (onAllComplete) onAllComplete();
  }
}

/**
 * Trigger first-time index for repos belonging to a user (from Linear/Jira ticket analysis).
 * Gets user's GitHub integrations, lists repos, triggers index for repos with no knowledge.
 * Kept for backward compatibility with fire-and-forget trigger (no onComplete).
 */
async function triggerFirstTimeIndexForUserRepos(userId) {
  indexAllUserRepos(userId, {}).catch(() => {});
}

/**
 * Get user_id from Linear organization ID (via integrations table)
 */
async function getUserIdFromLinearOrg(organizationId) {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabaseAdmin
    .from('integrations')
    .select('user_id')
    .eq('provider', 'linear')
    .eq('account_id', organizationId)
    .limit(1)
    .maybeSingle();
  return data?.user_id || null;
}

/**
 * Get user_id from Jira Connect installation (via installation metadata or integrations)
 * Jira Connect may not have user linkage - returns null if not found.
 */
async function getUserIdFromJiraInstallation(installationId) {
  if (!isSupabaseConfigured()) return null;
  // Jira Connect installations may link to user via a different path - check if we have it
  const { data } = await supabaseAdmin
    .from('integrations')
    .select('user_id')
    .eq('provider', 'jira')
    .limit(1)
    .maybeSingle();
  return data?.user_id || null;
}

module.exports = {
  repoNeedsFirstTimeIndex,
  triggerGitHubFirstTimeIndex,
  triggerBitbucketFirstTimeIndex,
  triggerFirstTimeIndexForUserRepos,
  indexAllUserRepos,
  userHasAnyProductKnowledge,
  extractReposFromTicketContent,
  extractRepoFromGitHubUrl,
  getUserIdFromLinearOrg,
  getUserIdFromJiraInstallation
};
