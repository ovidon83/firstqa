/**
 * AI-Powered Test Executor — Stagehand Agent Mode
 * Uses Browserbase cloud browsers + Stagehand's autonomous agent for intelligent
 * browser automation. The agent navigates, adapts to unexpected UI states, and
 * figures out intermediate steps on its own.
 */

const { Stagehand } = require('@browserbasehq/stagehand');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let _openai;
function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const MAX_AGENT_STEPS = 25;
const ACTION_TIMEOUT = 10000;
const SCENARIO_TIMEOUT = 90000;

// ─── Start URL resolution (deterministic, no AI call) ───────────────────────

const ROUTE_KEYWORDS = ['hire', 'login', 'signin', 'signup', 'register', 'contact', 'dashboard', 'settings', 'profile', 'pricing', 'checkout', 'cart', 'search', 'about', 'faq', 'help', 'billing', 'onboarding', 'invite', 'drafts', 'analytics', 'admin', 'home'];

function extractPathFromScenario(scenario) {
  const text = `${scenario.scenario} ${scenario.steps} ${scenario.expected}`;

  const cleanText = text.replace(/https?:\/\/[^\s'"]+/g, '');

  const pathMatch = cleanText.match(/\/([a-z][a-z0-9-/]*)/i);
  if (pathMatch) return `/${pathMatch[1].toLowerCase()}`;

  const name = scenario.scenario.toLowerCase();
  for (const kw of ROUTE_KEYWORDS) {
    if (name.includes(kw)) return `/${kw}`;
  }

  return null;
}

function resolveStartUrls(testRecipe, baseUrl) {
  const paths = testRecipe.map(s => extractPathFromScenario(s));

  const counts = {};
  paths.forEach(p => { if (p) counts[p] = (counts[p] || 0) + 1; });
  const fallback = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || '/';

  return paths.map(p => {
    const resolved = p || fallback;
    return `${baseUrl}${resolved}`;
  });
}

// ─── Auto-login helper (deterministic Playwright — no AI calls) ─────────────

async function attemptAutoLogin(page, credentials, baseUrl) {
  const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');

  const hasLoginForm = /\b(log\s*in|sign\s*in|password)\b/i.test(pageText) &&
    /\b(email|username)\b/i.test(pageText);

  if (!hasLoginForm) {
    const loginLink = page.getByRole('link', { name: /log\s*in|sign\s*in/i }).first();
    if (await loginLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      console.log(`   🔐 Clicking login link on landing page...`);
      await loginLink.click();
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      const text2 = await page.evaluate(() => document.body.innerText).catch(() => '');
      if (!/\b(password)\b/i.test(text2)) return false;
    } else {
      return false;
    }
  }

  try {
    const emailField =
      page.getByLabel(/email/i).first() ||
      page.getByPlaceholder(/email/i).first() ||
      page.locator('input[type="email"]').first();

    if (await emailField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailField.clear();
      await emailField.fill(credentials.email);
      console.log(`   📧 Filled email: ${credentials.email}`);
    } else {
      console.log(`   ⚠️ Could not find email field`);
      return false;
    }

    const passwordField =
      page.getByLabel(/password/i).first() ||
      page.locator('input[type="password"]').first();

    if (await passwordField.isVisible({ timeout: 2000 }).catch(() => false)) {
      await passwordField.clear();
      await passwordField.fill(credentials.password);
      console.log(`   🔑 Filled password`);
    } else {
      console.log(`   ⚠️ Could not find password field`);
      return false;
    }

    const submitSelectors = [
      page.getByRole('button', { name: /^(continue|sign\s*in|log\s*in|submit|enter)$/i }).first(),
      page.locator('button[type="submit"]').first(),
      page.locator('form button:not([data-provider])').last()
    ];

    let clicked = false;
    for (const btn of submitSelectors) {
      try {
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          const btnText = await btn.textContent().catch(() => '');
          if (/google|github|facebook|apple|microsoft|twitter|sso/i.test(btnText)) continue;
          await btn.click();
          console.log(`   🔘 Clicked submit: "${btnText.trim()}"`);
          clicked = true;
          break;
        }
      } catch (_) { continue; }
    }

    if (!clicked) {
      await passwordField.press('Enter');
      console.log(`   ⏎ Pressed Enter to submit`);
    }
  } catch (err) {
    console.warn(`   ⚠️ Login form interaction failed: ${err.message}`);
    return false;
  }

  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  const postText = await page.evaluate(() => document.body.innerText).catch(() => '');
  const stillOnLogin = /\b(sign\s*in|log\s*in)\b/i.test(postText) &&
    /\b(password)\b/i.test(postText);

  return !stillOnLogin;
}

// ─── Scenario instruction builder ───────────────────────────────────────────

function buildScenarioInstruction(scenario, agentContext) {
  let instruction = `Execute this test scenario: "${scenario.scenario}"\n\n`;
  instruction += `Steps (use as guidance — adapt if the page requires different navigation or intermediate actions):\n${scenario.steps}\n\n`;
  instruction += `Expected result to verify:\n${scenario.expected}\n\n`;
  instruction += `After completing all steps, stay on the final page so we can verify the results.\n`;

  if (agentContext) {
    instruction += `\nContext:\n${agentContext}\n`;
  }

  return instruction;
}

// ─── Verification (separate AI call for structured pass/fail) ───────────────

async function verifyExpectedResult(page, expectedResult, manualSteps) {
  try {
    const visibleText = await page.evaluate(() => document.body.innerText).catch(() => '');
    const pageUrl = page.url();
    const pageTitle = await page.title().catch(() => 'unknown');

    const prompt = `You are verifying a browser test result.

Expected Result:
${expectedResult}

Current page URL: ${pageUrl}
Page title: ${pageTitle}

Visible text (truncated):
${visibleText.substring(0, 3000)}

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

    const response = await getOpenAI().chat.completions.create({
      model: process.env.VERIFICATION_MODEL || 'gpt-4o-mini',
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

// ─── Main entry point ───────────────────────────────────────────────────────

async function executeTestRecipe(testRecipe, baseUrl, options = {}) {
  const { takeScreenshots = true, timeout = SCENARIO_TIMEOUT, userContext = null, testCredentials = null } = options;

  const executionId = uuidv4();
  const resultsDir = path.join(__dirname, '..', '..', 'test-results', executionId);
  await fs.mkdir(resultsDir, { recursive: true });

  console.log(`🎬 Starting test execution (Stagehand Agent): ${executionId}`);
  console.log(`📍 Base URL: ${baseUrl}`);
  console.log(`📋 Test scenarios: ${testRecipe.length}`);

  const startUrls = resolveStartUrls(testRecipe, baseUrl);
  console.log(`🧭 Start URLs: ${startUrls.map((u, i) => `\n   ${i + 1}. ${u}`).join('')}`);

  const useBrowserbase = !!(process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID);
  const agentModel = process.env.TEST_EXECUTION_MODEL || 'openai/gpt-4o-mini';

  let stagehand;
  try {
    stagehand = new Stagehand({
      env: useBrowserbase ? 'BROWSERBASE' : 'LOCAL',
      enableCaching: true,
    });
    await stagehand.init();
  } catch (initErr) {
    console.error(`❌ Stagehand init failed: ${initErr.message}`);
    throw initErr;
  }

  const page = stagehand.context.pages()[0];
  const sessionId = stagehand.browserbaseSessionID;

  if (useBrowserbase) {
    console.log(`☁️  Browserbase session: ${sessionId || 'unknown'}`);
  } else {
    console.log('⚠️  Running locally (no Browserbase)');
  }
  console.log(`🤖 Agent model: ${agentModel}`);

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

  let agentContext = null;
  const contextParts = [];
  if (testCredentials && testCredentials.email) {
    contextParts.push(`Test account credentials — Email: ${testCredentials.email}, Password: ${testCredentials.password}. Use these when a login or sign-up form is encountered.`);
  }
  if (userContext) {
    contextParts.push(userContext);
  }
  if (contextParts.length > 0) {
    agentContext = contextParts.join('\n');
    console.log(`📋 Agent context provided (${contextParts.length} part${contextParts.length > 1 ? 's' : ''})`);
  }

  // Pre-login with deterministic Playwright (fast, free, reliable)
  let isLoggedIn = false;
  if (testCredentials && testCredentials.email) {
    try {
      console.log(`🔐 Attempting pre-login with ${testCredentials.email}...`);
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT }).catch(() => {});
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

      isLoggedIn = await attemptAutoLogin(page, testCredentials, baseUrl);
      if (isLoggedIn) {
        console.log(`✅ Pre-login successful`);
      } else {
        console.log(`ℹ️ Pre-login skipped — no login form detected or login not needed`);
      }
    } catch (err) {
      console.warn(`⚠️ Pre-login failed: ${err.message}`);
    }
  }

  const agentSystemPrompt = `You are a senior QA engineer testing a web application. Your job is to execute test scenarios precisely and intelligently.

Rules:
- Follow the test steps as guidance, but adapt if the page requires different navigation or intermediate actions.
- If a step requires you to reach a specific page and you're not there, figure out the navigation path (sidebar, menu, links).
- If you encounter unexpected modals, popups, or overlays, dismiss or handle them before continuing.
- If a step mentions clicking something that isn't visible, scroll or look for it in navigation menus.
- After completing all steps, stay on the final page so we can take a screenshot and verify the results.
- Do NOT close tabs, navigate away from the result, or reset the page after completing steps.`;

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
        const startUrl = startUrls[i];
        console.log(`   🧭 Navigating to: ${startUrl}`);
        await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT }).catch(() => {});
        await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

        // Re-login if session expired
        if (isLoggedIn && testCredentials) {
          const pageText = await page.evaluate(() => document.body.innerText).catch(() => '');
          const looksLikeLogin = /\b(log\s*in|sign\s*in|password)\b/i.test(pageText) &&
            /\b(email|username)\b/i.test(pageText);
          if (looksLikeLogin) {
            console.log(`   🔄 Session expired — re-logging in...`);
            await attemptAutoLogin(page, testCredentials, baseUrl);
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT }).catch(() => {});
            await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
          }
        }

        const instruction = buildScenarioInstruction(scenario, agentContext);

        const agent = stagehand.agent({
          model: agentModel,
          systemPrompt: agentSystemPrompt,
        });

        console.log(`   🤖 Agent executing...`);
        const agentResult = await agent.execute({
          instruction,
          maxSteps: MAX_AGENT_STEPS,
        });

        if (agentResult.actions && agentResult.actions.length > 0) {
          agentResult.actions.forEach(action => {
            const logEntry = `[${action.type}] ${action.action || action.reasoning || ''} @ ${action.pageUrl || ''}`;
            scenarioResult.actionLog.push(logEntry);
          });
          console.log(`   📝 Agent took ${agentResult.actions.length} actions`);
        }

        console.log(`   🤖 Agent: ${agentResult.completed ? 'completed' : 'incomplete'} — ${agentResult.message || 'done'}`);

        // Verify expected result with a separate, cheap AI call
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
    await stagehand.close().catch(() => {});

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
