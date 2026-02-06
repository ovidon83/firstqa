/**
 * Test Report Formatter
 * Generates rich GitHub comments with test results, videos, and screenshots
 */

const { generateVideoTimeline, generateVideoMarkdown, calculateVideoDuration } = require('./videoService');
const { generateScreenshotMarkdown } = require('./screenshotService');

/**
 * Generate a comprehensive test report as a GitHub comment
 */
function generateTestReportComment(results, videoUrl, screenshotUrls = {}) {
  const passed = results.failed === 0;
  const passRate = Math.round((results.passed / results.totalTests) * 100);
  const duration = calculateVideoDuration(results);

  let comment = `## 🤖 Ovi AI - Automated Test Execution Results\n\n`;
  
  // Header with badge
  if (passed) {
    comment += `![All Tests Passed](https://img.shields.io/badge/tests-passing-brightgreen) `;
  } else {
    comment += `![Tests Failed](https://img.shields.io/badge/tests-failing-red) `;
  }
  comment += `![Pass Rate](https://img.shields.io/badge/pass_rate-${passRate}%25-${passRate >= 80 ? 'green' : passRate >= 60 ? 'yellow' : 'red'})\n\n`;

  comment += `**Test Run:** #${results.executionId.substring(0, 8)} | `;
  comment += `**Duration:** ${duration} | `;
  comment += `**Browser:** Chromium\n\n`;

  // Summary table
  comment += `### Summary\n\n`;
  comment += `| Status | Count | Percentage |\n`;
  comment += `|--------|-------|------------|\n`;
  comment += `| ✅ **Passed** | ${results.passed} | ${Math.round((results.passed / results.totalTests) * 100)}% |\n`;
  comment += `| ❌ **Failed** | ${results.failed} | ${Math.round((results.failed / results.totalTests) * 100)}% |\n`;
  comment += `| ⏭️ **Skipped** | ${results.skipped} | ${Math.round((results.skipped / results.totalTests) * 100)}% |\n`;
  comment += `| **Total** | **${results.totalTests}** | 100% |\n\n`;

  // Video section
  if (videoUrl) {
    const timeline = generateVideoTimeline(results);
    comment += generateVideoMarkdown(videoUrl, timeline, false);
    comment += `\n`;
  }

  // Detailed results by priority
  comment += `---\n\n`;
  comment += generateTestResultsByPriority(results, screenshotUrls);

  // Failed tests details
  if (results.failed > 0) {
    comment += `---\n\n`;
    comment += generateFailedTestDetails(results, screenshotUrls, videoUrl);
  }

  // Test coverage visualization
  comment += `---\n\n`;
  comment += generateTestCoverageChart(results);

  // Recommendations
  comment += `\n`;
  comment += generateRecommendations(results);

  // Note about test data / environment when tests fail
  if (results.failed > 0 || results.scenarios.some(s => s.status === 'ERROR')) {
    comment += `\n---\n\n`;
    comment += `> ⚠️ **If tests failed** due to login, missing test data, or environment setup: ensure your staging environment has the required test accounts and seed data. FirstQA does not inject credentials—configure \`TEST_USER_EMAIL\` / \`TEST_USER_PASSWORD\` if login is needed.\n`;
  }

  // Footer
  comment += `\n---\n\n`;
  comment += `<sub>🤖 Automated by Ovi AI • [Test Configuration](${process.env.BASE_URL || 'http://localhost:3000'}/dashboard) • Powered by Playwright</sub>\n`;

  return comment;
}

/**
 * Generate test results grouped by priority
 */
