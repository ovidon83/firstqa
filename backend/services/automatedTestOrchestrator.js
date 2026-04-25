/**
 * Automated Test Orchestrator
 * Coordinates executability scoring, test execution, GitHub Checks, and result reporting
 */

const { executeTestRecipe } = require('../ai/testExecutor');
const { scoreExecutability, partitionByScore } = require('../ai/executabilityScorer');
const { createCheckRun, updateCheckRunWithResults, updateCheckRunWithError, getOctokit } = require('./githubChecksService');
const { generateTestReportComment } = require('./testReportFormatter');
const { uploadScreenshotToGitHub } = require('./screenshotService');

// Hard ceiling: 32 min (Browserbase sessions cap at 30 min; this gives 2 min buffer for cleanup)
const GLOBAL_RUN_TIMEOUT_MS = 32 * 60 * 1000;

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
  let globalTimeoutHandle;
  let sharedResults = {}; // declared outside try so catch block can read partial results on timeout

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

    // Execute browser-testable scenarios — race against global timeout.
    // sharedResults is mutated in-place as scenarios complete, so we can
    // read partial data if the timeout fires before execution finishes.
    console.log(`\n🎬 Executing ${executable.length} scenario(s)...`);

    sharedResults = {};
    const globalTimeoutPromise = new Promise((_, reject) => {
      globalTimeoutHandle = setTimeout(() => {
        reject(new Error('GLOBAL_TIMEOUT: Test run exceeded 32-minute limit and was stopped automatically.'));
      }, GLOBAL_RUN_TIMEOUT_MS);
    });

    const results = await Promise.race([
      executeTestRecipe(executable, baseUrl, {
        takeScreenshots: true,
        timeout: 60000,
        userContext,
        testCredentials,
        authCookies,
        sharedResults
      }),
      globalTimeoutPromise
    ]);

    clearTimeout(globalTimeoutHandle);

    console.log(`\n✅ Test execution completed`);
    console.log(`   Passed: ${results.passed} (${results.partial || 0} partial)`);
    console.log(`   Failed: ${results.failed}`);

    // Build screenshot URLs — failures here must not block the check run from closing
    console.log(`\n📸 Processing screenshots...`);
    const screenshotUrls = {};
    for (const scenario of results.scenarios) {
      if (scenario.screenshotPath) {
        try {
          const filename = `${scenario.scenario.replace(/[^a-z0-9]/gi, '_')}.png`;
          const uploadResult = await uploadScreenshotToGitHub(scenario.screenshotPath, filename);
          screenshotUrls[scenario.scenario] = uploadResult.url;
        } catch (ssErr) {
          console.warn(`⚠️ Screenshot upload failed for "${scenario.scenario}": ${ssErr.message}`);
        }
      }
    }

    // Video/replay URL
    const videoUrl = results.sessionReplayUrl || null;

    // Always close the check run — this must not be skipped
    if (octokit && checkRunId) {
      await updateCheckRunWithResults(octokit, owner, repo, checkRunId, results).catch(err => {
        console.error(`⚠️ Failed to update check run: ${err.message}`);
      });
    }

    // Post report comment
    console.log(`\n💬 Posting test report...`);
    try {
      const comment = generateTestReportComment(results, videoUrl, screenshotUrls, manual);
      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: comment });
    } catch (reportErr) {
      console.error(`⚠️ Failed to post report comment: ${reportErr.message}`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Automated testing complete!`);
    console.log(`${'='.repeat(60)}\n`);

    return { success: true, results, checkRunId, videoUrl, screenshotUrls };

  } catch (error) {
    clearTimeout(globalTimeoutHandle);

    const isTimeout = error.message?.startsWith('GLOBAL_TIMEOUT');
    console.error(`\n${isTimeout ? '⏱️' : '❌'} Automated test execution ${isTimeout ? 'timed out' : 'failed'}:`, error.message);
    if (!isTimeout) console.error('❌ Stack:', error.stack);

    // On timeout, we may have partial results from scenarios that already completed
    const hasPartialResults = isTimeout && sharedResults && sharedResults.scenarios?.length > 0;
    const partialResults = hasPartialResults ? sharedResults : null;

    if (octokit && checkRunId) {
      if (hasPartialResults) {
        // Post partial results with a timeout note
        await updateCheckRunWithResults(octokit, owner, repo, checkRunId, partialResults).catch(() => {
          // Fallback if partial update also fails
          octokit.checks.update({
            owner, repo, check_run_id: checkRunId,
            status: 'completed', conclusion: 'timed_out',
            completed_at: new Date().toISOString(),
            output: { title: '⏱️ Test run timed out', summary: 'Run exceeded 32-minute limit.' }
          }).catch(() => {});
        });
      } else {
        await octokit.checks.update({
          owner, repo,
          check_run_id: checkRunId,
          status: 'completed',
          conclusion: isTimeout ? 'timed_out' : 'failure',
          completed_at: new Date().toISOString(),
          output: {
            title: isTimeout ? '⏱️ Test run timed out after 32 minutes' : '❌ Test execution failed',
            summary: isTimeout
              ? 'The test run hit the 32-minute limit and was stopped.'
              : `An error occurred during test execution: ${error.message}`
          }
        }).catch(() => {});
      }
    }

    if (octokit) {
      let body;
      if (hasPartialResults) {
        const videoUrl = partialResults.sessionReplayUrl || null;
        const screenshotUrls = {};
        body = generateTestReportComment(partialResults, videoUrl, screenshotUrls, []);
        body += `\n\n> ⏱️ **Run timed out after 32 minutes** — partial results above (${partialResults.scenarios.length} of ${executable?.length || '?'} scenarios completed). Re-run with \`/qa testrun\` to continue.\n`;
      } else if (isTimeout) {
        body = `## ⏱️ Test Run Timed Out\n\nThe run was stopped after **32 minutes** before any scenarios completed.\n\n**Common causes:** Too many scenarios, app requires login, or slow staging environment.\n\n**Try:** Ensure credentials are configured in [Settings](${process.env.BASE_URL || 'https://www.firstqa.dev'}/dashboard/settings) and re-run with \`/qa testrun\`.\n\n<sub>🤖 Ovi AI Test Automation</sub>`;
      } else {
        body = `## ❌ Automated Test Execution Failed\n\n\`\`\`\n${error.message}\n\`\`\`\n\n**Possible causes:** Missing test data, login required, or environment setup.\n\n<sub>🤖 Ovi AI Test Automation</sub>`;
      }

      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body }).catch(() => {});
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
