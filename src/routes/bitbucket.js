/**
 * Bitbucket webhook routes for FirstQA
 * Handles incoming Bitbucket events and OAuth flow
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bitbucketService = require('../utils/bitbucketService');
const bitbucketAppAuth = require('../utils/bitbucketAppAuth');

// Middleware to verify Bitbucket webhook signatures
const verifyBitbucketWebhook = (req, res, next) => {
  // Skip verification in development mode if explicitly disabled
  if (process.env.NODE_ENV === 'development' && process.env.SKIP_WEBHOOK_VERIFICATION === 'true') {
    return next();
  }

  // Bitbucket webhooks use X-Hub-Signature-256 or X-Hook-Signature
  const signature = req.headers['x-hub-signature-256'] || req.headers['x-hook-signature'];
  const webhookSecret = process.env.BITBUCKET_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    console.warn('⚠️ Missing Bitbucket webhook signature or secret - allowing in dev mode');
    if (process.env.NODE_ENV === 'development') {
      return next();
    }
    console.error('Missing signature or webhook secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Bitbucket uses HMAC SHA-256
  const hmac = crypto.createHmac('sha256', webhookSecret);
  const payload = JSON.stringify(req.body);
  const computedSignature = `sha256=${hmac.update(payload).digest('hex')}`;

  // Bitbucket may send signature in different formats
  const providedSignature = signature.startsWith('sha256=') ? signature : `sha256=${signature}`;

  if (crypto.timingSafeEqual(Buffer.from(providedSignature), Buffer.from(computedSignature))) {
    return next();
  } else {
    console.error('Invalid Bitbucket webhook signature');
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
    const state = crypto.randomBytes(16).toString('hex');
    // Store state in session or pass as query param
    req.session = req.session || {};
    req.session.bitbucketOAuthState = state;
    
    const authUrl = bitbucketAppAuth.getAuthorizationUrl(state);
    res.redirect(authUrl);
  } catch (error) {
    console.error('Error generating authorization URL:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
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
    
    // Get user info to determine workspace
    const user = await bitbucketAppAuth.getCurrentUser(tokenData.access_token);
    
    if (!user) {
      return res.redirect('/?error=bitbucket_user_fetch_failed');
    }

    // Get workspace info - Bitbucket user might have a workspace
    // For now, we'll use the username as workspace identifier
    // In production, you might want to let users select workspace
    const workspaceSlug = user.username;

    // Save installation
    const installation = {
      workspace: workspaceSlug,
      workspaceUuid: user.uuid,
      username: user.username,
      displayName: user.display_name,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null,
      installedAt: new Date().toISOString(),
      scopes: tokenData.scopes || []
    };

    bitbucketAppAuth.saveInstallation(installation);

    console.log(`✅ Bitbucket OAuth installation completed for workspace: ${workspaceSlug}`);

    // Redirect to success page or dashboard
    res.redirect('/?success=bitbucket_installed');
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    res.redirect('/?error=bitbucket_oauth_error');
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

