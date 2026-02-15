#!/usr/bin/env node

/**
 * Fixed webhook client for smee.io
 * Uses the smee-client API directly to connect to the webhook URL
 */
require('dotenv').config();
const SmeeClient = require('smee-client');

// Get the webhook URL directly without any modifications
const WEBHOOK_URL = process.env.WEBHOOK_PROXY_URL;
if (!WEBHOOK_URL) {
  console.error('Error: WEBHOOK_PROXY_URL is not defined in .env file');
  process.exit(1);
}

const TARGET_URL = process.env.WEBHOOK_TARGET_URL || 'http://localhost:3000/github/webhook';

console.log('=== Fixed Webhook Client ===');
console.log(`Webhook URL: ${WEBHOOK_URL}`);
console.log(`Target URL: ${TARGET_URL}`);

// Create the client with explicit source and target
const client = new SmeeClient({
  source: WEBHOOK_URL,
  target: TARGET_URL,
  logger: {
    info: (...args) => console.log('[INFO]', ...args),
    error: (...args) => console.error('[ERROR]', ...args)
  }
});

// Start forwarding events from source to target
let events;

function startClient() {
  try {
    events = client.start();
    console.log(`Client started successfully. Forwarding ${WEBHOOK_URL} to ${TARGET_URL}`);
    console.log('Press Ctrl+C to stop');
  } catch (error) {
    console.error('Error starting client:', error);
    console.log('Retrying in 5 seconds...');
    setTimeout(startClient, 5000);
  }
}

startClient();

// Handle reconnection
events?.on('error', (err) => {
  console.error('Connection error:', err);
  console.log('Reconnecting...');
  if (events) {
    events.close();
  }
  setTimeout(startClient, 1000);
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('Shutting down...');
  if (events) {
    events.close();
  }
  process.exit(0);
}); 