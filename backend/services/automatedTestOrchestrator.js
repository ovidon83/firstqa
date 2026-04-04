/**
 * Automated Test Orchestrator
 * Coordinates executability scoring, test execution, GitHub Checks, and result reporting
 */

const { executeTestRecipe } = require('../ai/testExecutor');
const { scoreExecutability, partitionByScore } = require('../ai/executabilityScorer');
const { createCheckRun, updateCheckRunWithResults, updateCheckRunWithError, getOctokit } = require('./githubChecksService');
const { generateTestReportComment } = require('./testReportFormatter');
const { uploadScreenshotToGitHub } = require('./screenshotService');

async function executeAutomatedTests(params) {
  const { owner, repo, prNumber, sha, testRecipe, baseUrl, installationId, userContext, testCredentials, authCookies } = params;

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
    octokit = await getOctokit(installationId);
    if (sha) {
      checkRunId = await createCheckRun(octokit, owner, repo, sha, prNumber);
    } else {
      console.warn('⚠️ No SHA available — skipping GitHub Check Run creation');
    }

    // Score each scenario for browser executability
    console.log(`🧠 Scoring scenario executability...`);
    const scoredRecipe = await scoreExecutability(testRecipe);
    const { executable, manual } = partitionByScore(scoredRecipe);

    console.log(`   ✅ ${executable.length} executable (score >= 70)`);
    console.log(`   📋 ${manual.length} manual-only (score < 70)`);

    if (executable.length === 0) {
      const comment = `⏭️ **No browser-executable scenarios.**\n\nAll ${testRecipe.length} test scenario(s) scored below 70% for browser automation and require manual testing.\n\n` +
        manual.map(s => `- **${s.scenario}** (${s.browser_score}%) — ${s.skip_reason}`).join('\n');
      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: comment });
      return { success: true, message: 'All scenarios need manual testing' };
    }

    // Execute browser-testable scenarios
    console.log(`\n🎬 Executing ${executable.length} scenario(s)...`);
    const results = await executeTestRecipe(executable, baseUrl, {
      takeScreenshots: true,
      timeout: 60000,
      userContext,
      testCredentials,
      authCookies
    });

    console.log(`\n✅ Test execution completed`);
    console.log(`   Passed: ${results.passed} (${results.partial || 0} partial)`);
    console.log(`   Failed: ${results.failed}`);

    // Build screenshot URLs
    console.log(`\n📸 Processing screenshots...`);
    const screenshotUrls = {};
    for (const scenario of results.scenarios) {
      if (scenario.screenshotPath) {
        const filename = `${scenario.scenario.replace(/[^a-z0-9]/gi, '_')}.png`;
        const uploadResult = await uploadScreenshotToGitHub(scenario.screenshotPath, filename);
        screenshotUrls[scenario.scenario] = uploadResult.url;
      }
    }

    // Video/replay URL
    const videoUrl = results.sessionReplayUrl || null;

    // Update GitHub Check Run
    await updateCheckRunWithResults(octokit, owner, repo, checkRunId, results);

    // Post report comment
    console.log(`\n💬 Posting test report...`);
    const comment = generateTestReportComment(results, videoUrl, screenshotUrls, manual);

    await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: comment });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Automated testing complete!`);
    console.log(`${'='.repeat(60)}\n`);

    return { success: true, results, checkRunId, videoUrl, screenshotUrls };

  } catch (error) {
    console.error(`\n❌ Automated test execution failed:`, error.message);
    console.error('❌ Stack:', error.stack);

    if (octokit && checkRunId) {
      await updateCheckRunWithError(octokit, owner, repo, checkRunId, error).catch(() => {});
    }

    if (octokit) {
      await octokit.issues.createComment({
        owner, repo, issue_number: prNumber,
        body: `## ❌ Automated Test Execution Failed\n\n\`\`\`\n${error.message}\n\`\`\`\n\n` +
              `**Possible causes:** Missing test data, login required, or environment setup.\n\n` +
              `<sub>🤖 Ovi AI Test Automation</sub>`
      }).catch(() => {});
    }

    return { success: false, error: error.message, checkRunId };
  }
}

function shouldRunAutomatedTests(pr, aiInsights) {
  if (process.env.TEST_AUTOMATION_ENABLED !== 'true') return false;

  const triggerLabels = (process.env.TEST_AUTOMATION_TRIGGER_LABELS || '').split(',').map(l => l.trim());
  if (triggerLabels.length > 0) {
    const prLabels = pr.labels?.map(l => l.name) || [];
    if (!triggerLabels.some(label => prLabels.includes(label))) return false;
  }

  if (aiInsights?.data?.readyForDevPulse?.needsQA === 'No') return false;

  const testRecipe = aiInsights?.data?.testRecipe;
  if (!testRecipe || testRecipe.length === 0) return false;
  if (!process.env.TEST_AUTOMATION_BASE_URL) return false;

  return true;
}

function getTestConfig() {
  return {
    baseUrl: process.env.TEST_AUTOMATION_BASE_URL || 'http://localhost:3000',
    enabled: process.env.TEST_AUTOMATION_ENABLED === 'true',
    triggerLabels: (process.env.TEST_AUTOMATION_TRIGGER_LABELS || '').split(',').map(l => l.trim()).filter(Boolean),
    headless: process.env.TEST_AUTOMATION_HEADLESS !== 'false',
    timeout: parseInt(process.env.TEST_AUTOMATION_TIMEOUT || '60000'),
    takeScreenshots: process.env.TEST_AUTOMATION_SCREENSHOTS !== 'false'
  };
}

module.exports = { executeAutomatedTests, shouldRunAutomatedTests, getTestConfig };
