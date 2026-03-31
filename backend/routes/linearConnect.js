/**
 * Linear Connect Routes
 * Handles webhook events and installation management
 */

const express = require('express');
const router = express.Router();
const {
  saveLinearInstallation,
  deleteLinearInstallation,
  verifyLinearWebhook
} = require('../utils/linearConnectAuth');

/**
 * POST /linear-connect/install
 * Called when Linear integration is installed (manual setup via API key)
 */
router.post('/install', async (req, res) => {
  try {
    console.log('📦 Linear Connect installation request received');
    console.log('Installation payload:', JSON.stringify(req.body, null, 2));

    const { apiKey, organizationId, organizationName, teamId, webhookSecret } = req.body;
    
    // Validate required fields
    if (!apiKey || !organizationId) {
      console.error('❌ Missing required installation fields');
      return res.status(400).json({ error: 'Missing apiKey or organizationId' });
    }

    // Save installation data
    await saveLinearInstallation({
      apiKey,
      organizationId,
      organizationName,
      teamId,
      webhookSecret
    });

    console.log('✅ Linear Connect installed successfully');
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Installation error:', error);
    res.status(500).json({ error: 'Installation failed' });
  }
});

/**
 * POST /linear-connect/uninstall
 * Called when Linear integration is uninstalled
 */
router.post('/uninstall', async (req, res) => {
  try {
    console.log('📤 Linear Connect uninstallation request received');
    
    const { organizationId } = req.body;
    
    if (!organizationId) {
      return res.status(400).json({ error: 'Missing organizationId' });
    }

    await deleteLinearInstallation(organizationId);

    console.log('✅ Linear Connect uninstalled successfully');
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Uninstallation error:', error);
    res.status(500).json({ error: 'Uninstallation failed' });
  }
});

/**
 * POST /linear-connect/webhook
 * Handles webhooks from Linear (comment_created)
 */
router.post('/webhook', verifyLinearWebhook, async (req, res) => {
  try {
    console.log('🔔 Linear Connect webhook received');
    console.log('Installation:', req.linearInstallation?.organization_name);

    const payload = req.body;

    if (!req.linearInstallation) {
      const orgId = req.body?.organizationId || req.body?.data?.organization?.id;
      console.warn(`⚠️ Linear webhook received for unmatched organization: ${orgId}. No installation found — this event is orphaned.`);
      return res.status(200).json({ success: false, reason: 'no_matching_installation' });
    }

    const { processLinearWebhook } = require('../utils/linearConnectService');
    const result = await processLinearWebhook(payload, req.linearInstallation);

    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/**
 * POST /linear-connect/test
 * Test that the stored Linear API key is still valid
 */
router.post('/test', async (req, res) => {
  try {
    const userId = req.session?.user?.id;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
    if (!isSupabaseConfigured()) return res.status(500).json({ error: 'Database not configured' });

    const { data: int } = await supabaseAdmin
      .from('linear_connect_installations')
      .select('api_key, organization_name')
      .limit(1)
      .maybeSingle();

    if (!int || !int.api_key) {
      return res.json({ success: false, error: 'No Linear installation found' });
    }

    const response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': int.api_key
      },
      body: JSON.stringify({ query: '{ viewer { id name } }' })
    });

    const result = await response.json();
    if (result.data?.viewer?.id) {
      return res.json({ success: true, viewer: result.data.viewer.name || result.data.viewer.id });
    }
    return res.json({ success: false, error: 'API key invalid or expired' });
  } catch (error) {
    console.error('Linear test connection error:', error.message);
    return res.json({ success: false, error: error.message });
  }
});

module.exports = router;
