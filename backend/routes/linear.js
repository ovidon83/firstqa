/**
 * Linear OAuth Routes
 * Handles Linear OAuth 2.0 flow - Login to connect (replaces API key for Connect Linear)
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const { saveLinearInstallation } = require('../utils/linearConnectAuth');

const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';
const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

/**
 * GET /linear/authorize - Initiate Linear OAuth flow
 */
router.get('/authorize', (req, res) => {
  try {
    if (!req.session?.user) {
      return res.redirect('/login?error=' + encodeURIComponent('Please log in to connect Linear'));
    }

    if (!process.env.LINEAR_CLIENT_ID) {
      console.error('LINEAR_CLIENT_ID not configured');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Linear OAuth not configured'));
    }

    // Preserve returnTo (e.g. from onboarding)
    const returnTo = req.query.returnTo;
    if (returnTo) {
      req.session.linearOAuthReturnTo = returnTo;
    }

    const state = crypto.randomBytes(16).toString('hex');
    req.session.linearOAuthState = state;
    req.session.linearOAuthUserId = req.session.user.id;

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const authUrl = new URL(LINEAR_AUTH_URL);
    authUrl.searchParams.append('client_id', process.env.LINEAR_CLIENT_ID);
    authUrl.searchParams.append('redirect_uri', `${baseUrl}/linear/callback`);
    authUrl.searchParams.append('response_type', 'code');
    authUrl.searchParams.append('scope', 'read,write,issues:create,comments:create');
    authUrl.searchParams.append('state', state);
    authUrl.searchParams.append('prompt', 'consent');

    console.log('🔗 Redirecting to Linear OAuth');
    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('Linear OAuth initiation error:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to start Linear connection'));
  }
});

function linearErrorRedirect(req, errMsg) {
  const returnTo = req.session?.linearOAuthReturnTo;
  const base = returnTo && String(returnTo).startsWith('/') ? returnTo : '/dashboard/integrations';
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}error=` + encodeURIComponent(errMsg);
}

/**
 * GET /linear/callback - Handle Linear OAuth callback
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error('Linear OAuth error:', oauthError, error_description);
      return res.redirect(linearErrorRedirect(req, error_description || oauthError));
    }

    if (!code) {
      return res.redirect(linearErrorRedirect(req, 'No authorization code received'));
    }

    if (state !== req.session?.linearOAuthState) {
      console.error('Linear OAuth: Invalid state token');
      return res.redirect(linearErrorRedirect(req, 'Invalid state token - try again'));
    }

    const userId = req.session.linearOAuthUserId || req.session.user?.id;
    if (!userId) {
      return res.redirect('/login?error=' + encodeURIComponent('Session expired'));
    }

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

    // Exchange code for token
    const tokenResponse = await axios.post(
      LINEAR_TOKEN_URL,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: `${baseUrl}/linear/callback`,
        client_id: process.env.LINEAR_CLIENT_ID,
        client_secret: process.env.LINEAR_CLIENT_SECRET
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const { access_token } = tokenResponse.data;

    // Get organization info via GraphQL
    const orgResponse = await axios.post(
      LINEAR_GRAPHQL_URL,
      {
        query: `query { organization { id name urlKey } viewer { id name email } }`
      },
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const org = orgResponse.data?.data?.organization;
    if (!org || !org.id) {
      console.error('Linear: Could not fetch organization');
      return res.redirect(linearErrorRedirect(req, 'Could not fetch Linear organization'));
    }

    // Save to linear_connect_installations (OAuth token as api_key)
    // Use the app-level webhook secret from env so users don't need to enter it manually
    await saveLinearInstallation({
      apiKey: access_token,
      organizationId: org.id,
      organizationName: org.name || org.urlKey,
      teamId: null,
      webhookSecret: process.env.LINEAR_WEBHOOK_SECRET || null
    });

    // Save to integrations for dashboard display
    if (isSupabaseConfigured()) {
      await supabaseAdmin.from('integrations').upsert({
        user_id: userId,
        provider: 'linear',
        access_token: access_token,
        account_id: org.id,
        account_name: org.name || org.urlKey,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,provider,account_id'
      });
    }

    const returnTo = req.session.linearOAuthReturnTo;
    delete req.session.linearOAuthState;
    delete req.session.linearOAuthUserId;
    delete req.session.linearOAuthReturnTo;

    const redirectUrl = returnTo
      ? `${returnTo}${returnTo.includes('?') ? '&' : '?'}connected=linear&t=${Date.now()}`
      : '/dashboard/integrations?connected=linear&t=' + Date.now();
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Linear OAuth callback error:', error.response?.data || error.message);
    const errMsg = error.response?.data?.error_description || error.response?.data?.error || error.message || 'Failed to connect Linear';
    res.redirect(linearErrorRedirect(req, errMsg));
  }
});

module.exports = router;
