#!/usr/bin/env node
/**
 * Test script for automated testing functionality
 * Verifies that all components are set up correctly
 */

require('dotenv').config();
const { executeTestRecipe } = require('../backend/ai/testExecutor');
const { getTestConfig } = require('../backend/services/automatedTestOrchestrator');

async function testAutomatedTesting() {
  console.log('🧪 Testing Automated Testing Setup\n');
  console.log('='.repeat(60));
  
  // Check environment variables
  console.log('\n1. Checking Environment Configuration:');
  const config = getTestConfig();
  console.log(`   ✓ Enabled: ${config.enabled}`);
  console.log(`   ✓ Base URL: ${config.baseUrl}`);
  console.log(`   ✓ Headless: ${config.headless}`);
  console.log(`   ✓ Record Video: ${config.recordVideo}`);
  console.log(`   ✓ Screenshots: ${config.takeScreenshots}`);
  
  if (!config.enabled) {
    console.log('\n⚠️  TEST_AUTOMATION_ENABLED is not set to true');
    console.log('   Set TEST_AUTOMATION_ENABLED=true in .env to enable');
  }
  
  if (!process.env.OPENAI_API_KEY) {
    console.log('\n❌ OPENAI_API_KEY is not set');
    console.log('   Required for AI-powered test conversion');
    process.exit(1);
  } else {
    console.log(`   ✓ OpenAI API Key: ${process.env.OPENAI_API_KEY.substring(0, 10)}...`);
  }
  
  // Check Browserbase / Playwright-core
  console.log('\n2. Checking Browser Setup:');
  if (process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID) {
    console.log('   ✓ Browserbase API key configured');
    console.log('   ✓ Browserbase project ID configured');
  } else {
    console.log('   ⚠️ BROWSERBASE_API_KEY / BROWSERBASE_PROJECT_ID not set — will fall back to local Chromium');
  }
  try {
    require('playwright-core');
    console.log('   ✓ playwright-core installed');
  } catch (error) {
    console.log(`   ❌ playwright-core not found: ${error.message}`);
    process.exit(1);
  }
  
  // Test with a sample test recipe
  console.log('\n3. Testing Sample Test Execution:');
  console.log('   (This will test against example.com)\n');
  
  const sampleTestRecipe = [
    {
      scenario: 'Homepage loads successfully',
      priority: 'Happy Path',
      steps: '1. Navigate to the homepage\n2. Wait for page to load',
      expected: 'Page title contains "Example" and page loads without errors'
    }
  ];
  
  try {
    console.log('   🎬 Executing test...');
    const results = await executeTestRecipe(sampleTestRecipe, 'https://example.com', {
      recordVideo: true,
      takeScreenshots: true,
      headless: true,
      slowMo: 100,
      timeout: 10000
    });
    
    console.log(`\n   ✅ Test execution completed!`);
    console.log(`      Passed: ${results.passed}`);
    console.log(`      Failed: ${results.failed}`);
    console.log(`      Duration: ${Math.round(results.duration / 1000)}s`);
    console.log(`      Results saved to: ${results.resultsDir}`);
    
    if (results.fullVideoPath) {
      console.log(`      Video: ${results.fullVideoPath}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All checks passed! Automated testing is ready to use.');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.log(`\n   ❌ Test execution failed: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the test
testAutomatedTesting().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

