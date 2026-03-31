/**
 * Executability Scorer
 * Evaluates each test scenario's browser-testability before execution.
 * Scores 0-100 based on how much can be verified in a browser.
 */

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Score a batch of test scenarios for browser executability.
 * @param {Array} testRecipe - Array of scenario objects { scenario, steps, expected, priority, automation }
 * @returns {Promise<Array>} Annotated recipe with browser_score, browser_steps, manual_steps, skip_reason
 */
async function scoreExecutability(testRecipe) {
  const scenarioList = testRecipe.map((s, i) => (
    `[${i}] Scenario: ${s.scenario}\n    Steps: ${s.steps}\n    Expected: ${s.expected}\n    Automation: ${s.automation || 'UI'}`
  )).join('\n\n');

  try {
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You evaluate test scenarios for browser automation feasibility.
For each scenario, determine what percentage can be verified by a headless browser (Playwright) visiting a URL, clicking, typing, and reading visible page content.

Scoring guide:
- 100: Fully browser-testable (navigate, interact, assert visible text/elements)
- 80-99: Mostly browser-testable but one minor aspect needs manual check (e.g. email sent, exact styling)
- 50-69: Partially testable — can do some UI steps but key verification is non-browser (DB state, server logs, auth internals)
- 0-49: Not browser-testable — tests internal logic, API auth methods, server config, unit behavior

Return ONLY a JSON object with key "scores" containing an array. Each entry must have:
- index: the scenario index
- browser_score: 0-100
- browser_steps: string describing what CAN be done in browser
- manual_steps: string describing what CANNOT be verified in browser (empty string if none)
- skip_reason: string explaining why score is low (empty string if score >= 70)`
        },
        { role: 'user', content: scenarioList }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const parsed = JSON.parse(response.choices[0].message.content);
    const scores = parsed.scores || parsed;

    return testRecipe.map((scenario, i) => {
      const score = (Array.isArray(scores) ? scores : []).find(s => s.index === i) || {
        browser_score: 50,
        browser_steps: 'Unknown',
        manual_steps: 'Could not evaluate',
        skip_reason: ''
      };
      return {
        ...scenario,
        browser_score: score.browser_score,
        browser_steps: score.browser_steps,
        manual_steps: score.manual_steps || '',
        skip_reason: score.skip_reason || ''
      };
    });
  } catch (error) {
    console.error('⚠️ Executability scoring failed, defaulting all to 80:', error.message);
    return testRecipe.map(s => ({
      ...s,
      browser_score: 80,
      browser_steps: s.steps,
      manual_steps: '',
      skip_reason: ''
    }));
  }
}

/**
 * Partition scored recipe into executable and manual-only groups.
 * @param {Array} scoredRecipe - Output of scoreExecutability
 * @param {number} threshold - Minimum score to attempt execution (default 70)
 */
function partitionByScore(scoredRecipe, threshold = 70) {
  const executable = scoredRecipe.filter(s => s.browser_score >= threshold);
  const manual = scoredRecipe.filter(s => s.browser_score < threshold);
  return { executable, manual };
}

module.exports = { scoreExecutability, partitionByScore };
