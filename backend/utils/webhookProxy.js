/**
 * Webhook Proxy for Local Development
 * Uses Smee.io to proxy GitHub webhooks to local development environment
 */
const SmeeClient = require('smee-client');

let smeeClient = null;

/**
 * Initialize the webhook proxy
 */
function initializeWebhookProxy() {
  const webhookProxyUrl = process.env.WEBHOOK_PROXY_URL;
  
  if (!webhookProxyUrl) {
    console.log('No webhook proxy URL provided. Skipping webhook proxy setup.');
    return;
  }

  try {
    // Create client
    smeeClient = new SmeeClient({
      source: webhookProxyUrl,
      target: `http://localhost:${process.env.PORT || 3000}/github/webhook`,
      logger: console
    });

    // Start proxy
    const events = smeeClient.start();
    
    console.log(`✅ Webhook proxy started with Smee.io`);
    console.log(`📮 Forwarding ${webhookProxyUrl} to http://localhost:${process.env.PORT || 3000}/github/webhook`);

    return events;
  } catch (error) {
    console.error('Failed to start webhook proxy:', error);
    return null;
  }
}

/**
 * Stop the webhook proxy
 */
function stopWebhookProxy() {
  if (smeeClient) {
    smeeClient.close();
    console.log('Webhook proxy stopped');
  }
}

module.exports = {
  initializeWebhookProxy,
  stopWebhookProxy
}; 