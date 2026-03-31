/**
 * AI-Powered Test Executor
 * Uses Browserbase cloud browsers + accessibility-tree agent loop.
 * Each test step is resolved at runtime via the a11y tree, not pre-generated CSS selectors.
 */

const { chromium } = require('playwright-core');
const Browserbase = require('@browserbasehq/sdk').default;
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const MAX_AGENT_STEPS = 15;
const ACTION_TIMEOUT = 10000;
const SCENARIO_TIMEOUT = 60000;

/**
 * Flatten the accessibility tree into a compact text representation.
 * Only includes interactive / meaningful nodes to stay within token budget.
 */
function flattenA11yTree(node, depth = 0) {
  if (!node) return '';
  const indent = '  '.repeat(depth);
  const parts = [];

  const dominated = ['generic', 'none', 'presentation'];
  const dominated_skip = !node.name && dominated.includes(node.role);

  if (!dominated_skip) {
    let line = `${indent}[${node.role}]`;
    if (node.name) line += ` "${node.name}"`;
    if (node.value) line += ` value="${node.value}"`;
    if (node.checked !== undefined) line += ` checked=${node.checked}`;
    if (node.selected !== undefined) line += ` selected=${node.selected}`;
    if (node.disabled) line += ` disabled`;
    if (node.expanded !== undefined) line += ` expanded=${node.expanded}`;
    parts.push(line);
  }

  if (node.children) {
    for (const child of node.children) {
      parts.push(flattenA11yTree(child, dominated_skip ? depth : depth + 1));
    }
  }

  return parts.filter(Boolean).join('\n');
}

/**
 * Ask the AI what single action to take given the a11y tree and current step.
 */
async function decideNextAction(a11yText, currentStep, expectedResult, pageUrl, stepIndex, totalSteps) {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `You are a browser automation agent. You see the accessibility tree of a web page and must perform one action at a time to complete a test step.

Return ONLY a JSON object with one action:
{
  "action": "click" | "fill" | "select" | "navigate" | "scroll" | "press" | "done",
  "role": "button" | "link" | "textbox" | "combobox" | "checkbox" | ...,
  "name": "exact accessible name from the tree",
  "value": "text to type or option to select (for fill/select/press)",
  "url": "relative or absolute URL (for navigate only)",
  "reasoning": "one sentence explaining why"
}

Rules:
- Use "done" when the current step's actions are complete and you should move to the next step.
- For "fill", set role+name to identify the input, and value to the text.
- For "select" (dropdowns), set role to "combobox", name to identify it, value to the option text.
- For "press", set value to the key name (e.g. "Enter", "Tab").
- For "navigate", only set url. Use relative paths.
- Match names EXACTLY as they appear in the tree (case-sensitive).
- If the element is not in the tree, use "done" with reasoning explaining it wasn't found.`
      },
      {
        role: 'user',
        content: `Current URL: ${pageUrl}
Step ${stepIndex}/${totalSteps}: ${currentStep}
Expected result: ${expectedResult}

Accessibility tree:
${a11yText.substring(0, 8000)}`
      }
    ],
    temperature: 0.1,
    response_format: { type: 'json_object' }
  });

  return JSON.parse(response.choices[0].message.content);
}

/**
 * Execute a single action returned by the AI agent.
 */
async function executeAgentAction(page, action, baseUrl) {
  const { action: type, role, name, value, url } = action;

  switch (type) {
    case 'navigate': {
      const target = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT });
      break;
    }
    case 'click': {
      const locator = page.getByRole(role, { name, exact: false });
      await locator.first().click({ timeout: ACTION_TIMEOUT });
      break;
    }
    case 'fill': {
      const locator = page.getByRole(role || 'textbox', { name, exact: false });
      await locator.first().fill(value || '', { timeout: ACTION_TIMEOUT });
      break;
    }
    case 'select': {
      const locator = page.getByRole(role || 'combobox', { name, exact: false });
      await locator.first().selectOption({ label: value }, { timeout: ACTION_TIMEOUT });
      break;
    }
    case 'scroll': {
      if (role && name) {
        const locator = page.getByRole(role, { name, exact: false });
        await locator.first().scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
      } else {
        await page.evaluate(() => window.scrollBy(0, 400));
      }
      break;
    }
    case 'press': {
      await page.keyboard.press(value || 'Enter');
      break;
    }
    case 'done':
      break;
    default:
      console.warn(`      ⚠️ Unknown agent action: ${type}`);
  }
}

