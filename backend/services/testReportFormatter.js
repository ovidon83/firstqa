/**
 * Test Report Formatter
 * Generates GitHub PR comments with test execution results
 */

const { generateVideoTimeline, calculateVideoDuration } = require('./videoService');
const { generateScreenshotMarkdown } = require('./screenshotService');

function generateTestReportComment(results, videoUrl, screenshotUrls = {}) {
  const allPassed = results.failed === 0;
  const passRate = Math.round((results.passed / results.totalTests) * 100);
  const duration = calculateVideoDuration(results);

  const verdict = allPassed ? '✅ All Tests Passed' : `❌ ${results.failed}/${results.totalTests} Tests Failed`;

  let comment = `## 🤖 Ovi AI — Test Execution: ${verdict}\n\n`;
  comment += `**${results.passed}/${results.totalTests} passed** (${passRate}%) · ${duration} · Chromium`;
  if (videoUrl) {
    comment += ` · [Watch recording](${videoUrl})`;
  }
  comment += `\n\n`;

  // Single results table — failures first, then passes
  const sorted = [...results.scenarios].sort((a, b) => {
    const order = { FAIL: 0, ERROR: 1, SKIP: 2, PASS: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4);
  });

  comment += `| # | Scenario | Priority | Status | Duration | Screenshot |\n`;
  comment += `|---|----------|----------|--------|----------|------------|\n`;

  sorted.forEach((s, i) => {
    const status = getStatusEmoji(s.status);
    const dur = (s.duration / 1000).toFixed(1) + 's';
    const screenshot = screenshotUrls[s.scenario] ? `[View](${screenshotUrls[s.scenario]})` : '-';
    comment += `| ${i + 1} | ${s.scenario} | ${s.priority || '-'} | ${status} | ${dur} | ${screenshot} |\n`;
  });

  comment += `\n`;

  // Failed test details — collapsed
  const failures = results.scenarios.filter(s => s.status === 'FAIL' || s.status === 'ERROR');
  if (failures.length > 0) {
    comment += `<details>\n<summary><strong>❌ Failed Test Details (${failures.length})</strong></summary>\n\n`;

    const timeline = videoUrl ? generateVideoTimeline(results) : null;

    failures.forEach(scenario => {
      comment += `### ${scenario.scenario}\n\n`;

      if (scenario.expected) {
        comment += `**Expected:** ${scenario.expected}\n`;
      }
      if (scenario.actualResult) {
        comment += `**Actual:** ${scenario.actualResult}\n`;
      }
      if (scenario.error) {
        comment += `\n\`\`\`\n${scenario.error}\n\`\`\`\n`;
      }

      if (timeline) {
        const t = timeline.find(t => t.scenario === scenario.scenario);
        if (t) {
          comment += `\n[▶️ Jump to ${t.formattedStartTime} in video](${videoUrl}#t=${Math.floor(t.startTime)})\n`;
        }
      }

      const screenshotUrl = screenshotUrls[scenario.scenario];
      if (screenshotUrl) {
        comment += `\n${generateScreenshotMarkdown(screenshotUrl, scenario.scenario)}`;
      }

      if (scenario.consoleLogs && scenario.consoleLogs.length > 0) {
        comment += `\n<details>\n<summary>Console Logs (${scenario.consoleLogs.length})</summary>\n\n\`\`\`\n`;
        scenario.consoleLogs.slice(0, 10).forEach(log => {
          comment += `[${log.type}] ${log.text}\n`;
        });
        if (scenario.consoleLogs.length > 10) {
          comment += `... and ${scenario.consoleLogs.length - 10} more\n`;
        }
        comment += `\`\`\`\n</details>\n`;
      }

      if (scenario.networkErrors && scenario.networkErrors.length > 0) {
        comment += `\n<details>\n<summary>Network Errors (${scenario.networkErrors.length})</summary>\n\n\`\`\`\n`;
        scenario.networkErrors.forEach(err => {
          comment += `${err.url} — ${err.failure}\n`;
        });
        comment += `\`\`\`\n</details>\n`;
      }

      comment += `\n---\n\n`;
    });

    comment += `</details>\n\n`;

    comment += `> ⚠️ If tests failed due to login or missing test data, ensure your environment has the required accounts. Configure \`TEST_USER_EMAIL\` / \`TEST_USER_PASSWORD\` if login is needed.\n\n`;
  }

  comment += `<sub>🤖 Ovi AI · Playwright · [Dashboard](${process.env.BASE_URL || 'https://www.firstqa.dev'}/dashboard)</sub>\n`;

  return comment;
}

function getStatusEmoji(status) {
  return { PASS: '✅', FAIL: '❌', ERROR: '⚠️', SKIP: '⏭️', PENDING: '⏳' }[status] || '❓';
}

function generateQuickSummary(results) {
  const emoji = results.failed === 0 ? '✅' : '❌';
  let comment = `## ${emoji} Ovi AI Test Results\n\n`;
  comment += `**${results.passed}/${results.totalTests} tests passed**\n\n`;

  if (results.failed > 0) {
    comment += `Failed tests:\n`;
    results.scenarios
      .filter(s => s.status === 'FAIL' || s.status === 'ERROR')
      .forEach(s => { comment += `- ${s.scenario}\n`; });
  }

  return comment;
}

module.exports = {
  generateTestReportComment,
  generateQuickSummary
};
