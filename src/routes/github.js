/**
 * GitHub webhook routes for FirstQA
 * Handles incoming GitHub events
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
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

  if (!signature || !webhookSecret) {
    console.error('Missing signature or webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Verify the signature
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const payload = JSON.stringify(req.body);
  const computedSignature = `sha256=${hmac.update(payload).digest('hex')}`;

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
    return next();
  } else {
    console.error('Invalid signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// GitHub webhook handler
router.post('/webhook', express.json({ limit: '10mb' }), verifyGitHubWebhook, async (req, res) => {
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
 * GET /github/install-redirect - Redirect to GitHub App install with state
 */
router.get('/install-redirect', (req, res) => {
  if (!req.session?.user) {
    return res.redirect('/login');
  }
  
  // Generate state token and store user ID
  const state = crypto.randomBytes(16).toString('hex');
  req.session.githubInstallState = state;
  req.session.githubInstallUserId = req.session.user.id;
  
  // Redirect to GitHub App install page with state
  const installUrl = `https://github.com/apps/oviai-by-firstqa/installations/new?state=${state}`;
  res.redirect(installUrl);
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
        await supabaseAdmin
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
          });
        
        console.log(`✅ GitHub installation saved to database for user ${userId}`);
        
        // Clean up session state
        delete req.session.githubInstallState;
        delete req.session.githubInstallUserId;
        
        return res.redirect('/dashboard/integrations?success=' + encodeURIComponent('GitHub connected successfully'));
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

module.exports = router; 