function generateTestResultsByPriority(results, screenshotUrls) {
  let output = `## Test Results by Priority\n\n`;

  const priorities = ['Happy Path', 'Critical Path', 'Edge Case', 'Regression'];
  
  for (const priority of priorities) {
    const scenarios = results.scenarios.filter(s => s.priority === priority);
    if (scenarios.length === 0) continue;

    const passed = scenarios.filter(s => s.status === 'PASS').length;
    const total = scenarios.length;
    const emoji = getEmojiForPriority(priority);

    output += `### ${emoji} ${priority} Tests (${passed}/${total} passed)\n\n`;
    output += `| Scenario | Status | Duration | Screenshot |\n`;
    output += `|----------|--------|----------|------------|\n`;

    for (const scenario of scenarios) {
      const statusEmoji = getStatusEmoji(scenario.status);
      const duration = (scenario.duration / 1000).toFixed(1) + 's';
      const screenshotUrl = screenshotUrls[scenario.scenario] || null;
      const screenshotLink = screenshotUrl ? `[📸 View](${screenshotUrl})` : '-';
      
      output += `| ${scenario.scenario} | ${statusEmoji} ${scenario.status} | ${duration} | ${screenshotLink} |\n`;
    }

    output += `\n`;
  }

  return output;
}

/**
 * Generate detailed information for failed tests
 */
function generateFailedTestDetails(results, screenshotUrls, videoUrl) {
  let output = `## ❌ Failed Test Details\n\n`;

  const failedTests = results.scenarios.filter(s => s.status === 'FAIL' || s.status === 'ERROR');
  const timeline = videoUrl ? generateVideoTimeline(results) : null;

  failedTests.forEach((scenario, index) => {
    const anchorId = `fail-${index + 1}`;
    output += `### <a name="${anchorId}"></a>🐛 ${scenario.scenario}\n\n`;
    
    output += `**Priority:** ${scenario.priority}\n`;
    output += `**Duration:** ${(scenario.duration / 1000).toFixed(2)}s\n\n`;

    output += `#### Expected Result\n`;
    output += `${scenario.expected}\n\n`;

    if (scenario.actualResult) {
      output += `#### Actual Result\n`;
      output += `${scenario.actualResult}\n\n`;
    }

    if (scenario.error) {
      output += `#### Error Message\n`;
      output += `\`\`\`\n${scenario.error}\n\`\`\`\n\n`;
    }

    output += `#### Steps to Reproduce\n`;
    output += `${scenario.steps}\n\n`;

    // Screenshot
    const screenshotUrl = screenshotUrls[scenario.scenario];
    if (screenshotUrl) {
      output += `#### Screenshot\n`;
      output += generateScreenshotMarkdown(screenshotUrl, scenario.scenario);
      output += `\n`;
    }

    // Video timestamp
    if (timeline) {
      const timelineItem = timeline.find(t => t.scenario === scenario.scenario);
      if (timelineItem) {
        output += `#### Video\n`;
        output += `[▶️ Watch this test at ${timelineItem.formattedStartTime}](${videoUrl}#t=${Math.floor(timelineItem.startTime)})\n\n`;
      }
    }

    // Console logs
    if (scenario.consoleLogs && scenario.consoleLogs.length > 0) {
      output += `<details>\n<summary>📋 Console Logs (${scenario.consoleLogs.length})</summary>\n\n`;
      output += `\`\`\`\n`;
      scenario.consoleLogs.slice(0, 10).forEach(log => {
        output += `[${log.type}] ${log.text}\n`;
      });
      if (scenario.consoleLogs.length > 10) {
        output += `... and ${scenario.consoleLogs.length - 10} more logs\n`;
      }
      output += `\`\`\`\n</details>\n\n`;
    }

    // Network errors
    if (scenario.networkErrors && scenario.networkErrors.length > 0) {
      output += `<details>\n<summary>🌐 Network Errors (${scenario.networkErrors.length})</summary>\n\n`;
      output += `\`\`\`\n`;
      scenario.networkErrors.forEach(err => {
        output += `${err.url}\n  Error: ${err.failure}\n`;
      });
      output += `\`\`\`\n</details>\n\n`;
    }

    output += `---\n\n`;
  });

  return output;
}

/**
 * Generate ASCII-style test coverage chart
 */
