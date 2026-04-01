/**
 * Playwright Spec Generator
 * Generates downloadable .spec.ts test files from QA analysis scenarios
 * using actual source code for accurate locators and flow.
 */

const OpenAI = require('openai');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');

let openai;
try {
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
} catch (err) {
  console.warn('⚠️ Playwright spec generator: OpenAI not available');
}

const SYSTEM_PROMPT = `You are an expert Playwright test engineer. Your job is to generate production-quality Playwright test code (.spec.ts) from QA test scenarios.

RULES:
- Use TypeScript syntax
- Use Playwright's recommended locator strategies IN THIS ORDER of preference:
  1. page.getByRole() — buttons, links, headings, textboxes, etc.
  2. page.getByLabel() — form fields with labels
  3. page.getByPlaceholder() — inputs with placeholder text
  4. page.getByText() — visible text content
  5. page.locator() with data-testid — only if you see data-testid in the source code
  6. page.locator() with CSS — last resort, only for complex cases
- NEVER use fragile selectors like nth-child, complex CSS paths, or XPath
- Extract locators from the ACTUAL SOURCE CODE provided — use real label text, real placeholder text, real button text, real heading text
- Add proper assertions (expect) for each expected result
- Add reasonable timeouts and waitFor where needed
- Group related scenarios in describe blocks
- Add beforeEach for common navigation
- Use page.goto() with relative paths (baseURL is configured externally)
- Keep tests independent — each test should work in isolation
- Add brief comments only for non-obvious logic

OUTPUT FORMAT:
Return ONLY the .spec.ts file content. No markdown fences, no explanations, no preamble. Start directly with the import statement.`;

function buildUserPrompt(scenarios, fileContents, selectorHints, prTitle, repoName) {
  let prompt = `Generate a Playwright .spec.ts test file for this PR: "${prTitle}" in ${repoName}.

## Test Scenarios to Implement

`;

  for (const s of scenarios) {
    prompt += `### ${s.scenario}
- **Steps:** ${s.steps}
- **Expected:** ${s.expected}
- **Priority:** ${s.priority}

`;
  }

  if (Object.keys(fileContents).length > 0) {
    prompt += `## Source Code (use these for ACCURATE locators)

`;
    for (const [filePath, content] of Object.entries(fileContents)) {
      const ext = path.extname(filePath).toLowerCase();
      const isUI = ['.html', '.ejs', '.jsx', '.tsx', '.vue', '.svelte', '.hbs', '.pug'].includes(ext);
      if (isUI && content.length < 15000) {
        prompt += `### ${filePath}
\`\`\`
${content}
\`\`\`

`;
      }
    }
  }

  if (selectorHints && selectorHints.length > 0) {
    prompt += `## UI Element Hints
`;
    for (const hint of selectorHints.slice(0, 30)) {
      prompt += `- ${hint.type}: ${hint.value} (in ${hint.file})\n`;
    }
    prompt += '\n';
  }

  prompt += `Generate the complete .spec.ts file now. Use ONLY locators that match real elements from the source code above.`;

  return prompt;
}

/**
 * Generate a Playwright spec file from test scenarios and source code.
 *
 * @param {Object} options
 * @param {Array} options.scenarios - Parsed test recipe scenarios
 * @param {Object} options.fileContents - Map of filePath -> file content
 * @param {Array} options.selectorHints - Extracted UI element hints
 * @param {string} options.prTitle - PR title
 * @param {string} options.repoName - Repository full name (owner/repo)
 * @param {number} options.prNumber - PR number
 * @returns {Promise<{success: boolean, specContent?: string, specUrl?: string, error?: string}>}
 */
async function generatePlaywrightSpec({ scenarios, fileContents, selectorHints, prTitle, repoName, prNumber }) {
  if (!openai) {
    return { success: false, error: 'OpenAI not configured' };
  }

  if (!scenarios || scenarios.length === 0) {
    return { success: false, error: 'No test scenarios to generate from' };
  }

  const automatable = scenarios.filter(s => {
    const auto = (s.automation || '').toLowerCase();
    return !auto.includes('unit') && !auto.includes('backend') && !auto.includes('api only');
  });

  if (automatable.length === 0) {
    return { success: false, error: 'No UI-testable scenarios found' };
  }

  try {
    console.log(`📝 Generating Playwright spec for ${automatable.length} scenarios...`);

    const userPrompt = buildUserPrompt(automatable, fileContents || {}, selectorHints || [], prTitle, repoName);

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 4000
    });

    let specContent = response.choices[0]?.message?.content?.trim();
    if (!specContent) {
      return { success: false, error: 'AI returned empty response' };
    }

    specContent = specContent
      .replace(/^```(?:typescript|ts)?\n?/, '')
      .replace(/\n?```$/, '')
      .trim();

    if (!specContent.includes('import') && !specContent.includes('test(')) {
      return { success: false, error: 'AI did not produce valid Playwright test code' };
    }

    const specId = uuidv4().slice(0, 8);
    const safeName = repoName.replace('/', '-');
    const fileName = `${safeName}-pr${prNumber}-${specId}.spec.ts`;
    const specsDir = path.join(__dirname, '..', '..', 'test-results', 'specs');

    await fs.mkdir(specsDir, { recursive: true });

    const filePath = path.join(specsDir, fileName);
    await fs.writeFile(filePath, specContent, 'utf-8');

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const specUrl = `${baseUrl}/test-results/specs/${fileName}`;

    console.log(`✅ Playwright spec generated: ${specUrl}`);

    return {
      success: true,
      specContent,
      specUrl,
      fileName,
      filePath,
      scenarioCount: automatable.length
    };
  } catch (err) {
    console.error('❌ Playwright spec generation failed:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { generatePlaywrightSpec };
