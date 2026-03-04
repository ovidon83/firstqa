/**
 * GitHub webhook routes for FirstQA
 * Handles incoming GitHub events
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const axios = require('axios');
const githubService = require('../utils/githubService');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const { Octokit } = require('@octokit/rest');
const githubAppAuth = require('../utils/githubAppAuth');

// Middleware to verify GitHub webhook signatures
const verifyGitHubWebhook = (req, res, next) => {
  // Skip verification in development mode if explicitly disabled
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_WEBHOOK_VERIFICATION === 'true') {
    return next();
  }

  const signature = req.headers['x-hub-signature-256'];
  const webhookSecret = process.env.WEBHOOK_SECRET;

  console.log('🔐 Webhook signature verification:');
  console.log('  Has signature:', !!signature);
  console.log('  Has secret:', !!webhookSecret);
  console.log('  Has rawBody:', !!req.rawBody);
  console.log('  rawBody type:', req.rawBody ? (Buffer.isBuffer(req.rawBody) ? 'Buffer' : typeof req.rawBody) : 'undefined');
  console.log('  rawBody length:', req.rawBody?.length || 0);

  if (!signature || !webhookSecret) {
    console.error('❌ Missing signature or webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // CRITICAL: We MUST use the raw body bytes (Buffer), not the parsed JSON
  // GitHub computes signature on raw bytes before parsing
  if (!req.rawBody) {
    console.error('❌ req.rawBody is undefined!');
    return res.status(401).json({ error: 'Unauthorized - no raw body' });
  }
  
  // Verify the signature using raw body Buffer
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const computedSignature = `sha256=${hmac.update(req.rawBody).digest('hex')}`;

  console.log('  Expected:', signature.substring(0, 20) + '...');
  console.log('  Computed:', computedSignature.substring(0, 20) + '...');
  console.log('  Match:', signature === computedSignature);

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
    console.log('✅ Signature verified');
    return next();
  } else {
    console.error('❌ Invalid webhook signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// GitHub webhook handler
// NOTE: Don't use express.json() here - it's already parsed by webhook-server.js
// and we need req.rawBody for signature verification
router.post('/webhook', verifyGitHubWebhook, async (req, res) => {
  try {
    const eventType = req.headers['x-github-event'];
    console.log(`Received ${eventType} webhook`);

    // Create an event object with headers and body that matches processWebhookEvent expectations
    const event = {
      headers: req.headers,
      body: req.body
    };

    // Process the event asynchronously
    // We don't await here to respond to GitHub quickly
    githubService.processWebhookEvent(event).catch(err => {
      console.error('Error processing webhook event:', err);
    });

    // Return success to GitHub
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * GET /github/identify - Lightweight GitHub OAuth to capture the user's GitHub username.
 * Used when githubLogin is not in the session (email/password signups).
 * After identifying, redirects back to /github/install-redirect.
 */
router.get('/identify', (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    console.error('GITHUB_CLIENT_ID not configured');
    return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('GitHub OAuth not configured'));
  }

  const state = crypto.randomBytes(16).toString('hex');
  req.session.githubIdentifyState = state;
  if (req.query.returnTo) {
    req.session.githubIdentifyReturnTo = req.query.returnTo;
  }

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const authUrl = new URL('https://github.com/login/oauth/authorize');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', `${baseUrl}/github/identify/callback`);
  authUrl.searchParams.set('scope', 'read:user');
  authUrl.searchParams.set('state', state);

  console.log('🔗 Redirecting to GitHub OAuth to identify user');
  res.redirect(authUrl.toString());
});

/**
 * GET /github/identify/callback - Handle the identify OAuth callback.
 * Fetches the user's GitHub username, stores it in session, then redirects
 * back to /github/install-redirect so auto-detection can run.
 */
