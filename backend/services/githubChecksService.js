/**
 * GitHub Checks API Integration
 * Creates and updates Check Runs for test execution status
 */

const { Octokit } = require('@octokit/rest');
const { createAppAuth } = require('@octokit/auth-app');

/**
 * Get authenticated Octokit instance for GitHub App
 */
async function getOctokit(installationId) {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GitHub App credentials not configured');
  }

  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId,
      privateKey,
      installationId
    }
  });

  return octokit;
}

/**
 * Create a Check Run when test execution starts
 */
async function createCheckRun(octokit, owner, repo, sha, prNumber) {
  try {
    console.log(`✅ Creating Check Run for ${owner}/${repo}#${prNumber}`);

    const response = await octokit.checks.create({
      owner,
      repo,
      name: 'Ovi AI - Automated Tests',
      head_sha: sha,
      status: 'in_progress',
      started_at: new Date().toISOString(),
      output: {
        title: '🤖 Running automated test suite...',
        summary: 'Test execution in progress. This may take a few minutes.',
        text: 'Ovi AI is executing the test recipe using Playwright browser automation.'
      },
      details_url: `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard`
    });

    console.log(`✅ Check Run created: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error('Error creating Check Run:', error.message);
    throw error;
  }
}

/**
 * Update Check Run with test results
 */
async function updateCheckRunWithResults(octokit, owner, repo, checkRunId, results) {
  try {
    const passed = results.failed === 0;
    const conclusion = passed ? 'success' : 'failure';

    // Generate summary
    const summary = generateSummary(results);
    
    // Generate detailed text output
    const textOutput = generateDetailedOutput(results);

    // Create annotations for failed tests
    const annotations = generateAnnotations(results);

    console.log(`📝 Updating Check Run ${checkRunId} with ${conclusion}`);

    await octokit.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: passed 
          ? `✅ All ${results.totalTests} tests passed!` 
          : `❌ ${results.failed} of ${results.totalTests} tests failed`,
        summary,
        text: textOutput,
        annotations: annotations.slice(0, 50) // GitHub limits to 50 annotations
      }
    });

    console.log(`✅ Check Run updated successfully`);
  } catch (error) {
    console.error('Error updating Check Run:', error.message);
    throw error;
  }
}

/**
 * Update Check Run with error status
 */
async function updateCheckRunWithError(octokit, owner, repo, checkRunId, error) {
  try {
    await octokit.checks.update({
      owner,
      repo,
      check_run_id: checkRunId,
      status: 'completed',
      conclusion: 'failure',
      completed_at: new Date().toISOString(),
      output: {
        title: '❌ Test execution failed',
        summary: 'An error occurred during test execution.',
        text: `**Error Message:**\n\`\`\`\n${error.message}\n\`\`\`\n\n**Stack Trace:**\n\`\`\`\n${error.stack}\n\`\`\``
      }
    });
  } catch (err) {
    console.error('Error updating Check Run with error:', err.message);
  }
}

/**
 * Generate summary for Check Run
 */
function generateSummary(results) {
  const duration = Math.round(results.duration / 1000);
  const passRate = Math.round((results.passed / results.totalTests) * 100);

  let summary = `### Test Execution Summary\n\n`;
  summary += `**Duration:** ${Math.floor(duration / 60)}m ${duration % 60}s\n`;
  summary += `**Pass Rate:** ${passRate}%\n\n`;
  summary += `| Status | Count |\n`;
  summary += `|--------|-------|\n`;
  summary += `| ✅ Passed | ${results.passed} |\n`;
  summary += `| ❌ Failed | ${results.failed} |\n`;
  summary += `| ⏭️ Skipped | ${results.skipped} |\n`;
  summary += `| **Total** | **${results.totalTests}** |\n\n`;

  if (results.failed > 0) {
    summary += `### ⚠️ Failed Tests\n\n`;
    results.scenarios
      .filter(s => s.status === 'FAIL' || s.status === 'ERROR')
      .forEach(s => {
        summary += `- **${s.scenario}** (${s.priority})\n`;
      });
  }

  return summary;
}

/**
 * Generate detailed text output for Check Run
 */
function generateDetailedOutput(results) {
  let output = `## Test Results by Priority\n\n`;

  const priorities = ['Happy Path', 'Critical Path', 'Edge Case', 'Regression'];
  
  for (const priority of priorities) {
    const scenarios = results.scenarios.filter(s => s.priority === priority);
    if (scenarios.length === 0) continue;

    const passed = scenarios.filter(s => s.status === 'PASS').length;
    const total = scenarios.length;

    output += `### ${priority} (${passed}/${total} passed)\n\n`;
    output += `| Test Scenario | Status | Duration |\n`;
    output += `|--------------|--------|----------|\n`;

    for (const scenario of scenarios) {
      const statusEmoji = scenario.status === 'PASS' ? '✅' : '❌';
      const duration = (scenario.duration / 1000).toFixed(1);
      output += `| ${scenario.scenario} | ${statusEmoji} ${scenario.status} | ${duration}s |\n`;
    }

    output += `\n`;
  }

  // Add scenarios without priority
  const noPriority = results.scenarios.filter(s => !priorities.includes(s.priority));
  if (noPriority.length > 0) {
    output += `### Other Tests (${noPriority.filter(s => s.status === 'PASS').length}/${noPriority.length} passed)\n\n`;
    output += `| Test Scenario | Status | Duration |\n`;
    output += `|--------------|--------|----------|\n`;
    
    for (const scenario of noPriority) {
      const statusEmoji = scenario.status === 'PASS' ? '✅' : '❌';
      const duration = (scenario.duration / 1000).toFixed(1);
      output += `| ${scenario.scenario} | ${statusEmoji} ${scenario.status} | ${duration}s |\n`;
    }
  }

  return output;
}

