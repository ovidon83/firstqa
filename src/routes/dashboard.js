/**
 * Dashboard Routes
 * Protected routes for authenticated users
 */

const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * Middleware: Require authentication
 */
function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  next();
}

// Apply auth middleware to all dashboard routes
router.use(requireAuth);

/**
 * GET /dashboard - Dashboard home
 */
router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    
    let stats = {
      analysesThisMonth: 0,
      analysesLimit: 10,
      connectedIntegrations: 0,
      recentAnalyses: [],
      plan: 'free'
    };
    
    if (isSupabaseConfigured()) {
      // Fetch user stats
      const { data: userData } = await supabaseAdmin
        .from('users')
        .select('plan, analyses_this_month, analyses_limit')
        .eq('id', user.id)
        .single();
      
      if (userData) {
        stats.analysesThisMonth = userData.analyses_this_month || 0;
        stats.analysesLimit = userData.analyses_limit || 10;
        stats.plan = userData.plan || 'free';
      }
      
      // Count connected providers (not individual installations)
      // GitHub may have multiple installations, but we count it as 1 provider
      const { data: integrations } = await supabaseAdmin
        .from('integrations')
        .select('provider')
        .eq('user_id', user.id);
      
      if (integrations) {
        // Get unique providers
        const uniqueProviders = [...new Set(integrations.map(i => i.provider))];
        stats.connectedIntegrations = uniqueProviders.length;
      }
      
      // Fetch recent analyses (last 5)
      const { data: recentAnalyses } = await supabaseAdmin
        .from('analyses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      
      stats.recentAnalyses = recentAnalyses || [];
      
      console.log(`📊 Dashboard stats for ${user.email}:`, stats);
    }
    
    res.render('dashboard/index', { 
      user, 
      stats,
      success: req.query.success,
      error: req.query.error  
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard/index', { 
      user: req.session.user, 
      stats: {
        analysesThisMonth: 0,
        analysesLimit: 10,
        connectedIntegrations: 0,
        recentAnalyses: [],
        plan: 'free'
      },
      error: 'Failed to load dashboard data'
    });
  }
});

/**
 * GET /dashboard/integrations - Integrations page
 */
router.get('/integrations', async (req, res) => {
  try {
    const user = req.session.user;
    let githubInstallations = [];
    let bitbucketIntegration = null;
    let jiraIntegration = null;
    
    if (isSupabaseConfigured()) {
      // Fetch user's integrations from database
      const { data: integrations, error: fetchError } = await supabaseAdmin
        .from('integrations')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true }); // Oldest first
      
      if (fetchError) {
        console.error('Error fetching integrations:', fetchError);
      } else if (integrations) {
        // Group GitHub installations (each GitHub App installation is a separate record)
        githubInstallations = integrations.filter(i => i.provider === 'github');
        bitbucketIntegration = integrations.find(i => i.provider === 'bitbucket');
        jiraIntegration = integrations.find(i => i.provider === 'jira');
        
        console.log(`📊 Loaded integrations for ${user.email}: GitHub=${githubInstallations.length} installation(s), Bitbucket=${!!bitbucketIntegration}, Jira=${!!jiraIntegration}`);
      }
    }
    
    // Check for flash messages in session
    const flash = req.session.flash;
    delete req.session.flash;
    
    res.render('dashboard/integrations', {
      user,
      githubInstallations, // Array of all GitHub App installations
      bitbucketIntegration,
      jiraIntegration,
      connected: req.query.connected, // 'github' or 'jira' when just connected
      info: req.query.info, // Info messages (not errors, not success)
      success: flash?.type === 'success' ? flash.message : req.query.success,
      error: flash?.type === 'error' ? flash.message : req.query.error
    });
  } catch (error) {
    console.error('Integrations page error:', error);
    res.render('dashboard/integrations', {
      user: req.session.user,
      githubInstallations: [],
      bitbucketIntegration: null,
      jiraIntegration: null,
      success: req.query.success,
      error: req.query.error
    });
  }
});

/**
 * POST /dashboard/integrations/github/disconnect - Disconnect GitHub
 */
router.post('/integrations/github/disconnect', async (req, res) => {
  try {
    const user = req.session.user;
    
    if (isSupabaseConfigured()) {
      await supabaseAdmin
        .from('integrations')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'github');
      
      console.log(`✅ GitHub integration disconnected for user ${user.email}`);
    }
    
    res.redirect('/dashboard/integrations?success=' + encodeURIComponent('GitHub disconnected'));
  } catch (error) {
    console.error('GitHub disconnect error:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to disconnect GitHub'));
  }
});

/**
 * POST /dashboard/integrations/bitbucket/disconnect - Disconnect Bitbucket
 */
router.post('/integrations/bitbucket/disconnect', async (req, res) => {
  try {
    const user = req.session.user;
    
    if (isSupabaseConfigured()) {
      await supabaseAdmin
        .from('integrations')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'bitbucket');
      
      console.log(`✅ Bitbucket integration disconnected for user ${user.email}`);
    }
    
    res.redirect('/dashboard/integrations?success=' + encodeURIComponent('Bitbucket disconnected'));
  } catch (error) {
    console.error('Bitbucket disconnect error:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to disconnect Bitbucket'));
  }
});

/**
 * POST /dashboard/integrations/jira/disconnect - Disconnect Jira
 */
router.post('/integrations/jira/disconnect', async (req, res) => {
  try {
    const user = req.session.user;
    
    if (isSupabaseConfigured()) {
      await supabaseAdmin
        .from('integrations')
        .delete()
        .eq('user_id', user.id)
        .eq('provider', 'jira');
      
      console.log(`✅ Jira integration disconnected for user ${user.email}`);
    }
    
    res.redirect('/dashboard/integrations?success=' + encodeURIComponent('Jira disconnected'));
  } catch (error) {
    console.error('Jira disconnect error:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to disconnect Jira'));
  }
});

/**
 * GET /dashboard/history - Analysis history
 */
router.get('/history', async (req, res) => {
  try {
    const user = req.session.user;
    let analyses = [];
    
    if (isSupabaseConfigured()) {
      // Fetch analysis history from database
      const { data, error } = await supabaseAdmin
        .from('analyses')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50); // Show last 50 analyses
      
      if (error) {
        console.error('Error fetching analyses:', error);
      } else {
        analyses = data || [];
        console.log(`📊 Fetched ${analyses.length} analyses for user ${user.email}`);
      }
    }
    
    res.render('dashboard/history', { 
      user, 
      analyses,
      success: req.query.success,
      error: req.query.error
    });
  } catch (error) {
    console.error('History page error:', error);
    res.render('dashboard/history', { 
      user: req.session.user, 
      analyses: [],
      error: 'Failed to load analysis history'
    });
  }
});

/**
 * GET /dashboard/settings - User settings
 */
router.get('/settings', (req, res) => {
  const user = req.session.user;
  res.render('dashboard/settings', { user });
});

module.exports = router;