router.get('/identify/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code) {
      console.error('GitHub identify callback: no code received');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('GitHub identification failed'));
    }

    if (state !== req.session?.githubIdentifyState) {
      console.error('GitHub identify callback: invalid state token');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Invalid state token'));
    }

    const tokenResponse = await axios.post(
      'https://github.com/login/oauth/access_token',
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${process.env.BASE_URL || 'http://localhost:3000'}/github/identify/callback`
      },
      { headers: { Accept: 'application/json' } }
    );

    const accessToken = tokenResponse.data?.access_token;
    if (!accessToken) {
      console.error('GitHub identify callback: no access token received');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('GitHub identification failed'));
    }

    const userResponse = await axios.get('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    const githubLogin = userResponse.data?.login;
    if (githubLogin && req.session.user) {
      req.session.user.githubLogin = githubLogin;
      console.log(`✅ GitHub identity captured: ${githubLogin}`);
    }

    const returnTo = req.session.githubIdentifyReturnTo;
    delete req.session.githubIdentifyState;
    delete req.session.githubIdentifyReturnTo;

    const installRedirectUrl = '/github/install-redirect' +
      (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
    res.redirect(installRedirectUrl);
  } catch (error) {
    console.error('GitHub identify callback error:', error.message);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('GitHub identification failed'));
  }
});

/**
 * GET /github/install-redirect - Redirect to GitHub App install with state
 * Also checks if app is already installed and syncs the database
 */
router.get('/install-redirect', async (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  
  try {
    const userId = req.session.user.id;
    
    // Check if user already has a GitHub installation in the database
    if (isSupabaseConfigured()) {
      const { data: existingInstallations } = await supabaseAdmin
        .from('integrations')
        .select('id')
        .eq('user_id', userId)
        .eq('provider', 'github')
        .limit(1);
      const existingInstallation = existingInstallations?.[0];
      
      if (existingInstallation) {
        console.log(`✅ User already has GitHub installation in database: ${existingInstallation.account_id}`);
        const returnTo = req.query.returnTo;
        const dest = returnTo ? returnTo + (returnTo.includes('?') ? '&' : '?') + 'info=' + encodeURIComponent('GitHub is already connected') : '/dashboard/integrations?info=' + encodeURIComponent('GitHub is already connected');
        return res.redirect(dest);
      }
    }
    
    // Check if the user already has the GitHub App installed but we don't have it in our DB
    // (e.g., Setup URL wasn't configured when they first installed, so callback never fired)
    const userGitHubLogin = req.session.user.githubLogin;
    console.log(`🔍 [INSTALL-REDIRECT] GitHub login from session: ${userGitHubLogin || 'not available'}`);
    
    if (userGitHubLogin) {
      const jwt = githubAppAuth.getGitHubAppJWT();
      if (jwt) {
        try {
          const appOctokit = new Octokit({ auth: jwt });
          const { data: installations } = await appOctokit.apps.listInstallations();
          
          // Find installation matching this user's GitHub account ONLY
          const matchingInstallation = installations.find(
            inst => inst.account.login.toLowerCase() === userGitHubLogin.toLowerCase()
          );
          
          if (matchingInstallation) {
            console.log(`🔍 Found existing GitHub App installation for ${userGitHubLogin} (ID: ${matchingInstallation.id}), saving to database`);
            
            const { error: saveError } = await supabaseAdmin
              .from('integrations')
              .upsert({
                user_id: userId,
                provider: 'github',
                access_token: '',
                account_id: matchingInstallation.id.toString(),
                account_name: matchingInstallation.account.login,
                account_avatar: matchingInstallation.account.avatar_url,
                scopes: matchingInstallation.permissions ? Object.keys(matchingInstallation.permissions) : []
              }, {
                onConflict: 'user_id,provider,account_id'
              });
            
            if (!saveError) {
              console.log(`✅ Auto-saved GitHub installation for ${userGitHubLogin}`);
              const returnTo = req.query.returnTo;
              const dest = returnTo 
                ? returnTo + (returnTo.includes('?') ? '&' : '?') + 'connected=github&t=' + Date.now()
                : '/dashboard/integrations?connected=github&t=' + Date.now();
              return res.redirect(dest);
            } else {
              console.error('❌ Error auto-saving installation:', saveError);
            }
          }
        } catch (error) {
          console.error('Error checking GitHub installations:', error.message);
        }
      }
    } else if (process.env.GITHUB_CLIENT_ID) {
      // No githubLogin in session (email/password signup) -- identify via GitHub OAuth first
      // so we can auto-detect existing installations before sending user to GitHub's install page
      console.log('🔄 No GitHub login in session, redirecting to /github/identify first');
      const returnTo = req.query.returnTo;
      const identifyUrl = '/github/identify' +
        (returnTo ? '?returnTo=' + encodeURIComponent(returnTo) : '');
      return res.redirect(identifyUrl);
    }
    
    // Generate state token and store user ID
    const state = crypto.randomBytes(16).toString('hex');
    req.session.githubInstallState = state;
    req.session.githubInstallUserId = req.session.user.id;
    if (req.query.returnTo) req.session.githubInstallReturnTo = req.query.returnTo;
    
    // Redirect to GitHub App install page with state
    const installUrl = `https://github.com/apps/oviai-by-firstqa/installations/new?state=${state}`;
    res.redirect(installUrl);
  } catch (error) {
    console.error('Error in install-redirect:', error);
    res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to connect GitHub'));
  }
});

