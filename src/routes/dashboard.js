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
    
    // TODO: Fetch user stats from database
    const stats = {
      analysesThisMonth: 0,
      connectedRepos: 0,
      bugsFound: 0
    };
    
    res.render('dashboard/index', { user, stats });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.render('dashboard/index', { user: req.session.user, stats: {} });
  }
});

/**
 * GET /dashboard/integrations - Integrations page
 */
router.get('/integrations', async (req, res) => {
  try {
    const user = req.session.user;
    let githubIntegration = null;
    let bitbucketIntegration = null;
    
    if (isSupabaseConfigured()) {
      // Fetch user's integrations from database
      const { data: integrations } = await supabaseAdmin
        .from('integrations')
        .select('*')
        .eq('user_id', user.id);
      
      if (integrations) {
        githubIntegration = integrations.find(i => i.provider === 'github');
        bitbucketIntegration = integrations.find(i => i.provider === 'bitbucket');
      }
    }
    
    res.render('dashboard/integrations', {
      user,
      githubIntegration,
      bitbucketIntegration,
      success: req.query.success,
      error: req.query.error
    });
  } catch (error) {
    console.error('Integrations page error:', error);
    res.render('dashboard/integrations', {
      user: req.session.user,
      githubIntegration: null,
      bitbucketIntegration: null,
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
 * GET /dashboard/history - Analysis history
 */
router.get('/history', (req, res) => {
  const user = req.session.user;
  // TODO: Fetch analysis history from database
  res.render('dashboard/history', { user, analyses: [] });
});

/**
 * GET /dashboard/settings - User settings
 */
router.get('/settings', (req, res) => {
  const user = req.session.user;
  res.render('dashboard/settings', { user });
});

module.exports = router;
