/**
 * Bitbucket webhook routes for FirstQA
 * Handles incoming Bitbucket events and OAuth flow
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bitbucketService = require('../utils/bitbucketService');
const bitbucketAppAuth = require('../utils/bitbucketAppAuth');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

// Middleware to verify Bitbucket webhook signatures
const verifyBitbucketWebhook = (req, res, next) => {
  // Bitbucket doesn't sign webhooks by default (unlike GitHub)
  // If a secret is configured in both Bitbucket and here, we verify it
  // Otherwise, we allow the webhook through (Bitbucket's security is via IP/URL)
  
  const webhookSecret = process.env.BITBUCKET_WEBHOOK_SECRET;
  
  // Check for Bitbucket's UUID header to verify it's from Bitbucket
  const bitbucketUuid = req.headers['x-hook-uuid'];
  const eventKey = req.headers['x-event-key'];
  
  if (!eventKey) {
    console.error('❌ Missing x-event-key header - not a valid Bitbucket webhook');
    return res.status(400).json({ error: 'Invalid webhook request' });
  }
  
  console.log(`📥 Bitbucket webhook received: ${eventKey} (hook-uuid: ${bitbucketUuid || 'none'})`);
  
  // If no secret configured, allow through (basic validation passed)
  if (!webhookSecret) {
    console.log('⚠️ No BITBUCKET_WEBHOOK_SECRET configured - allowing webhook');
    return next();
  }
  
  // Check for signature if secret is configured
  // Bitbucket uses X-Hub-Signature for signed webhooks
  const signature = req.headers['x-hub-signature'];
  
  if (!signature) {
    // No signature but secret is configured - still allow but warn
    // (User may not have configured secret in Bitbucket webhook settings)
    console.warn('⚠️ Webhook secret configured but no signature received - allowing anyway');
    return next();
  }

  // Verify signature if both secret and signature are present
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const payload = JSON.stringify(req.body);
  const computedSignature = `sha256=${hmac.update(payload).digest('hex')}`;

  if (crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
    return next();
  } else {
    console.error('❌ Invalid Bitbucket webhook signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }
};

// Bitbucket webhook handler
router.post('/webhook', express.json({ limit: '10mb' }), verifyBitbucketWebhook, async (req, res) => {
  try {
    const eventType = req.headers['x-event-key'] || req.body?.event || 'unknown';
    console.log(`Received Bitbucket ${eventType} webhook`);

    // Create an event object with headers and body
    const event = {
      headers: req.headers,
      body: req.body
    };

    // Process the event asynchronously
    // We don't await here to respond to Bitbucket quickly
    bitbucketService.processWebhookEvent(event).catch(err => {
      console.error('Error processing Bitbucket webhook event:', err);
    });

    // Return success to Bitbucket
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    console.error('Error handling Bitbucket webhook:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// OAuth installation endpoint - redirects to Bitbucket authorization
router.get('/install', (req, res) => {
  try {
    // Check if credentials are configured
    if (!process.env.BITBUCKET_CLIENT_ID) {
      console.error('BITBUCKET_CLIENT_ID not configured in environment');
      return res.status(500).json({ 
        error: 'Bitbucket OAuth not configured',
        message: 'BITBUCKET_CLIENT_ID is missing from environment variables'
      });
    }

    const state = crypto.randomBytes(16).toString('hex');
    
    // Try to store state in session if available
    if (req.session) {
      req.session.bitbucketOAuthState = state;
    }
    
    const authUrl = bitbucketAppAuth.getAuthorizationUrl(state);
    console.log(`🔗 Redirecting to Bitbucket OAuth: ${authUrl.substring(0, 100)}...`);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating authorization URL:', error);
    console.error('Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate authorization URL',
      message: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// OAuth callback endpoint
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('Bitbucket OAuth error:', error);
      return res.redirect('/?error=bitbucket_oauth_failed');
    }

    if (!code) {
      return res.redirect('/?error=bitbucket_no_code');
    }

    // Exchange code for token
    const tokenData = await bitbucketAppAuth.exchangeCodeForToken(code);
    
    // Get user info
    const user = await bitbucketAppAuth.getCurrentUser(tokenData.access_token);
    
    if (!user) {
      return res.redirect('/?error=bitbucket_user_fetch_failed');
    }

    // Fetch user's workspaces to save installations for all of them
    let workspaces = [];
    try {
      const axios = require('axios');
      const workspacesResponse = await axios.get('https://api.bitbucket.org/2.0/workspaces', {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
      });
      workspaces = workspacesResponse.data.values || [];
      console.log(`📋 Found ${workspaces.length} workspaces for user ${user.username}`);
    } catch (wsError) {
      console.error('Error fetching workspaces:', wsError.message);
      // Fall back to using username as workspace
      workspaces = [{ slug: user.username, name: user.display_name, uuid: user.uuid }];
    }

    // Save installation for each workspace and setup webhooks automatically
    let totalWebhooksCreated = 0;
    
    for (const workspace of workspaces) {
      const installation = {
        workspace: workspace.slug,
        workspaceUuid: workspace.uuid,
        workspaceName: workspace.name,
        username: user.username,
        displayName: user.display_name,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null,
        installedAt: new Date().toISOString(),
        scopes: tokenData.scopes || []
      };

      bitbucketAppAuth.saveInstallation(installation);
      console.log(`✅ Bitbucket OAuth installation saved for workspace: ${workspace.slug}`);
      
      // If user is logged in, also save to Supabase
      if (req.session?.user && isSupabaseConfigured()) {
        try {
          await supabaseAdmin
            .from('integrations')
            .upsert({
              user_id: req.session.user.id,
              provider: 'bitbucket',
              access_token: tokenData.access_token,
              refresh_token: tokenData.refresh_token,
              token_expires_at: installation.expiresAt ? new Date(installation.expiresAt).toISOString() : null,
              account_id: workspace.uuid,
              account_name: workspace.slug,
              scopes: tokenData.scopes || []
            }, {
              onConflict: 'user_id,provider,account_id'
            });
          console.log(`✅ Bitbucket integration saved to database for user ${req.session.user.email}`);
        } catch (dbError) {
          console.error('Error saving Bitbucket integration to database:', dbError.message);
          // Don't fail the whole flow if DB save fails
        }
      }
      
      // Automatically setup webhooks for all repositories in this workspace
      try {
        const webhookResults = await bitbucketAppAuth.setupWebhooksForWorkspace(
          workspace.slug, 
          tokenData.access_token
        );
        const created = webhookResults.filter(r => r.success && !r.alreadyExists).length;
        totalWebhooksCreated += created;
      } catch (webhookError) {
        console.error(`⚠️ Error setting up webhooks for ${workspace.slug}:`, webhookError.message);
        // Continue with other workspaces even if one fails
      }
    }

    console.log(`✅ Bitbucket OAuth completed for user: ${user.username}`);
    console.log(`📊 Summary: ${workspaces.length} workspace(s), ${totalWebhooksCreated} webhook(s) created`);

    // Redirect to success page or dashboard
    // Redirect based on whether user is logged in
    if (req.session?.user) {
      res.redirect('/dashboard/integrations?success=' + encodeURIComponent('Bitbucket connected successfully'));
    } else {
      res.redirect('/?success=bitbucket_installed');
    }
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    if (req.session?.user) {
      res.redirect('/dashboard/integrations?error=' + encodeURIComponent('Failed to connect Bitbucket'));
    } else {
      res.redirect('/?error=bitbucket_oauth_error');
    }
  }
});

// Check installation status
router.get('/status', (req, res) => {
  try {
    const workspace = req.query.workspace;
    
    if (workspace) {
      const installation = bitbucketAppAuth.getInstallation(workspace);
      return res.json({
        installed: !!installation,
        installation: installation ? {
          workspace: installation.workspace,
          username: installation.username,
          installedAt: installation.installedAt
        } : null
      });
    }

    // Return all installations (for admin)
    const installations = bitbucketAppAuth.loadInstallations();
    res.json({
      installed: installations.length > 0,
      count: installations.length,
      installations: installations.map(inst => ({
        workspace: inst.workspace,
        username: inst.username,
        installedAt: inst.installedAt
      }))
    });
  } catch (error) {
    console.error('Error checking installation status:', error);
    res.status(500).json({ error: 'Failed to check installation status' });
  }
});

// Uninstall endpoint
router.post('/uninstall', (req, res) => {
  try {
    const { workspace } = req.body;
    
    if (!workspace) {
      return res.status(400).json({ error: 'Workspace required' });
    }

    bitbucketAppAuth.removeInstallation(workspace);
    console.log(`✅ Bitbucket installation removed for workspace: ${workspace}`);
    
    res.json({ success: true, message: 'Installation removed' });
  } catch (error) {
    console.error('Error uninstalling:', error);
    res.status(500).json({ error: 'Failed to uninstall' });
  }
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok',
    service: 'bitbucket',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;