/**
 * Generate annotations for failed tests
 */
function generateAnnotations(results) {
  const annotations = [];

  results.scenarios
    .filter(s => s.status === 'FAIL' || s.status === 'ERROR')
    .forEach((scenario, index) => {
      annotations.push({
        path: 'test-results',
        start_line: index + 1,
        end_line: index + 1,
        annotation_level: 'failure',
        title: `❌ ${scenario.scenario}`,
        message: scenario.error || 'Test failed without specific error message',
        raw_details: generateAnnotationDetails(scenario)
      });
    });

  return annotations;
}

/**
 * Generate detailed annotation text for a failed test
 */
function generateAnnotationDetails(scenario) {
  let details = `**Test Scenario:** ${scenario.scenario}\n`;
  details += `**Priority:** ${scenario.priority}\n`;
  details += `**Duration:** ${(scenario.duration / 1000).toFixed(2)}s\n\n`;
  
  details += `**Steps:**\n${scenario.steps}\n\n`;
  details += `**Expected Result:**\n${scenario.expected}\n\n`;
  
  if (scenario.actualResult) {
    details += `**Actual Result:**\n${scenario.actualResult}\n\n`;
  }
  
  if (scenario.error) {
    details += `**Error:**\n${scenario.error}\n\n`;
  }

  if (scenario.consoleLogs && scenario.consoleLogs.length > 0) {
    details += `**Console Logs:**\n`;
    scenario.consoleLogs.slice(0, 5).forEach(log => {
      details += `[${log.type}] ${log.text}\n`;
    });
    if (scenario.consoleLogs.length > 5) {
      details += `... and ${scenario.consoleLogs.length - 5} more logs\n`;
    }
    details += `\n`;
  }

  if (scenario.networkErrors && scenario.networkErrors.length > 0) {
    details += `**Network Errors:**\n`;
    scenario.networkErrors.forEach(err => {
      details += `- ${err.url}: ${err.failure}\n`;
    });
  }

  return details;
}

/**
 * Extract QA Pulse decision from AI analysis data.
 * Looks through raw AI response strings and structured data for Ship / Investigate / No-Go.
 */
function extractQAPulseDecision(aiData) {
  if (!aiData) return null;

  const searchTargets = [];
  if (typeof aiData === 'string') {
    searchTargets.push(aiData);
  } else {
    if (aiData.qaPulse?.decision) return normalizeDecision(aiData.qaPulse.decision);
    if (aiData.qa_pulse?.decision) return normalizeDecision(aiData.qa_pulse.decision);
    if (typeof aiData.raw === 'string') searchTargets.push(aiData.raw);
    if (typeof aiData.formatted === 'string') searchTargets.push(aiData.formatted);
    if (typeof aiData.analysis === 'string') searchTargets.push(aiData.analysis);
    searchTargets.push(JSON.stringify(aiData));
  }

  for (const text of searchTargets) {
    const match = text.match(/Decision[:\s|*]*\*{0,2}\s*(Ship\s*It!?|Investigate|No[- ]Go)/i);
    if (match) return normalizeDecision(match[1]);
  }
  return null;
}

function normalizeDecision(raw) {
  const lower = (raw || '').toLowerCase().trim();
  if (lower.startsWith('ship')) return 'ship';
  if (lower.startsWith('investigate')) return 'investigate';
  if (lower.includes('no') && lower.includes('go')) return 'no-go';
  return null;
}

const DECISION_TO_CONCLUSION = {
  'ship': 'success',
  'investigate': 'neutral',
  'no-go': 'action_required'
};

const DECISION_LABELS = {
  'ship': 'Ship It!',
  'investigate': 'Investigate',
  'no-go': 'No-Go'
};

/**
 * Create a GitHub Check Run for QA analysis results (non-blocking).
 * Separate from test-execution checks.
 */
async function createQAAnalysisCheck({ installationId, owner, repo, sha, decision, bugCount, analysisUrl }) {
  if (!installationId || !sha) {
    console.log('⏭️ Skipping QA analysis check: missing installationId or SHA');
    return null;
  }

  try {
    const octokit = await getOctokit(installationId);
    const conclusion = DECISION_TO_CONCLUSION[decision] || 'neutral';
    const label = DECISION_LABELS[decision] || 'Unknown';

    const bugLine = typeof bugCount === 'number' && bugCount > 0
      ? `\n**Bugs & Risks:** ${bugCount} identified`
      : '';

    const response = await octokit.checks.create({
      owner,
      repo,
      name: 'FirstQA — QA Analysis',
      head_sha: sha,
      status: 'completed',
      conclusion,
      completed_at: new Date().toISOString(),
      output: {
        title: `QA Pulse: ${label}`,
        summary: `**Decision:** ${label}${bugLine}\n\nSee the PR comment for the full analysis.`
      },
      details_url: analysisUrl || `${process.env.BASE_URL || 'http://localhost:3000'}/dashboard`
    });

    console.log(`✅ QA Analysis Check created: ${response.data.id} (${conclusion})`);
    return response.data.id;
  } catch (error) {
    console.error('⚠️ Failed to create QA analysis check (non-fatal):', error.message);
    return null;
  }
}

module.exports = {
  getOctokit,
  createCheckRun,
  updateCheckRunWithResults,
  updateCheckRunWithError,
  extractQAPulseDecision,
  createQAAnalysisCheck
};

