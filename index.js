/**
 * Entry point for FirstQA application
 * This file serves as the main entry point for production deployments
 * It simply requires the webhook-server module which contains all the application logic
 */

const path = require('path');

console.log('🚀 Starting FirstQA production server...');
console.log('📁 Current working directory (before fix):', process.cwd());

// CRITICAL FIX: If we're executing from src/, move up to project root
// This fixes Render's corrupted state from previous deploys
const currentDir = process.cwd();
if (currentDir.endsWith('/src')) {
  console.log('⚠️  Detected execution from /src - fixing working directory...');
  const projectRoot = path.dirname(currentDir);
  process.chdir(projectRoot);
  console.log('✅ Changed working directory to:', process.cwd());
}

// Also check if we're in a nested src/src situation
if (currentDir.includes('/src/src')) {
  console.log('⚠️  Detected nested /src/src - fixing working directory...');
  // Go up until we're at the root
  let fixedPath = currentDir;
  while (fixedPath.endsWith('/src')) {
    fixedPath = path.dirname(fixedPath);
  }
  process.chdir(fixedPath);
  console.log('✅ Changed working directory to:', process.cwd());
}

console.log('📁 Current working directory (after fix):', process.cwd());
console.log('📄 Loading webhook-server.js...');

// Import the main application using absolute path from new working directory
// This ensures we load from /opt/render/project/webhook-server.js, not /opt/render/project/src/webhook-server.js
const webhookServerPath = path.join(process.cwd(), 'webhook-server.js');
console.log('📄 Loading from absolute path:', webhookServerPath);
require(webhookServerPath);

console.log('✅ FirstQA production server started successfully!'); 