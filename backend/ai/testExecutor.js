/**
 * AI-Powered Test Executor using Playwright
 * Converts test recipes from AI analysis into executable browser tests
 */

const { chromium } = require('playwright');
const OpenAI = require('openai');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Execute a test recipe using AI-powered Playwright automation
 * @param {Object} testRecipe - Test recipe from AI analysis
 * @param {string} baseUrl - Base URL of the application to test
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Test execution results
 */
async function executeTestRecipe(testRecipe, baseUrl, options = {}) {
  const {
    recordVideo = true,
    takeScreenshots = true,
    headless = true,
    slowMo = 100,
    timeout = 30000
  } = options;

  const executionId = uuidv4();
  const resultsDir = path.join(process.cwd(), 'test-results', executionId);
  
  // Create results directory
  await fs.mkdir(resultsDir, { recursive: true });

  console.log(`🎬 Starting test execution: ${executionId}`);
  console.log(`📍 Base URL: ${baseUrl}`);
  console.log(`📋 Test scenarios: ${testRecipe.length}`);

  const browser = await chromium.launch({
    headless,
    slowMo,
    args: ['--disable-web-security', '--disable-features=IsolateOrigins,site-per-process']
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: recordVideo ? {
      dir: path.join(resultsDir, 'videos'),
      size: { width: 1280, height: 720 }
    } : undefined,
    ignoreHTTPSErrors: true
  });

  const page = await context.newPage();
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
    scenarios: [],
    fullVideoPath: null,
    resultsDir
  };

  try {
    // Execute each test scenario
    for (let i = 0; i < testRecipe.length; i++) {
      const scenario = testRecipe[i];
      const scenarioStartTime = Date.now();
      
      console.log(`\n🧪 Test ${i + 1}/${testRecipe.length}: ${scenario.scenario}`);
      console.log(`   Priority: ${scenario.priority || 'Not specified'}`);

      const scenarioResult = {
        scenario: scenario.scenario,
        priority: scenario.priority || 'Unknown',
        status: 'PENDING',
        duration: 0,
        startTime: new Date().toISOString(),
        endTime: null,
        steps: scenario.steps,
        expected: scenario.expected,
        actualResult: null,
        error: null,
        screenshotPath: null,
        videoPath: null,
        consoleLogs: [],
        networkErrors: []
      };

      // Capture console logs
      page.on('console', msg => {
        scenarioResult.consoleLogs.push({
          type: msg.type(),
          text: msg.text()
        });
      });

      // Capture network errors
      page.on('requestfailed', request => {
        scenarioResult.networkErrors.push({
          url: request.url(),
          failure: request.failure()?.errorText
        });
      });

      try {
        // Convert test steps to Playwright actions using AI
        const actions = await convertTestStepsToActions(
          scenario.steps,
          scenario.expected,
          baseUrl
        );

        console.log(`   📝 Generated ${actions.length} actions`);

        // Execute each action
        for (const action of actions) {
          await executeAction(page, action, baseUrl);
        }

        // Verify expected result using AI
        const verificationResult = await verifyExpectedResult(
          page,
          scenario.expected,
          baseUrl
        );

        scenarioResult.status = verificationResult.passed ? 'PASS' : 'FAIL';
        scenarioResult.actualResult = verificationResult.actualResult;
        
        if (verificationResult.passed) {
          results.passed++;
          console.log(`   ✅ PASS`);
        } else {
          results.failed++;
          console.log(`   ❌ FAIL: ${verificationResult.reason}`);
          scenarioResult.error = verificationResult.reason;
        }

      } catch (error) {
        scenarioResult.status = 'ERROR';
        scenarioResult.error = error.message;
        results.failed++;
        console.log(`   ❌ ERROR: ${error.message}`);
      }

      // Take screenshot (always, for both pass and fail)
      if (takeScreenshots) {
        const screenshotPath = path.join(
          resultsDir,
          'screenshots',
          `scenario-${i + 1}-${scenarioResult.status}.png`
        );
        await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        scenarioResult.screenshotPath = screenshotPath;
        console.log(`   📸 Screenshot saved`);
      }

      scenarioResult.duration = Date.now() - scenarioStartTime;
      scenarioResult.endTime = new Date().toISOString();
      results.scenarios.push(scenarioResult);

      // Small delay between tests
      await page.waitForTimeout(1000);
    }

  } catch (error) {
    console.error('❌ Test execution error:', error);
  } finally {
    // Close page and context to save video
    await page.close();
    await context.close();
    await browser.close();

    results.endTime = new Date().toISOString();
    results.duration = new Date(results.endTime) - new Date(results.startTime);

    // Move and rename full video
    if (recordVideo) {
      const videoDir = path.join(resultsDir, 'videos');
      const videoFiles = await fs.readdir(videoDir);
      if (videoFiles.length > 0) {
        const fullVideoPath = path.join(resultsDir, 'full-test-run.webm');
        await fs.rename(
          path.join(videoDir, videoFiles[0]),
          fullVideoPath
        );
        results.fullVideoPath = fullVideoPath;
        console.log(`🎥 Full video saved: ${fullVideoPath}`);
      }
    }

    // Save results to JSON
    const resultsPath = path.join(resultsDir, 'results.json');
    await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\n📊 Results saved: ${resultsPath}`);

    console.log(`\n✅ Test execution complete:`);
    console.log(`   Total: ${results.totalTests}`);
    console.log(`   Passed: ${results.passed}`);
    console.log(`   Failed: ${results.failed}`);
    console.log(`   Duration: ${Math.round(results.duration / 1000)}s`);
  }

  return results;
}

/**
 * Convert test steps (natural language) to Playwright actions using AI
 */
async function convertTestStepsToActions(steps, expectedResult, baseUrl) {
  const prompt = `You are a test automation expert. Convert the following test steps into a sequence of Playwright browser automation actions.

Base URL: ${baseUrl}

Test Steps:
${steps}

Expected Result:
${expectedResult}

Return a JSON array of actions. Each action should have:
- type: "navigate" | "click" | "type" | "wait" | "verify" | "select" | "hover" | "scroll"
- selector: CSS selector or XPath (for click, type, select, hover)
- value: text to type or option to select (for type, select)
- url: URL to navigate to (for navigate) - use relative paths from baseUrl
- condition: what to wait for (for wait)
- assertion: what to check (for verify)
- timeout: optional timeout in ms

Make actions specific and executable. Use smart selectors (prefer data-testid, then aria-label, then text content).

Example output:
[
  {"type": "navigate", "url": "/login"},
  {"type": "type", "selector": "input[name='email']", "value": "test@example.com"},
  {"type": "type", "selector": "input[name='password']", "value": "password123"},
  {"type": "click", "selector": "button:has-text('Login')"},
  {"type": "wait", "condition": "navigation"},
  {"type": "verify", "assertion": "page contains Welcome"}
]

Return ONLY the JSON array, no explanation.`;

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a test automation expert. Convert test steps to Playwright actions. Return only valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const content = response.choices[0].message.content;
    
    // Try to parse as JSON object first, then extract array
    let parsedContent;
    try {
      parsedContent = JSON.parse(content);
      // If it's wrapped in an object, extract the actions array
      if (parsedContent.actions && Array.isArray(parsedContent.actions)) {
        return parsedContent.actions;
      } else if (Array.isArray(parsedContent)) {
        return parsedContent;
      } else {
        // Try to find the first array in the object
        for (const key in parsedContent) {
          if (Array.isArray(parsedContent[key])) {
            return parsedContent[key];
          }
        }
      }
    } catch (e) {
      console.error('Failed to parse AI response:', e);
    }

    return [];
  } catch (error) {
    console.error('Error converting steps to actions:', error);
    return [];
  }
}

/**
 * Execute a single Playwright action
 */
async function executeAction(page, action, baseUrl) {
  console.log(`      → ${action.type}: ${action.selector || action.url || action.condition || action.assertion || ''}`);

  try {
    switch (action.type) {
      case 'navigate':
        const url = action.url.startsWith('http') ? action.url : `${baseUrl}${action.url}`;
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        break;

      case 'click':
        await page.click(action.selector, { timeout: action.timeout || 10000 });
        break;

      case 'type':
        await page.fill(action.selector, action.value, { timeout: action.timeout || 10000 });
        break;

      case 'wait':
        if (action.condition === 'navigation') {
          await page.waitForLoadState('domcontentloaded');
        } else if (action.selector) {
          await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
        } else {
          await page.waitForTimeout(action.timeout || 2000);
        }
        break;

      case 'verify':
        // Verification is handled separately
        break;

      case 'select':
        await page.selectOption(action.selector, action.value);
        break;

      case 'hover':
        await page.hover(action.selector);
        break;

      case 'scroll':
        if (action.selector) {
          await page.locator(action.selector).scrollIntoViewIfNeeded();
        } else {
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        }
        break;

      default:
        console.warn(`      ⚠️ Unknown action type: ${action.type}`);
    }
  } catch (error) {
    console.error(`      ❌ Action failed: ${error.message}`);
    throw error;
  }
}

/**
 * Verify expected result using AI analysis of page state
 */
async function verifyExpectedResult(page, expectedResult, baseUrl) {
  try {
    // Get current page state
    const pageState = {
      url: page.url(),
      title: await page.title(),
      content: await page.content(),
      visibleText: await page.evaluate(() => document.body.innerText)
    };

    // Use AI to verify if expected result matches actual state
    const prompt = `You are verifying a test result. Compare the expected result with the actual page state.

Expected Result:
${expectedResult}

Actual Page State:
- URL: ${pageState.url}
- Title: ${pageState.title}
- Visible Text (first 2000 chars): ${pageState.visibleText.substring(0, 2000)}

Determine if the expected result is satisfied by the actual page state.

Return JSON:
{
  "passed": true or false,
  "reason": "brief explanation",
  "actualResult": "what actually happened"
}`;

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are a QA engineer verifying test results. Return only valid JSON.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.2,
      response_format: { type: "json_object" }
    });

    return JSON.parse(response.choices[0].message.content);
  } catch (error) {
    console.error('Error verifying result:', error);
    return {
      passed: false,
      reason: `Verification error: ${error.message}`,
      actualResult: 'Unable to verify'
    };
  }
}

/**
 * Generate video clips for failed tests
 */
async function extractFailedTestVideos(results) {
  const failedClips = [];
  
  // This would require video processing with ffmpeg
  // For now, we'll just reference the full video with timestamps
  
  let currentTimestamp = 0;
  for (const scenario of results.scenarios) {
    const scenarioDuration = scenario.duration / 1000; // Convert to seconds
    
    if (scenario.status === 'FAIL' || scenario.status === 'ERROR') {
      failedClips.push({
        scenario: scenario.scenario,
        startTime: currentTimestamp,
        endTime: currentTimestamp + scenarioDuration,
        videoPath: results.fullVideoPath
      });
    }
    
    currentTimestamp += scenarioDuration + 1; // +1 for delay between tests
  }
  
  return failedClips;
}

module.exports = {
  executeTestRecipe,
  extractFailedTestVideos
};

