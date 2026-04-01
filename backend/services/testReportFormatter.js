/**
 * Test Report Formatter
 * Generates GitHub PR comments with test execution results
 */

const { generateVideoTimeline, calculateVideoDuration } = require('./videoService');

function generateTestReportComment(results, videoUrl, screenshotUrls = {}, manualScenarios = []) {
  const allPassed = results.failed === 0;
  const executed = results.scenarios.length;
  const passRate = executed > 0 ? Math.round((results.passed / executed) * 100) : 0;
  const duration = calculateVideoDuration(results);

  const verdict = allPassed
    ? (results.partial > 0 ? `🔶 ${results.passed}/${executed} Passed (${results.partial} need manual check)` : '✅ All Tests Passed')
    : `❌ ${results.failed}/${executed} Tests Failed`;

  let comment = `## 🤖 Ovi AI — Test Execution: ${verdict}\n\n`;
  comment += `**${results.passed}/${executed} passed** (${passRate}%) · ${duration} · Chromium`;
  if (videoUrl) {
    comment += ` · [Watch recording](${videoUrl})`;
  }
  comment += `\n\n`;

  // Results table — failures first, then partial, then passes
  const sorted = [...results.scenarios].sort((a, b) => {
    const order = { FAIL: 0, ERROR: 1, PARTIAL: 2, SKIP: 3, PASS: 4 };
    return (order[a.status] ?? 5) - (order[b.status] ?? 5);
  });

  comment += `| # | Scenario | Priority | Status | Duration | Evidence |\n`;
  comment += `|---|----------|----------|--------|----------|----------|\n`;

  sorted.forEach((s, i) => {
    const status = getStatusLabel(s.status);
    const dur = (s.duration / 1000).toFixed(1) + 's';
    const evidenceParts = [];
    if (screenshotUrls[s.scenario]) evidenceParts.push(`[IMG](${screenshotUrls[s.scenario]})`);
    if (videoUrl) evidenceParts.push(`[Video](${videoUrl})`);
    const evidence = evidenceParts.length > 0 ? evidenceParts.join(' · ') : '-';
    comment += `| ${i + 1} | ${s.scenario} | ${s.priority || '-'} | ${status} | ${dur} | ${evidence} |\n`;
  });

  comment += `\n`;

  // Partial pass details
  const partials = results.scenarios.filter(s => s.status === 'PARTIAL');
  if (partials.length > 0) {
    comment += `> 🔶 **Partial passes** — UI steps verified, but some aspects need manual checking:\n`;
    partials.forEach(s => {
      comment += `> - **${s.scenario}**: ${s.manualNote || s.manual_steps || 'Manual verification needed'}\n`;
    });
    comment += `\n`;
  }

  // Failed test details — collapsed
  const failures = results.scenarios.filter(s => s.status === 'FAIL' || s.status === 'ERROR');
  if (failures.length > 0) {
    comment += `<details>\n<summary><strong>❌ Failed Test Details (${failures.length})</strong></summary>\n\n`;

    failures.forEach(scenario => {
      comment += `### ${scenario.scenario}\n\n`;

      if (scenario.expected) comment += `**Expected:** ${scenario.expected}\n`;
      if (scenario.actualResult) comment += `**Actual:** ${scenario.actualResult}\n`;
      if (scenario.error) comment += `\n\`\`\`\n${scenario.error}\n\`\`\`\n`;

      const screenshotUrl = screenshotUrls[scenario.scenario];
      if (screenshotUrl) comment += `\n![${scenario.scenario}](${screenshotUrl})\n`;

      if (scenario.consoleLogs && scenario.consoleLogs.length > 0) {
        comment += `\n<details>\n<summary>Console Logs (${scenario.consoleLogs.length})</summary>\n\n\`\`\`\n`;
        scenario.consoleLogs.slice(0, 10).forEach(log => { comment += `[${log.type}] ${log.text}\n`; });
        if (scenario.consoleLogs.length > 10) comment += `... and ${scenario.consoleLogs.length - 10} more\n`;
        comment += `\`\`\`\n</details>\n`;
      }

      comment += `\n---\n\n`;
    });

    comment += `</details>\n\n`;
    comment += `> ⚠️ Some tests may fail due to authentication, missing test data, or environment differences. Review the details above for specifics.\n\n`;
  }

  // Manual testing section
  if (manualScenarios.length > 0) {
    comment += `<details>\n<summary><strong>📋 Manual Testing Required (${manualScenarios.length})</strong></summary>\n\n`;
    comment += `These scenarios scored below 70% for browser automation and need manual verification:\n\n`;
    comment += `| Scenario | Priority | Score | Reason |\n`;
    comment += `|----------|----------|-------|--------|\n`;
    manualScenarios.forEach(s => {
      comment += `| ${s.scenario} | ${s.priority || '-'} | ${s.browser_score}% | ${s.skip_reason || 'Not browser-testable'} |\n`;
    });
    comment += `\n</details>\n\n`;
  }

  comment += `<sub>🤖 Ovi AI · Browserbase + Playwright · [Dashboard](${process.env.BASE_URL || 'https://www.firstqa.dev'}/dashboard)</sub>\n`;

  return comment;
}

function getStatusLabel(status) {
  return {
    PASS: '✅ Pass',
    FAIL: '❌ Fail',
    ERROR: '⚠️ Error',
    PARTIAL: '🔶 Partial',
    SKIP: '⏭️ Skip',
    PENDING: '⏳'
  }[status] || '❓';
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

module.exports = { generateTestReportComment, generateQuickSummary };
