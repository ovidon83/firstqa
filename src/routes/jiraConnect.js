/**
 * Atlassian Connect Routes
 * Handles Connect app lifecycle and webhooks
 */

const express = require('express');
const router = express.Router();
const {
  saveConnectInstallation,
  deleteConnectInstallation,
  verifyConnectJWT,
  generateInstallationToken
} = require('../utils/jiraConnectAuth');
const axios = require('axios');

/**
 * GET /jira-connect/descriptor
 * Serves the atlassian-connect.json descriptor
 */
router.get('/descriptor', (req, res) => {
  const descriptor = require('../../atlassian-connect.json');
  res.json(descriptor);
});

/**
 * POST /jira-connect/installed
 * Called when the Connect app is installed on a Jira site
 */
router.post('/installed', async (req, res) => {
  try {
    console.log('📦 Jira Connect app installation request received');
    console.log('Installation payload:', JSON.stringify(req.body, null, 2));

    const installationData = req.body;
    
    // Validate required fields
    if (!installationData.clientKey || !installationData.sharedSecret) {
      console.error('❌ Missing required installation fields');
      return res.status(400).json({ error: 'Missing clientKey or sharedSecret' });
    }

    // Save installation data
    await saveConnectInstallation(installationData);

    console.log('✅ Jira Connect app installed successfully');
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Installation error:', error);
    res.status(500).json({ error: 'Installation failed' });
  }
});

/**
 * POST /jira-connect/uninstalled
 * Called when the Connect app is uninstalled from a Jira site
 */
router.post('/uninstalled', async (req, res) => {
  try {
    console.log('📤 Jira Connect app uninstallation request received');
    
    const { clientKey } = req.body;
    
    if (!clientKey) {
      return res.status(400).json({ error: 'Missing clientKey' });
    }

    await deleteConnectInstallation(clientKey);

    console.log('✅ Jira Connect app uninstalled successfully');
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Uninstallation error:', error);
    res.status(500).json({ error: 'Uninstallation failed' });
  }
});

/**
 * POST /jira-connect/enabled
 * Called when the Connect app is enabled
 */
router.post('/enabled', verifyConnectJWT, (req, res) => {
  console.log('✅ Jira Connect app enabled');
  res.status(200).json({ success: true });
});

/**
 * POST /jira-connect/disabled
 * Called when the Connect app is disabled
 */
router.post('/disabled', verifyConnectJWT, (req, res) => {
  console.log('⏸️  Jira Connect app disabled');
  res.status(200).json({ success: true });
});

/**
 * POST /jira-connect/webhook
 * Handles webhooks from Jira (comment_created)
 */
router.post('/webhook', verifyConnectJWT, async (req, res) => {
  try {
    console.log('🔔 Jira Connect webhook received');
    console.log('Webhook event:', req.query.event);
    console.log('Installation:', req.connectInstallation?.site_name);

    const payload = req.body;
    const event = req.query.event;

    // Only handle comment_created events
    if (event !== 'comment_created') {
      console.log(`Skipping event: ${event}`);
      return res.status(200).json({ success: true, message: 'Event ignored' });
    }

    // Process the webhook
    const { processConnectWebhook } = require('../utils/jiraConnectService');
    const result = await processConnectWebhook(payload, req.connectInstallation);

    res.status(200).json({ success: true, result });
  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

module.exports = router;