/**
 * GET /github/install-callback - Handle GitHub App installation callback
 */
router.get('/install-callback', async (req, res) => {
  try {
    const { installation_id, setup_action, state } = req.query;
    
    console.log('📥 GitHub App installation callback:', { installation_id, setup_action, state });
    
    // Verify state if we have it in session
    if (req.session?.githubInstallState && state !== req.session.githubInstallState) {
      console.error('Invalid state token');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Invalid state token'));
    }
    
    const userId = req.session?.githubInstallUserId || req.session?.user?.id;
    
    if (!installation_id) {
      console.error('No installation_id in callback');
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('No installation ID received'));
    }
    
    // If user is logged in, save to Supabase
    if (userId && isSupabaseConfigured()) {
      try {
        // Get installation details from GitHub
        const jwt = githubAppAuth.getGitHubAppJWT();
        if (!jwt) {
          throw new Error('Failed to generate GitHub App JWT');
        }
        
        const appOctokit = new Octokit({ auth: jwt });
        const { data: installation } = await appOctokit.apps.getInstallation({
          installation_id: parseInt(installation_id)
        });
        
        // Save to database
        const { data, error: upsertError } = await supabaseAdmin
          .from('integrations')
          .upsert({
            user_id: userId,
            provider: 'github',
            access_token: '', // We'll get this via JWT when needed
            account_id: installation_id.toString(),
            account_name: installation.account.login,
            account_avatar: installation.account.avatar_url,
            scopes: installation.permissions ? Object.keys(installation.permissions) : []
          }, {
            onConflict: 'user_id,provider,account_id'
          })
          .select();
        
        if (upsertError) {
          console.error('❌ Error saving GitHub installation to database:', upsertError);
          throw upsertError;
        }
        
        console.log(`✅ GitHub installation saved to database for user ${userId}:`, data);
        
        // Clean up session state
        const returnTo = req.session.githubInstallReturnTo;
        delete req.session.githubInstallState;
        delete req.session.githubInstallUserId;
        delete req.session.githubInstallReturnTo;
        
        // Redirect to returnTo (e.g. onboarding) or integrations
        const redirectUrl = returnTo ? returnTo + (returnTo.includes('?') ? '&' : '?') + 'connected=github&t=' + Date.now() : '/dashboard/integrations?connected=github&t=' + Date.now();
        return res.redirect(redirectUrl);
      } catch (error) {
        console.error('Error saving GitHub installation:', error.message);
        return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to save GitHub installation'));
      }
    }
    
    // If not logged in, redirect to home
    res.redirect('/?success=github_installed');
  } catch (error) {
    console.error('GitHub install callback error:', error);
    const redirectUrl = req.session?.user 
      ? '/dashboard/integrations?error=' + encodeURIComponent('Installation failed')
      : '/?error=github_install_failed';
    res.redirect(redirectUrl);
  }
});

