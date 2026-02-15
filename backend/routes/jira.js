/**
 * Jira OAuth Routes
 * Handles Jira OAuth 2.0 (3LO) flow and ticket analysis
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * GET /jira/install - Initiate Jira OAuth flow
 */
router.get('/install', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.redirect('/login?error=' + encodeURIComponent('Please log in to connect Jira'));
    }

    if (!process.env.JIRA_CLIENT_ID) {
      console.error('JIRA_CLIENT_ID not configured');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Jira OAuth not configured'));
    }

    // Preserve returnTo (e.g. from onboarding) so we can redirect back after OAuth
    const returnTo = req.query.returnTo;
    if (returnTo) {
      req.session.jiraOAuthReturnTo = returnTo;
    }

    // Generate state for CSRF protection
    const state = crypto.randomBytes(16).toString('hex');
    req.session.jiraOAuthState = state;
    req.session.jiraOAuthUserId = req.session.user.id;

    // Jira OAuth 2.0 (3LO) authorization URL
    const authUrl = new URL('https://auth.atlassian.com/authorize');
    authUrl.searchParams.append('audience', 'api.atlassian.com');
    authUrl.searchParams.append('client_id', process.env.JIRA_CLIENT_ID);
    authUrl.searchParams.append('scope', 'read:jira-work read:jira-user write:jira-work manage:jira-webhook offline_access');
    authUrl.searchParams.append('redirect_uri', `${process.env.BASE_URL || 'http://localhost:3000'}/jira/callback`);
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('prompt', 'consent');

    console.log(`🔗 Redirecting to Jira OAuth: ${authUrl.toString()}`);
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Jira OAuth initiation error:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to start Jira connection'));
  }
});

/**
 * GET /jira/callback - Handle Jira OAuth callback
 */
function jiraErrorRedirect(req, errMsg) {
  const returnTo = req.session?.jiraOAuthReturnTo;
  const base = returnTo && String(returnTo).startsWith('/') ? returnTo : '/dashboard/integrations';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}error=` + encodeURIComponent(errMsg);
}

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    if (error) {
      console.error('Jira OAuth error:', error, error_description);
      return res.redirect(jiraErrorRedirect(req, error_description || error));
    }

    if (!code) {
      return res.redirect(jiraErrorRedirect(req, 'No authorization code received'));
    }

    // Verify state
    if (state !== req.session?.jiraOAuthState) {
      console.error('Jira OAuth: Invalid state token (session may have been lost - check cookies/incognito)');
      return res.redirect(jiraErrorRedirect(req, 'Invalid state token - try again'));
    }

    const userId = req.session.jiraOAuthUserId || req.session.user?.id;
    if (!userId) {
      return res.redirect('/login?error=' + encodeURIComponent('Session expired'));
    }

    // Exchange code for token
    const tokenResponse = await axios.post('https://auth.atlassian.com/oauth/token', {
      grant_type: 'authorization_code',
      client_id: process.env.JIRA_CLIENT_ID,
      client_secret: process.env.JIRA_CLIENT_SECRET,
      code: code,
      redirect_uri: `${process.env.BASE_URL || 'http://localhost:3000'}/jira/callback`
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const { access_token, refresh_token, expires_in } = tokenResponse.data;

    // Get accessible resources (Jira sites)
    const resourcesResponse = await axios.get('https://api.atlassian.com/oauth/token/accessible-resources', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });

    const resources = resourcesResponse.data;
    if (!resources || resources.length === 0) {
      return res.redirect(jiraErrorRedirect(req, 'No Jira sites found'));
    }

    // Use the first accessible site
    const site = resources[0];
    console.log(`✅ Jira site found: ${site.name} (${site.id})`);

    // Save to Supabase
    if (isSupabaseConfigured()) {
      const { data, error: upsertError } = await supabaseAdmin
        .from('integrations')
        .upsert({
          user_id: userId,
          provider: 'jira',
          access_token: access_token,
          refresh_token: refresh_token,
          token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
          account_id: site.id,
          account_name: site.name,
          account_avatar: site.avatarUrl,
          scopes: ['read:jira-work', 'read:jira-user', 'write:jira-work', 'manage:jira-webhook', 'offline_access']
        }, {
          onConflict: 'user_id,provider,account_id'
        })
        .select();

      if (upsertError) {
        console.error('❌ Error saving Jira integration to database:', upsertError);
        throw upsertError;
      }

      console.log(`✅ Jira integration saved to database for user ${userId}:`, data);
    }

    // Try to create webhook automatically
    const { createWebhook } = require('../utils/jiraService');
    await createWebhook(site.id, access_token);

    // Clean up session
    const returnTo = req.session.jiraOAuthReturnTo;
    delete req.session.jiraOAuthState;
    delete req.session.jiraOAuthUserId;
    delete req.session.jiraOAuthReturnTo;

    // Redirect back to onboarding if that's where we came from
    const redirectUrl = returnTo ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}connected=jira&t=${Date.now()}` : '/dashboard/integrations?connected=jira&t=' + Date.now();
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Jira OAuth callback error:', error.response?.data || error.message);
    const errMsg = error.response?.data?.error_description || error.response?.data?.error || error.message || 'Failed to connect Jira';
    res.redirect(jiraErrorRedirect(req, errMsg));
  }
});

/**
 * POST /jira/webhook - Handle Jira webhooks
 */
router.post('/webhook', async (req, res) => {
  try {
    console.log('🔔 Jira webhook received');
    
    const { processWebhookEvent } = require('../utils/jiraService');
    const result = await processWebhookEvent(req);

    if (result.success) {
      res.status(200).json({ success: true, message: result.message });
    } else {
      res.status(400).json({ success: false, error: result.error || result.message });
    }
  } catch (error) {
    console.error('❌ Jira webhook handler error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

/**
 * POST /jira/disconnect - Disconnect Jira integration
 * (Handled in dashboard routes, but keeping this for reference)
 */

module.exports = router;