function generateTestCoverageChart(results) {
  let output = `## 📊 Test Coverage by Priority\n\n`;
  output += `\`\`\`\n`;

  const priorities = ['Happy Path', 'Critical Path', 'Edge Case', 'Regression'];
  
  for (const priority of priorities) {
    const scenarios = results.scenarios.filter(s => s.priority === priority);
    if (scenarios.length === 0) continue;

    const passed = scenarios.filter(s => s.status === 'PASS').length;
    const percentage = Math.round((passed / scenarios.length) * 100);
    const barLength = Math.round(percentage / 5); // 20 chars = 100%
    
    const bar = '█'.repeat(barLength) + '░'.repeat(20 - barLength);
    const label = priority.padEnd(15);
    
    output += `${label} ${bar} ${percentage}% (${passed}/${scenarios.length})\n`;
  }

  output += `\`\`\`\n`;
  return output;
}

/**
 * Generate actionable recommendations based on test results
 */
function generateRecommendations(results) {
  let output = `## 💡 Recommendations\n\n`;

  const failedTests = results.scenarios.filter(s => s.status === 'FAIL' || s.status === 'ERROR');
  const failedHappyPath = failedTests.filter(s => s.priority === 'Happy Path');
  const failedCriticalPath = failedTests.filter(s => s.priority === 'Critical Path');

  if (failedTests.length === 0) {
    output += `✅ **All tests passed!** This PR is ready for review and merge.\n\n`;
    output += `- All test scenarios executed successfully\n`;
    output += `- No critical issues detected\n`;
    output += `- Code changes appear stable\n`;
  } else {
    if (failedHappyPath.length > 0) {
      output += `🚨 **CRITICAL:** ${failedHappyPath.length} Happy Path test(s) failed. These are core functionality issues that should be fixed before merging.\n\n`;
    }
    
    if (failedCriticalPath.length > 0) {
      output += `⚠️ **IMPORTANT:** ${failedCriticalPath.length} Critical Path test(s) failed. These scenarios should be reviewed carefully.\n\n`;
    }

    output += `**Recommended Actions:**\n`;
    
    if (failedHappyPath.length > 0) {
      output += `1. ❌ **Do not merge** until Happy Path tests pass\n`;
    }
    
    output += `2. Review failed test details above\n`;
    output += `3. Watch the video recordings to understand failures\n`;
    output += `4. Fix identified issues and push new commits\n`;
    output += `5. Tests will automatically re-run on new commits\n`;
  }

  return output;
}

/**
 * Get emoji for priority level
 */
function getEmojiForPriority(priority) {
  const emojiMap = {
    'Happy Path': '🎯',
    'Critical Path': '🔍',
    'Edge Case': '🧪',
    'Regression': '🔄'
  };
  return emojiMap[priority] || '📋';
}

/**
 * Get emoji for test status
 */
function getStatusEmoji(status) {
  const emojiMap = {
    'PASS': '✅',
    'FAIL': '❌',
    'ERROR': '⚠️',
    'SKIP': '⏭️',
    'PENDING': '⏳'
  };
  return emojiMap[status] || '❓';
}

/**
 * Generate a quick summary comment (for when full report is too long)
 */
function generateQuickSummary(results) {
  const passed = results.failed === 0;
  const emoji = passed ? '✅' : '❌';
  
  let comment = `## ${emoji} Ovi AI Test Results\n\n`;
  comment += `**${results.passed}/${results.totalTests} tests passed**\n\n`;
  
  if (!passed) {
    comment += `Failed tests:\n`;
    results.scenarios
      .filter(s => s.status === 'FAIL' || s.status === 'ERROR')
      .forEach(s => {
        comment += `- ${s.scenario}\n`;
      });
  }
  
  return comment;
}

module.exports = {
  generateTestReportComment,
  generateQuickSummary,
  generateTestResultsByPriority,
  generateFailedTestDetails,
  generateTestCoverageChart,
  generateRecommendations
};