/**
 * GET /github/sync-installations - Manually sync existing GitHub installations
 * For users who already have the app installed but not in our database
 */
router.get('/sync-installations', async (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  
  try {
    const userId = req.session.user.id;
    const jwt = githubAppAuth.getGitHubAppJWT();
    
    if (!jwt) {
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('GitHub App authentication not configured'));
    }
    
    const appOctokit = new Octokit({ auth: jwt });
    const { data: installations } = await appOctokit.apps.listInstallations();
    
    console.log(`🔍 Found ${installations.length} GitHub App installations`);
    
    if (installations.length === 0) {
      return res.redirect('/dashboard/integrations?info=' + encodeURIComponent('No GitHub App installations found. Install the app first.'));
    }
    
    let synced = 0;
    let errors = [];
    
    // Get user's GitHub username from their session/profile if available
    const userGitHubLogin = req.session.user.user_metadata?.user_name || 
                           req.session.user.user_metadata?.preferred_username;
    
    console.log(`👤 User's GitHub login: ${userGitHubLogin || 'unknown'}`);
    
    // Try to sync installations that match the user's GitHub account
    for (const installation of installations) {
      try {
        const accountLogin = installation.account.login;
        
        // Only sync if:
        // 1. It's a personal account matching the user's GitHub login, OR
        // 2. We don't know the user's GitHub login (sync all as fallback)
        const shouldSync = !userGitHubLogin || 
                          accountLogin.toLowerCase() === userGitHubLogin.toLowerCase();
        
        if (!shouldSync) {
          console.log(`⏭️  Skipping installation for ${accountLogin} (doesn't match user ${userGitHubLogin})`);
          continue;
        }
        
        // Check if already exists
        if (isSupabaseConfigured()) {
          const { data: existing } = await supabaseAdmin
            .from('integrations')
            .select('id')
            .eq('user_id', userId)
            .eq('provider', 'github')
            .eq('account_id', installation.id.toString())
            .single();
          
          if (!existing) {
            // Add this installation to the current user
            const { error } = await supabaseAdmin
              .from('integrations')
              .insert({
                user_id: userId,
                provider: 'github',
                access_token: '',
                account_id: installation.id.toString(),
                account_name: installation.account.login,
                account_avatar: installation.account.avatar_url,
                scopes: installation.permissions ? Object.keys(installation.permissions) : []
              });
            
            if (error) {
              console.error(`❌ Error syncing installation ${installation.id}:`, error.message);
              errors.push(`${installation.account.login}: ${error.message}`);
            } else {
              console.log(`✅ Synced installation: ${installation.account.login}`);
              synced++;
            }
          } else {
            console.log(`ℹ️  Installation ${accountLogin} already synced`);
          }
        }
      } catch (error) {
        console.error(`Error syncing installation ${installation.id}:`, error.message);
        errors.push(error.message);
      }
    }
    
    if (errors.length > 0) {
      return res.redirect('/dashboard/integrations?error=' + encodeURIComponent(`Failed to sync: ${errors[0]}`));
    }
    
    if (synced > 0) {
      return res.redirect('/dashboard/integrations?connected=github&t=' + Date.now());
    } else {
      return res.redirect('/dashboard/integrations?info=' + encodeURIComponent('All matching installations already synced'));
    }
  } catch (error) {
    console.error('Error syncing installations:', error);
    return res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to sync installations: ' + error.message));
  }
});

module.exports = router; 