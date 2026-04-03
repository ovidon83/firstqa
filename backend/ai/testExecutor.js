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

const MAX_AGENT_STEPS = 10;
const ACTION_TIMEOUT = 10000;
const SCENARIO_TIMEOUT = 60000;
const MAX_REPEAT_ACTIONS = 2;

// ─── Accessibility tree helpers ──────────────────────────────────────────────

async function getA11ySnapshot(page) {
  if (page.accessibility) {
    try {
      const snapshot = await page.accessibility.snapshot();
      if (snapshot) return snapshot;
    } catch (_) { /* fall through */ }
  }

  try {
    const client = await page.context().newCDPSession(page);
    const { nodes } = await client.send('Accessibility.getFullAXTree');
    await client.detach().catch(() => {});
    if (nodes && nodes.length > 0) return buildTreeFromCDP(nodes);
  } catch (_) { /* fall through */ }

  return await extractA11yFromDOM(page);
}

function buildTreeFromCDP(nodes) {
  const nodeMap = new Map();
  for (const node of nodes) {
    nodeMap.set(node.nodeId, {
      role: node.role?.value || 'unknown',
      name: node.name?.value || '',
      value: node.value?.value || undefined,
      checked: node.properties?.find(p => p.name === 'checked')?.value?.value,
      disabled: node.properties?.find(p => p.name === 'disabled')?.value?.value,
      expanded: node.properties?.find(p => p.name === 'expanded')?.value?.value,
      children: []
    });
  }

  for (const node of nodes) {
    if (node.childIds) {
      const parent = nodeMap.get(node.nodeId);
      for (const childId of node.childIds) {
        const child = nodeMap.get(childId);
        if (child) parent.children.push(child);
      }
    }
  }

  return nodeMap.get(nodes[0].nodeId) || null;
}

async function extractA11yFromDOM(page) {
  return page.evaluate(() => {
    const interactiveRoles = new Set(['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox', 'menuitem', 'tab', 'switch', 'slider']);
    const interactiveTags = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'DETAILS', 'SUMMARY']);

    function walk(el, depth) {
      if (depth > 6 || !el || el.nodeType !== 1) return null;
      const role = el.getAttribute('role') || tagToRole(el);
      const name = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.innerText?.trim().substring(0, 60) || '';
      const isInteractive = interactiveRoles.has(role) || interactiveTags.has(el.tagName);
      const children = [];
      for (const child of el.children) {
        const c = walk(child, depth + 1);
        if (c) children.push(c);
      }
      if (!isInteractive && children.length === 0 && !name) return null;
      return { role, name: name.substring(0, 80), children: children.length > 0 ? children : undefined };
    }

    function tagToRole(el) {
      const map = { A: 'link', BUTTON: 'button', INPUT: inputRole(el), SELECT: 'combobox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading', NAV: 'navigation', MAIN: 'main', FORM: 'form', IMG: 'img' };
      return map[el.tagName] || 'generic';
    }

    function inputRole(el) {
      const t = (el.getAttribute('type') || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit' || t === 'button') return 'button';
      return 'textbox';
    }

    return walk(document.body, 0) || { role: 'document', name: document.title, children: [] };
  });
}

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

// ─── Start URL resolution (deterministic, no AI call) ───────────────────────

const ROUTE_KEYWORDS = ['hire', 'login', 'signin', 'signup', 'register', 'contact', 'dashboard', 'settings', 'profile', 'pricing', 'checkout', 'cart', 'search', 'about', 'faq', 'help', 'billing', 'onboarding', 'invite'];