/**
 * Run the agent loop for a single scenario.
 * Splits the steps string into individual steps, then for each step
 * repeatedly asks the AI for the next action until it says "done".
 */
async function runScenarioAgent(page, scenario, baseUrl) {
  const stepsRaw = scenario.steps || '';
  const individualSteps = stepsRaw
    .split(/\d+\.\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (individualSteps.length === 0) {
    individualSteps.push(stepsRaw);
  }

  const actionLog = [];

  for (let si = 0; si < individualSteps.length; si++) {
    const step = individualSteps[si];
    let attempts = 0;

    while (attempts < MAX_AGENT_STEPS) {
      attempts++;

      await page.waitForLoadState('domcontentloaded').catch(() => {});

      const a11ySnapshot = await page.accessibility.snapshot();
      const a11yText = flattenA11yTree(a11ySnapshot);

      const decision = await decideNextAction(
        a11yText, step, scenario.expected,
        page.url(), si + 1, individualSteps.length
      );

      const logEntry = `Step ${si + 1}.${attempts}: ${decision.action} ${decision.role || ''} "${decision.name || ''}" ${decision.value || ''} — ${decision.reasoning || ''}`;
      actionLog.push(logEntry);
      console.log(`      → ${logEntry}`);

      if (decision.action === 'done') break;

      await executeAgentAction(page, decision, baseUrl);

      await page.waitForTimeout(500);
    }
  }

  return actionLog;
}

/**
 * Verify expected result using AI + a11y tree + visible text.
 */
async function verifyExpectedResult(page, expectedResult, manualSteps) {
  try {
    const a11ySnapshot = await page.accessibility.snapshot();
    const a11yText = flattenA11yTree(a11ySnapshot);
    const visibleText = await page.evaluate(() => document.body.innerText).catch(() => '');

    const prompt = `You are verifying a browser test result.

Expected Result:
${expectedResult}

Current page URL: ${page.url()}
Page title: ${await page.title().catch(() => 'unknown')}

Accessibility tree (truncated):
${a11yText.substring(0, 4000)}

Visible text (truncated):
${visibleText.substring(0, 2000)}

${manualSteps ? `Note: These aspects CANNOT be verified in the browser and should be ignored for pass/fail: ${manualSteps}` : ''}

Evaluate ONLY what is visible in the browser. If the expected result mentions things that cannot be checked in a browser (email delivery, database state, server logs), mark those as "unverifiable" but do NOT fail the test for them.

Return JSON:
{
  "passed": true/false,
  "partial": true/false (true if UI looks correct but some verification is non-browser),
  "reason": "brief explanation",
  "actualResult": "what the browser shows",
  "unverifiable": "aspects that need manual checking (empty string if none)"
}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: 'You are a QA engineer verifying browser test results. Return only valid JSON.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error verifying result:', error.message);
    return { passed: false, partial: false, reason: `Verification error: ${error.message}`, actualResult: 'Unable to verify', unverifiable: '' };
  }
}

/**
 * Main entry point — execute test recipe via Browserbase + a11y agent.
 */
async function executeTestRecipe(testRecipe, baseUrl, options = {}) {
  const { takeScreenshots = true, timeout = SCENARIO_TIMEOUT } = options;

  const executionId = uuidv4();
  const resultsDir = path.join(__dirname, '..', '..', 'test-results', executionId);
  await fs.mkdir(resultsDir, { recursive: true });

  console.log(`🎬 Starting test execution: ${executionId}`);
  console.log(`📍 Base URL: ${baseUrl}`);
  console.log(`📋 Test scenarios: ${testRecipe.length}`);

  let browser, session, sessionId;
  const useBrowserbase = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);

  if (useBrowserbase) {
    const bb = new Browserbase({ apiKey: process.env.BROWSERBASE_API_KEY });
    session = await bb.sessions.create({ projectId: process.env.BROWSERBASE_PROJECT_ID });
    sessionId = session.id;
    console.log(`☁️  Browserbase session: ${sessionId}`);
    browser = await chromium.connectOverCDP(session.connectUrl);
  } else {
    console.log('⚠️  No BROWSERBASE_API_KEY — falling back to local Chromium');
    browser = await chromium.launch({ headless: true, args: ['--disable-web-security'] });
  }

  const context = browser.contexts()[0] || await browser.newContext({
    viewport: { width: 1280, height: 720 },
    ignoreHTTPSErrors: true
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(timeout);

  const results = {
    executionId,
    baseUrl,
    startTime: new Date().toISOString(),
    endTime: null,
    duration: 0,
    totalTests: testRecipe.length,
    passed: 0,
    failed: 0,
    skipped: 0,
    partial: 0,
    scenarios: [],
    sessionReplayUrl: sessionId
      ? `https://www.browserbase.com/sessions/${sessionId}`
      : null,
    resultsDir
  };

  try {
    for (let i = 0; i < testRecipe.length; i++) {
      const scenario = testRecipe[i];
      const scenarioStartTime = Date.now();

      console.log(`\n🧪 Test ${i + 1}/${testRecipe.length}: ${scenario.scenario}`);
      console.log(`   Priority: ${scenario.priority || 'N/A'} · Score: ${scenario.browser_score ?? 'N/A'}`);

      const scenarioResult = {
        scenario: scenario.scenario,
        priority: scenario.priority || 'Unknown',
        browser_score: scenario.browser_score,
        manual_steps: scenario.manual_steps || '',
        status: 'PENDING',
        duration: 0,
        steps: scenario.steps,
        expected: scenario.expected,
        actualResult: null,
        error: null,
        screenshotPath: null,
        actionLog: [],
        consoleLogs: [],
        networkErrors: []
      };

      const consoleHandler = msg => {
        scenarioResult.consoleLogs.push({ type: msg.type(), text: msg.text() });
      };
      const requestFailedHandler = request => {
        scenarioResult.networkErrors.push({ url: request.url(), failure: request.failure()?.errorText });
      };
      page.on('console', consoleHandler);
      page.on('requestfailed', requestFailedHandler);

      try {
        const actionLog = await runScenarioAgent(page, scenario, baseUrl);
        scenarioResult.actionLog = actionLog;

        const verification = await verifyExpectedResult(page, scenario.expected, scenario.manual_steps);
        scenarioResult.actualResult = verification.actualResult;

        if (verification.passed) {
          if (verification.partial || scenario.manual_steps) {
            scenarioResult.status = 'PARTIAL';
            scenarioResult.manualNote = verification.unverifiable || scenario.manual_steps;
            results.partial++;
            results.passed++;
            console.log(`   🔶 PARTIAL — UI verified, manual check needed: ${scenarioResult.manualNote}`);
          } else {
            scenarioResult.status = 'PASS';
            results.passed++;
            console.log(`   ✅ PASS`);
          }
        } else {
          scenarioResult.status = 'FAIL';
          scenarioResult.error = verification.reason;
          results.failed++;
          console.log(`   ❌ FAIL: ${verification.reason}`);
        }
      } catch (error) {
        scenarioResult.status = 'ERROR';
        scenarioResult.error = error.message;
        results.failed++;
        console.log(`   ❌ ERROR: ${error.message}`);
      }

      page.removeListener('console', consoleHandler);
      page.removeListener('requestfailed', requestFailedHandler);

      if (takeScreenshots) {
        try {
          const screenshotPath = path.join(resultsDir, 'screenshots', `scenario-${i + 1}-${scenarioResult.status}.png`);
          await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
          await page.screenshot({ path: screenshotPath, fullPage: true });
          scenarioResult.screenshotPath = screenshotPath;
          console.log(`   📸 Screenshot saved`);
        } catch (ssErr) {
          console.warn(`   ⚠️ Screenshot failed: ${ssErr.message}`);
        }
      }

      scenarioResult.duration = Date.now() - scenarioStartTime;
      results.scenarios.push(scenarioResult);

      await page.waitForTimeout(500).catch(() => {});
    }
  } catch (error) {
    console.error('❌ Test execution error:', error);
  } finally {
    await browser.close().catch(() => {});

    results.endTime = new Date().toISOString();
    results.duration = new Date(results.endTime) - new Date(results.startTime);

    const resultsPath = path.join(resultsDir, 'results.json');
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));

    console.log(`\n✅ Test execution complete:`);
    console.log(`   Total: ${results.totalTests}`);
    console.log(`   Passed: ${results.passed} (${results.partial} partial)`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Duration: ${Math.round(results.duration / 1000)}s`);
    if (results.sessionReplayUrl) {
      console.log(`   🎥 Session replay: ${results.sessionReplayUrl}`);
    }
  }

  return results;
}

module.exports = { executeTestRecipe };
