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
    let linearIntegration = null;
    
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
        linearIntegration = integrations.find(i => i.provider === 'linear');
        
        console.log(`📊 Loaded integrations for ${user.email}: GitHub=${githubInstallations.length} installation(s), Bitbucket=${!!bitbucketIntegration}, Jira=${!!jiraIntegration}, Linear=${!!linearIntegration}`);
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
      linearIntegration,
      connected: req.query.connected, // 'github', 'jira', or 'linear' when just connected
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
      linearIntegration: null,
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
 * POST /dashboard/integrations/linear/install - Install Linear integration
 */
router.post('/integrations/linear/install', async (req, res) => {
  try {
    const user = req.session.user;
    const { apiKey } = req.body;

    if (!apiKey) {
      return res.status(400).json({ success: false, error: 'API key is required' });
    }

    if (!isSupabaseConfigured()) {
      return res.status(500).json({ success: false, error: 'Database not configured' });
    }

    // Verify API key and get organization info
    const { verifyLinearApiKey, getLinearOrganization } = require('../utils/linearConnectService');
    const orgInfo = await verifyLinearApiKey(apiKey);

    if (!orgInfo) {
      return res.status(401).json({ success: false, error: 'Invalid API key' });
    }

    // Save Linear installation
    const { saveLinearInstallation } = require('../utils/linearConnectAuth');
    const installation = await saveLinearInstallation({
      apiKey: apiKey,
      organizationId: orgInfo.id,
      organizationName: orgInfo.name
    });

    // Also save to integrations table for dashboard display
    const { data, error: integrationError } = await supabaseAdmin
      .from('integrations')
      .upsert({
        user_id: user.id,
        provider: 'linear',
        access_token: '', // API key stored in linear_connect_installations
        account_id: orgInfo.id,
        account_name: orgInfo.name,
        account_avatar: null,
        scopes: []
      }, {
        onConflict: 'user_id,provider,account_id'
      })
      .select();

    if (integrationError) {
      console.error('Error saving Linear integration:', integrationError);
      // Don't fail - installation is saved in linear_connect_installations
    }

    console.log(`✅ Linear integration installed for user ${user.email}: ${orgInfo.name}`);

    res.json({ success: true, organization: orgInfo });
  } catch (error) {
    console.error('Linear install error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to install Linear integration' 
    });
  }
});

/**
 * POST /dashboard/integrations/linear/disconnect - Disconnect Linear
 */
router.post('/integrations/linear/disconnect', async (req, res) => {
  try {
    const user = req.session.user;
    
    if (isSupabaseConfigured()) {
      // Get Linear integration to find organization ID
      const { data: integration } = await supabaseAdmin
        .from('integrations')
        .select('account_id')
        .eq('user_id', user.id)
        .eq('provider', 'linear')
        .single();

      if (integration) {
        // Delete from integrations table
        await supabaseAdmin
          .from('integrations')
          .delete()
          .eq('user_id', user.id)
          .eq('provider', 'linear');

        // Disable in linear_connect_installations
        const { deleteLinearInstallation } = require('../utils/linearConnectAuth');
        try {
          await deleteLinearInstallation(integration.account_id);
        } catch (err) {
          console.warn('Could not delete Linear installation:', err.message);
        }
      }
      
      console.log(`✅ Linear integration disconnected for user ${user.email}`);
    }
    
    res.redirect('/dashboard/integrations?success=' + encodeURIComponent('Linear disconnected'));
  } catch (error) {
    console.error('Linear disconnect error:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to disconnect Linear'));
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