function extractPathFromScenario(scenario) {
  const text = `${scenario.scenario} ${scenario.steps} ${scenario.expected}`;

  // 1. Strip full URLs (https://...) so embedded domains don't pollute path detection
  const cleanText = text.replace(/https?:\/\/[^\s'"]+/g, '');

  // 2. Explicit URL path in cleaned text (e.g. "Navigate to /hire page")
  const pathMatch = cleanText.match(/\/([a-z][a-z0-9-]*)/i);
  if (pathMatch) return `/${pathMatch[1].toLowerCase()}`;

  // 3. Route keyword in scenario name
  const name = scenario.scenario.toLowerCase();
  for (const kw of ROUTE_KEYWORDS) {
    if (name.includes(kw)) return `/${kw}`;
  }

  return null;
}

/**
 * Resolve start URLs for all scenarios. Scenarios with no detected path
 * inherit the most common path from the batch (majority vote).
 */
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

// ─── Agent action decision ──────────────────────────────────────────────────

async function decideNextAction(a11yText, currentStep, expectedResult, pageUrl, stepIndex, totalSteps, scenarioName, agentContext = null) {
  let systemPrompt = `You are a browser automation agent. You see the accessibility tree of a web page and must perform one action at a time to complete a test step.

Return ONLY a JSON object with one action:
{
  "action": "click" | "fill" | "clear" | "select" | "navigate" | "scroll" | "press" | "done",
  "role": "button" | "link" | "textbox" | "combobox" | "checkbox" | ...,
  "name": "exact accessible name from the tree",
  "value": "text to type or option to select (for fill/select/press)",
  "url": "relative or absolute URL (for navigate only)",
  "reasoning": "one sentence explaining why"
}

Rules:
- Use "done" when the current step's actions are complete and you should move to the next step.
- For "fill", set role+name to identify the input, and value to the text.
- For "clear", set role+name to identify the input — this empties the field completely.
- If a step says "leave field empty", "clear the field", or implies a field should be blank, use "clear" first if the field has a value, then "done".
- For "select" (dropdowns), set role to "combobox", name to identify it, value to the option text.
- For "press", set value to the key name (e.g. "Enter", "Tab").
- For "navigate", only set url. Use relative paths.
- Match names EXACTLY as they appear in the tree (case-sensitive).
- NEVER repeat the same failed action. If an action didn't work, try a different approach or use "done".
- Be efficient: one action per call when possible.
- If a step says "Log in" or "Log in with test credentials", use the credentials from the environment context to fill the email and password fields, then submit.
- If the expected elements are not on the page, check if you're on a login or landing page first — you may need to log in before proceeding.`;

  if (agentContext) {
    systemPrompt += `\n\nEnvironment context provided by the user:\n${agentContext}`;
  }

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `Scenario: ${scenarioName}
Current URL: ${pageUrl}
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

// ─── Locator resolution ─────────────────────────────────────────────────────

async function resolveLocator(page, role, name) {
  let locator = null;

  try {
    const byRole = page.getByRole(role, { name, exact: false });
    if (await byRole.first().isVisible({ timeout: 800 }).catch(() => false)) {
      locator = byRole.first();
    }
  } catch (_) { /* fall through */ }

  if (!locator && name) {
    try {
      const byLabel = page.getByLabel(name, { exact: false });
      if (await byLabel.first().isVisible({ timeout: 800 }).catch(() => false)) {
        locator = byLabel.first();
      }
    } catch (_) { /* fall through */ }
  }

  if (!locator && name) {
    try {
      const byPlaceholder = page.getByPlaceholder(name, { exact: false });
      if (await byPlaceholder.first().isVisible({ timeout: 800 }).catch(() => false)) {
        locator = byPlaceholder.first();
      }
    } catch (_) { /* fall through */ }
  }

  if (!locator && (role === 'button' || role === 'link')) {
    try {
      const byText = page.getByText(name, { exact: false });
      if (await byText.first().isVisible({ timeout: 800 }).catch(() => false)) {
        locator = byText.first();
      }
    } catch (_) { /* fall through */ }
  }

  if (!locator) {
    locator = page.getByRole(role, { name, exact: false }).first();
  }

  await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});

  return locator;
}

// ─── Action execution ───────────────────────────────────────────────────────

async function executeAgentAction(page, action, baseUrl) {
  const { action: type, role, name, value, url } = action;

  switch (type) {
    case 'navigate': {
      const target = url.startsWith('http') ? url : `${baseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
      await page.goto(target, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT });
      break;
    }
    case 'click': {
      const locator = await resolveLocator(page, role, name);
      await locator.click({ timeout: ACTION_TIMEOUT });
      break;
    }
    case 'fill': {
      const locator = await resolveLocator(page, role || 'textbox', name);
      await locator.fill(value || '', { timeout: ACTION_TIMEOUT });
      break;
    }
    case 'clear': {
      const locator = await resolveLocator(page, role || 'textbox', name);
      await locator.fill('', { timeout: ACTION_TIMEOUT });
      break;
    }
    case 'select': {
      const locator = await resolveLocator(page, role || 'combobox', name);
      await locator.selectOption({ label: value }, { timeout: ACTION_TIMEOUT });
      break;
    }
    case 'scroll': {
      if (role && name) {
        const locator = await resolveLocator(page, role, name);
        await locator.scrollIntoViewIfNeeded({ timeout: ACTION_TIMEOUT });
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

// ─── Scenario agent loop ────────────────────────────────────────────────────

async function runScenarioAgent(page, scenario, baseUrl, agentContext = null) {
  const stepsRaw = scenario.steps || '';
  const individualSteps = stepsRaw
    .split(/\d+\.\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (individualSteps.length === 0) {
    individualSteps.push(stepsRaw);
  }

  const actionLog = [];
  const scenarioDeadline = Date.now() + SCENARIO_TIMEOUT;

  for (let si = 0; si < individualSteps.length; si++) {
    const step = individualSteps[si];
    let attempts = 0;
    let lastActionKey = null;
    let repeatCount = 0;

    while (attempts < MAX_AGENT_STEPS) {
      if (Date.now() > scenarioDeadline) {
        actionLog.push(`Scenario timed out after ${SCENARIO_TIMEOUT / 1000}s`);
        console.log(`      ⏱️ Scenario timed out`);
        return actionLog;
      }

      attempts++;

      await page.waitForLoadState('domcontentloaded').catch(() => {});

      const a11ySnapshot = await getA11ySnapshot(page);
      const a11yText = flattenA11yTree(a11ySnapshot);

      const decision = await decideNextAction(
        a11yText, step, scenario.expected,
        page.url(), si + 1, individualSteps.length,
        scenario.scenario, agentContext
      );

      const logEntry = `Step ${si + 1}.${attempts}: ${decision.action} ${decision.role || ''} "${decision.name || ''}" ${decision.value || ''} — ${decision.reasoning || ''}`;
      actionLog.push(logEntry);
      console.log(`      → ${logEntry}`);

      if (decision.action === 'done') break;

      const actionKey = `${decision.action}:${decision.role || ''}:${decision.name || ''}:${decision.url || ''}`;
      if (actionKey === lastActionKey) {
        repeatCount++;
        if (repeatCount >= MAX_REPEAT_ACTIONS) {
          actionLog.push(`Loop detected: "${decision.action}" repeated ${MAX_REPEAT_ACTIONS} times, moving on`);
          console.log(`      🔄 Loop detected, breaking`);
          break;
        }
      } else {
        repeatCount = 0;
      }
      lastActionKey = actionKey;

      try {
        await executeAgentAction(page, decision, baseUrl);
      } catch (actionError) {
        actionLog.push(`Action failed: ${actionError.message}`);
        console.log(`      ❌ Action failed: ${actionError.message}`);
        break;
      }

      await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
  }

  return actionLog;
}

// ─── Verification ───────────────────────────────────────────────────────────

async function verifyExpectedResult(page, expectedResult, manualSteps) {
  try {
    const a11ySnapshot = await getA11ySnapshot(page);
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

// ─── Auto-login helper ──────────────────────────────────────────────────────

async function attemptAutoLogin(page, credentials, baseUrl) {
  const snapshot = await getA11ySnapshot(page);
  const a11yText = flattenA11yTree(snapshot);

  const hasLoginForm = /\b(log\s*in|sign\s*in|password)\b/i.test(a11yText) &&
    /\b(email|username)\b/i.test(a11yText);

  if (!hasLoginForm) return false;

  // Use the agent to fill in the login form
  const loginSteps = [
    `Enter '${credentials.email}' in the email/username field`,
    `Enter '${credentials.password}' in the password field`,
    `Click the login/sign-in/submit button`
  ];

  for (const step of loginSteps) {
    let attempts = 0;
    while (attempts < 3) {
      attempts++;
      const currentSnapshot = await getA11ySnapshot(page);
      const currentA11y = flattenA11yTree(currentSnapshot);

      const decision = await decideNextAction(
        currentA11y, step, 'User is logged in',
        page.url(), 1, 1, 'Auto-login'
      );

      if (decision.action === 'done') break;

      try {
        await executeAgentAction(page, decision, baseUrl);
        await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
        break;
      } catch (err) {
        if (attempts >= 3) break;
      }
    }
  }

  // Wait for navigation after login submit
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // Check if we're still on a login page
  const postSnapshot = await getA11ySnapshot(page);
  const postA11y = flattenA11yTree(postSnapshot);
  const stillOnLogin = /\b(log\s*in|sign\s*in)\b/i.test(postA11y) &&
    /\b(password)\b/i.test(postA11y);

  return !stillOnLogin;
}

// ─── Main entry point ───────────────────────────────────────────────────────

async function executeTestRecipe(testRecipe, baseUrl, options = {}) {
  const { takeScreenshots = true, timeout = SCENARIO_TIMEOUT, userContext = null, testCredentials = null } = options;

  const executionId = uuidv4();
  const resultsDir = path.join(__dirname, '..', '..', 'test-results', executionId);
  await fs.mkdir(resultsDir, { recursive: true });

  console.log(`🎬 Starting test execution: ${executionId}`);
  console.log(`📍 Base URL: ${baseUrl}`);
  console.log(`📋 Test scenarios: ${testRecipe.length}`);

  // Resolve start URLs for all scenarios up front (deterministic, no AI)
  const startUrls = resolveStartUrls(testRecipe, baseUrl);
  console.log(`🧭 Start URLs: ${startUrls.map((u, i) => `\n   ${i + 1}. ${u}`).join('')}`);

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

  // Build agent context from credentials + inline hints
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

  // Pre-login: if credentials are available, attempt login on the first page load
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
        await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

        // If we were logged in but got redirected to login (session expired), re-login
        if (isLoggedIn && testCredentials) {
          const currentUrl = page.url();
          const a11yCheck = await getA11ySnapshot(page);
          const a11yText = flattenA11yTree(a11yCheck);
          const looksLikeLogin = /\b(log\s*in|sign\s*in|password)\b/i.test(a11yText) &&
            /\b(email|username)\b/i.test(a11yText);
          if (looksLikeLogin) {
            console.log(`   🔄 Session expired — re-logging in...`);
            await attemptAutoLogin(page, testCredentials, baseUrl);
            await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: ACTION_TIMEOUT }).catch(() => {});
            await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
          }
        }

        const actionLog = await runScenarioAgent(page, scenario, baseUrl, agentContext);
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
