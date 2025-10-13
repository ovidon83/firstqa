/**
 * Automated Test Orchestrator
 * Coordinates test execution, GitHub Checks, and result reporting
 */

const { executeTestRecipe } = require('../../ai/testExecutor');
const { createCheckRun, updateCheckRunWithResults, updateCheckRunWithError, getOctokit } = require('./githubChecksService');
const { generateTestReportComment } = require('./testReportFormatter');
const { uploadScreenshotToGitHub, uploadMultipleScreenshots } = require('./screenshotService');
const { uploadVideo } = require('./videoService');
const { Octokit } = require('@octokit/rest');

/**
 * Execute automated tests for a PR
 * @param {Object} params - Test execution parameters
 * @param {string} params.owner - Repository owner
 * @param {string} params.repo - Repository name
 * @param {number} params.prNumber - PR number
 * @param {string} params.sha - Commit SHA
 * @param {Array} params.testRecipe - Test recipe from AI analysis
 * @param {string} params.baseUrl - Base URL to test
 * @param {number} params.installationId - GitHub App installation ID
 * @returns {Promise<Object>} Test execution results
 */
async function executeAutomatedTests(params) {
  const { owner, repo, prNumber, sha, testRecipe, baseUrl, installationId } = params;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 Starting Automated Test Execution`);
  console.log(`   Repository: ${owner}/${repo}`);
  console.log(`   PR: #${prNumber}`);
  console.log(`   Base URL: ${baseUrl}`);
  console.log(`   Test Scenarios: ${testRecipe.length}`);
  console.log(`${'='.repeat(60)}\n`);

  let octokit;
  let checkRunId = null;

  try {
    // Get authenticated Octokit instance
    octokit = await getOctokit(installationId);

    // Create GitHub Check Run
    checkRunId = await createCheckRun(octokit, owner, repo, sha, prNumber);

    // Execute tests with Playwright
    console.log(`🎬 Executing test recipe...`);
    const results = await executeTestRecipe(testRecipe, baseUrl, {
      recordVideo: true,
      takeScreenshots: true,
      headless: true,
      slowMo: 100,
      timeout: 30000
    });

    console.log(`\n✅ Test execution completed`);
    console.log(`   Passed: ${results.passed}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Total: ${results.totalTests}`);

    // Upload screenshots
    console.log(`\n📸 Uploading screenshots...`);
    const screenshotUrls = {};
    for (const scenario of results.scenarios) {
      if (scenario.screenshotPath) {
        const filename = `${scenario.scenario.replace(/[^a-z0-9]/gi, '_')}.png`;
        const uploadResult = await uploadScreenshotToGitHub(scenario.screenshotPath, filename);
        screenshotUrls[scenario.scenario] = uploadResult.url;
      }
    }

    // Upload video
    console.log(`\n🎥 Uploading video...`);
    let videoUrl = null;
    if (results.fullVideoPath) {
      const videoResult = await uploadVideo(results.fullVideoPath, `test-run-${results.executionId}.webm`);
      videoUrl = videoResult.url || `${process.env.BASE_URL}/test-results/${results.executionId}/full-test-run.webm`;
    }

    // Update GitHub Check Run with results
    console.log(`\n📝 Updating GitHub Check Run...`);
    await updateCheckRunWithResults(octokit, owner, repo, checkRunId, results);

    // Post detailed comment with results
    console.log(`\n💬 Posting detailed test report...`);
    const comment = generateTestReportComment(results, videoUrl, screenshotUrls);
    
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: comment
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Automated testing complete!`);
    console.log(`   Check Run: Updated`);
    console.log(`   Comment: Posted`);
    console.log(`   Status: ${results.failed === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`${'='.repeat(60)}\n`);

    return {
      success: true,
      results,
      checkRunId,
      videoUrl,
      screenshotUrls
    };

  } catch (error) {
    console.error(`\n❌ Automated test execution failed:`, error.message);
    console.error(error.stack);

    // Update Check Run with error
    if (octokit && checkRunId) {
      try {
        await updateCheckRunWithError(octokit, owner, repo, checkRunId, error);
      } catch (updateError) {
        console.error('Failed to update Check Run with error:', updateError.message);
      }
    }

    // Post error comment
    if (octokit) {
      try {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `## ❌ Automated Test Execution Failed\n\n` +
                `An error occurred while executing automated tests:\n\n` +
                `\`\`\`\n${error.message}\n\`\`\`\n\n` +
                `Please check the configuration and try again.\n\n` +
                `<sub>🤖 Ovi AI Test Automation</sub>`
        });
      } catch (commentError) {
        console.error('Failed to post error comment:', commentError.message);
      }
    }

    return {
      success: false,
      error: error.message,
      checkRunId
    };
  }
}

/**
 * Check if automated testing should run for this PR
 * @param {Object} pr - PR object
 * @param {Object} aiInsights - AI analysis insights
 * @returns {boolean} - Whether to run automated tests
 */
function shouldRunAutomatedTests(pr, aiInsights) {
  // Check if TEST_AUTOMATION_ENABLED is set
  if (process.env.TEST_AUTOMATION_ENABLED !== 'true') {
    console.log('⏭️  Test automation is disabled via environment variable');
    return false;
  }

  // Check if PR has a specific label to trigger tests
  const triggerLabels = (process.env.TEST_AUTOMATION_TRIGGER_LABELS || '').split(',').map(l => l.trim());
  if (triggerLabels.length > 0) {
    const prLabels = pr.labels?.map(l => l.name) || [];
    const hasLabel = triggerLabels.some(label => prLabels.includes(label));
    if (!hasLabel) {
      console.log(`⏭️  PR doesn't have required label: ${triggerLabels.join(', ')}`);
      return false;
    }
  }

  // Check if AI analysis indicates tests are needed
  if (aiInsights?.data?.readyForDevPulse?.needsQA === 'No') {
    console.log('⏭️  AI analysis indicates testing is not needed');
    return false;
  }

  // Check if test recipe exists and has scenarios
  const testRecipe = aiInsights?.data?.testRecipe;
  if (!testRecipe || testRecipe.length === 0) {
    console.log('⏭️  No test recipe available');
    return false;
  }

  // Check if staging URL is configured
  if (!process.env.TEST_AUTOMATION_BASE_URL) {
    console.log('⚠️  TEST_AUTOMATION_BASE_URL not configured, skipping automated tests');
    return false;
  }

  return true;
}

/**
 * Get test configuration from environment variables
 */
function getTestConfig() {
  return {
    baseUrl: process.env.TEST_AUTOMATION_BASE_URL || 'http://localhost:3000',
    enabled: process.env.TEST_AUTOMATION_ENABLED === 'true',
    triggerLabels: (process.env.TEST_AUTOMATION_TRIGGER_LABELS || '').split(',').map(l => l.trim()).filter(Boolean),
    headless: process.env.TEST_AUTOMATION_HEADLESS !== 'false',
    slowMo: parseInt(process.env.TEST_AUTOMATION_SLOW_MO || '100'),
    timeout: parseInt(process.env.TEST_AUTOMATION_TIMEOUT || '30000'),
    recordVideo: process.env.TEST_AUTOMATION_RECORD_VIDEO !== 'false',
    takeScreenshots: process.env.TEST_AUTOMATION_SCREENSHOTS !== 'false'
  };
}

module.exports = {
  executeAutomatedTests,
  shouldRunAutomatedTests,
  getTestConfig
};

