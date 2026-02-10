/**
 * OpenAI Client for FirstQA
 * Generates QA insights for pull requests using GPT-4o
 */

const OpenAI = require('openai');
const ejs = require('ejs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Initialize OpenAI client
let openai;
try {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('⚠️ OPENAI_API_KEY not found in environment variables');
  } else {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    console.log('✅ OpenAI client initialized');
  }
} catch (error) {
  console.error('❌ Error initializing OpenAI client:', error.message);
}

/**
 * Safe string conversion helper
 * Converts any value to a string safely (never throws)
 */
function toStr(x) {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  if (x === null || x === undefined) return '';
  if (typeof x === 'object') {
    // If it has a body property (comment object), use that
    if (x.body && typeof x.body === 'string') return x.body;
    // Otherwise stringify
    try {
      return JSON.stringify(x);
    } catch {
      return String(x);
    }
  }
  return String(x || '');
}

/**
 * Safe truncate helper
 * Truncates string to max length (never throws)
 */
function trunc(x, n) {
  const str = toStr(x);
  return str.slice(0, n);
}

/**
 * Generate QA insights for a pull request with DEEP CODE ANALYSIS
 * @param {Object} options - PR details
 * @param {string} options.repo - Repository name (e.g., "owner/repo")
 * @param {number} options.pr_number - Pull request number
 * @param {string} options.title - PR title
 * @param {string} options.body - PR description/body
 * @param {string} options.diff - Code diff
 * @returns {Promise<Object>} QA insights or error object
 */
async function generateQAInsights({ repo, pr_number, title, body, diff, newCommits, fileContents = {}, selectorHints = [] }) {
  try {
    // Validate OpenAI client
    if (!openai) {
      throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
    }

    console.log(`🔍 Starting DEEP CODE ANALYSIS for PR #${pr_number} in ${repo}`);

    // Extract file paths from diff for comprehensive analysis
    const changedFiles = extractChangedFiles(diff);
    console.log(`📁 Changed files detected: ${changedFiles.length} files`);
    console.log(`📂 Full file contents: ${Object.keys(fileContents).length} files, ${selectorHints.length} selector hints`);

    // Get comprehensive code context (includes fileContents and selectorHints for accuracy)
    const codeContext = await buildCodeContext(repo, pr_number, changedFiles, diff, { fileContents, selectorHints });
    
    // Validate that we have real PR data, not simulated/fake data
    const isSimulatedData = diff && (
      diff.includes('This is a simulated PR description') ||
      diff.includes('diff --git a/src/auth.js b/src/auth.js') ||
      diff.includes('const jwt = require(\'jsonwebtoken\')') ||
      diff.includes('Error fetching PR diff') ||
      diff === 'No code changes detected'
    );

    if (isSimulatedData || !diff || diff.length < 50) {
      console.log('⚠️ Detected simulated/fake data or missing PR diff - cannot perform real analysis');
      const errorInsights = generateDataAccessError(title, repo, pr_number);
      return {
        success: true,
        data: errorInsights,
        metadata: {
          repo, pr_number, model: 'data-access-error', timestamp: new Date().toISOString(),
          note: 'Unable to access real PR data due to authentication or permission issues',
          analysisType: 'data-access-error'
        }
      };
    }

    // Check if this is an update analysis (new commits detected)
    const isUpdateAnalysis = newCommits && newCommits.length > 0;
    
    // Sanitize inputs with much higher limits for deep analysis
    const sanitizedTitle = trunc(title || 'No title provided', 300);
    let sanitizedBody = trunc(body || 'No description provided', 3000); // Higher limit for update context
    
    // Note: The body already contains new commits context from githubService.js
    // We're analyzing the FULL PR diff, but with awareness of what's new
    
    const sanitizedDiff = trunc(diff, 12000); // Full PR diff
    const sanitizedContext = trunc(JSON.stringify(codeContext), 6000); // Code context

    // Format selector hints for automation-ready test cases (exclude fullFileContents from context string to save tokens)
    const selectorHintsFormatted = (selectorHints || []).slice(0, 40).map(h =>
      `- ${h.type || 'selector'}: "${h.value}" (${h.file || 'unknown'})`
    ).join('\n') || 'None extracted from code.';

    // Include key file contents for UI components (truncated) - helps AI see exact elements/structure
    const fileContentsForPrompt = Object.entries(fileContents || {}).slice(0, 4).map(([path, content]) => {
      const snipped = trunc(content, 2000);
      return `\n--- FILE: ${path} ---\n${snipped}${content.length > 2000 ? '\n...[truncated]' : ''}`;
    }).join('\n') || '';

    console.log(`🔍 Deep analysis input: Title=${sanitizedTitle.length} chars, Body=${sanitizedBody.length} chars, Diff=${sanitizedDiff.length} chars, Context=${sanitizedContext.length} chars`);
    if (isUpdateAnalysis) {
      console.log(`🔄 REGENERATING COMPLETE ANALYSIS: ${newCommits.length} new commit(s) detected - analyzing FULL PR with new commits context`);
    } else {
      console.log(`✅ Standard analysis: Full PR review`);
    }

    // Load and render the enhanced deep analysis prompt template
    const enhancedPromptTemplatePath = path.join(__dirname, 'prompts', 'enhanced-deep-analysis.ejs');
    const deepPromptTemplatePath = path.join(__dirname, 'prompts', 'deep-analysis.ejs');
    let prompt;
    
    if (fs.existsSync(enhancedPromptTemplatePath)) {
      console.log('✅ Using enhanced deep analysis template with algorithm-aware testing');
      const promptTemplate = fs.readFileSync(enhancedPromptTemplatePath, 'utf8');
      
      // Add comprehensive analysis instruction if commits are provided
      let analysisInstruction = '';
      if (newCommits && newCommits.length > 0) {
        if (isUpdateAnalysis) {
          analysisInstruction = `\n\n⚠️ **COMPREHENSIVE UPDATE ANALYSIS MODE**: ${newCommits.length} new commit(s) have been added since the last review.\n\n`;
        } else {
          analysisInstruction = `\n\n⚠️ **COMPREHENSIVE PR ANALYSIS MODE**: This PR contains ${newCommits.length} commit(s).\n\n`;
        }
        
        analysisInstruction += `**CRITICAL REQUIREMENTS FOR TEST GENERATION:**\n`;
        analysisInstruction += `1. Generate **5-7 comprehensive test cases** total\n`;
        analysisInstruction += `2. **HIGHEST PRIORITY**: For EACH fix mentioned in commit messages, generate a test case that specifically verifies that fix works\n`;
        analysisInstruction += `3. Include **specific, detailed expected results** with:\n`;
        analysisInstruction += `   - Exact UI states (what's visible/hidden/selected)\n`;
        analysisInstruction += `   - Exact messages and notifications (toast text, error messages)\n`;
        analysisInstruction += `   - Exact state changes (filter switches, data updates, navigation)\n`;
        analysisInstruction += `   - Exact behaviors (no flicker, smooth transitions, error handling)\n`;
        analysisInstruction += `4. Include **edge cases** (rapid actions, multiple states, concurrent operations, boundary conditions)\n`;
        analysisInstruction += `5. Include **negative test cases** (error conditions, failure scenarios, invalid states)\n`;
        analysisInstruction += `6. Test **complete user flows**, not just isolated actions\n`;
        analysisInstruction += `7. Focus on **user-facing changes** and **fixes** as highest priority\n`;
        analysisInstruction += `8. Base test cases on the **actual code changes** and **commit messages**, not assumptions\n`;
        analysisInstruction += `9. Consider how all changes work **TOGETHER** (integration testing)\n\n`;
      }
      
      prompt = ejs.render(promptTemplate, {
        repo,
        pr_number,
        title: sanitizedTitle,
        body: sanitizedBody + analysisInstruction,
        diff: sanitizedDiff,
        codeContext: sanitizedContext,
        changedFiles: changedFiles,
        isUpdateAnalysis: isUpdateAnalysis,
        newCommitsCount: isUpdateAnalysis && newCommits ? newCommits.length : 0,
        selectorHintsFormatted: selectorHintsFormatted || 'None extracted.',
        fileContentsForPrompt: fileContentsForPrompt || ''
      });
    } else if (fs.existsSync(deepPromptTemplatePath)) {
      console.log('✅ Using deep analysis template for comprehensive code review');
      const promptTemplate = fs.readFileSync(deepPromptTemplatePath, 'utf8');
      prompt = ejs.render(promptTemplate, {
        repo,
        pr_number,
        title: sanitizedTitle,
        body: sanitizedBody,
        diff: sanitizedDiff,
        codeContext: sanitizedContext,
        changedFiles: changedFiles
      });
    } else {
      // Fallback to default template if deep analysis template doesn't exist
      console.log('⚠️ Deep analysis template not found, using default template');
      const defaultTemplatePath = path.join(__dirname, 'prompts', 'default.ejs');
      const promptTemplate = fs.readFileSync(defaultTemplatePath, 'utf8');
      prompt = ejs.render(promptTemplate, {
        repo,
        pr_number,
        title: sanitizedTitle,
        body: sanitizedBody,
        diff: sanitizedDiff
      });
    }

    console.log(`🤖 FirstQA Ovi AI performing DEEP CODE ANALYSIS for PR #${pr_number} in ${repo}`);

    // Get model from environment or use default
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    // Attempt to get insights (with retry logic)
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/3 to generate deep analysis insights`);
        
        const completion = await openai.chat.completions.create({
          model: model,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1, // Very low temperature for maximum consistency
          max_tokens: 2500 // Higher limit for detailed analysis
        });

        const response = completion.choices[0]?.message?.content;
        if (!response) {
          throw new Error('Empty response from OpenAI');
        }

        // Log summary
        console.log('🔍 AI response:', {
          length: response.length,
          usage: completion.usage,
          model: completion.model
        });

        // Try to parse the JSON response with multiple fallback strategies
        let insights = await parseAIResponse(response, sanitizedTitle, sanitizedBody, sanitizedDiff);

        if (insights) {
          console.log('✅ Successfully generated DEEP CODE ANALYSIS insights');
          return {
            success: true,
            data: insights,
            metadata: {
              repo, pr_number, model, attempt, timestamp: new Date().toISOString(),
              analysisType: 'deep-code-analysis',
              changedFiles: changedFiles.length
            }
          };
        }
      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        lastError = error;
        if (attempt === 3) { break; }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log('🔄 All AI attempts failed, generating intelligent fallback analysis based on code context');
    const fallbackInsights = generateDeepFallbackAnalysis(sanitizedTitle, sanitizedBody, sanitizedDiff, codeContext);
    return {
      success: true,
      data: fallbackInsights,
      metadata: {
        repo, pr_number, model: 'deep-fallback', attempt: 'fallback', timestamp: new Date().toISOString(),
        note: 'Deep fallback analysis generated due to AI processing issues',
        analysisType: 'deep-fallback'
      }
    };

  } catch (error) {
    console.error('❌ Error in generateQAInsights:', error.message);
    const ultimateFallback = generateUltimateFallback(title || 'Unknown PR');
    return {
      success: true,
      data: ultimateFallback,
      metadata: {
        repo: repo || 'unknown', pr_number: pr_number || 0, model: 'ultimate-fallback',
        attempt: 'ultimate-fallback', timestamp: new Date().toISOString(), error: error.message,
        note: 'Ultimate fallback due to system error',
        analysisType: 'ultimate-fallback'
      }
    };
  }
}

/**
 * Parse AI response with multiple fallback strategies
 */
async function parseAIResponse(response, title, body, diff) {
  try {
    // Check if response is the new compressed markdown format
    if (response.includes('# Ovi QA Analysis') || response.includes('📋 Summary')) {
      // Return the markdown response directly
      return response.trim();
    }
    
    // Fallback: try to parse as JSON for backward compatibility
    try {
      const insights = JSON.parse(response);
      if (insights && typeof insights === 'object' && validateInsightsStructure(insights)) {
        return insights;
      }
    } catch (e) {
      console.log('Not JSON format, treating as markdown...');
    }

    // Try to extract JSON from markdown (backward compatibility)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const insights = JSON.parse(jsonMatch[0]);
        if (insights && typeof insights === 'object' && validateInsightsStructure(insights)) {
          return insights;
        }
      } catch (e) {
        console.log('Failed to parse embedded JSON, treating as markdown...');
      }
    }

    // If all else fails, return the response as-is (assume it's readable text)
    return response.trim();
  } catch (error) {
    console.error('Error in parseAIResponse:', error.message);
    return null;
  }
}

/**
 * Fix common JSON issues in AI responses
 */
function fixCommonJSONIssues(response) {
  let fixed = response;
  
  // Remove markdown code blocks
  fixed = fixed.replace(/```json\s*/g, '').replace(/```\s*/g, '');
  
  // Fix common escape issues
  fixed = fixed.replace(/\\"/g, '"').replace(/\\n/g, '\n');
  
  // Remove trailing commas
  fixed = fixed.replace(/,(\s*[}\]])/g, '$1');
  
  // Fix unescaped quotes in strings
  fixed = fixed.replace(/"([^"]*)"([^"]*)"([^"]*)"/g, '"$1$2$3"');
  
  return fixed;
}

/**
 * Validate the structure of AI insights
 */
function validateInsightsStructure(insights) {
  return insights && 
         insights.summary && 
         insights.questions && 
         insights.featureTestRecipe &&
         insights.technicalTestRecipe &&
         insights.bugs &&
         insights.criticalRisks &&
         insights.summary.riskLevel &&
         insights.summary.shipScore &&
         Array.isArray(insights.questions) &&
         Array.isArray(insights.featureTestRecipe) &&
         Array.isArray(insights.technicalTestRecipe) &&
         Array.isArray(insights.bugs) &&
         Array.isArray(insights.criticalRisks);
}

/**
 * Generate fallback analysis based on PR content
 */
function generateFallbackAnalysis(title, body, diff) {
  console.log('🔄 Generating intelligent fallback analysis based on PR content');
  
  const prInfo = extractPRInfo(title, body, diff);
  
  // Extract specific features from the PR description
  const features = [];
  if (body) {
    if (body.includes('text area')) features.push('direct text input');
    if (body.includes('tag support') || body.includes('#')) features.push('tag system');
    if (body.includes('To-Do') || body.includes('todo')) features.push('todo management');
    if (body.includes('Dashboard') || body.includes('dashboard')) features.push('dashboard enhancements');
    if (body.includes('AI') || body.includes('artificial intelligence')) features.push('AI integration');
    if (body.includes('overdue') || body.includes('priority')) features.push('priority management');
    if (body.includes('sub-tasks') || body.includes('subtasks')) features.push('subtask support');
  }
  
  return {
    summary: {
      riskLevel: "MEDIUM",
      shipScore: 7,
      reasoning: "Medium risk due to multiple new features and integrations, but well-structured changes suggest good implementation"
    },
    questions: [
      `How does the new ${features.includes('tag system') ? 'tag extraction regex' : 'input processing'} handle special characters like #meeting-2024-01-15 and #urgent! in the text area?`,
      `What happens when a user enters 2000+ characters with 25+ tags like #work #personal #urgent #meeting #followup #blocked in a single thought?`,
      `How does the ${features.includes('AI integration') ? 'AI categorization service' : 'new service'} handle rate limiting when processing 50+ thoughts simultaneously during peak usage?`,
      `Are there any database schema changes or migrations that need to be tested in staging before production deployment?`
    ],
    testRecipe: {
      criticalPath: [
        `User enters 'Meeting with John tomorrow #today #work #urgent #followup' and verifies it appears in today's todo list with correct priority`,
        `Test POST /api/thoughts with JSON payload: {"content": "Project update #work #progress #blocked", "tags": ["work", "progress", "blocked"]} and verify database storage`,
        `Test AI categorization service with 100 thoughts containing mixed content: 30% work, 30% personal, 40% mixed tags`
      ],
      edgeCases: [
        `Test with 10,000 character input containing 100 #tags with special characters like #meeting-2024-01-15, #urgent!, #blocked/priority`,
        `Test with empty input, null values, malformed JSON: {"content": null, "tags": []} in the text area`,
        `Test AI service timeout after 30 seconds with payload containing 50+ complex thoughts and verify graceful fallback to basic categorization`
      ],
      automation: {
        unit: [
          `Test tag extraction function with input 'Hello #work #urgent #meeting-2024' returns ['work', 'urgent', 'meeting-2024']`,
          `Test input validation with 10,000 characters and 100 tags, verify it rejects or truncates appropriately`
        ],
        integration: [
          `Test POST /api/thoughts with valid JSON containing 15 tags and verify all are stored in database with correct relationships`,
          `Test AI service integration with mock responses: success (200ms), timeout (30s), error (500) scenarios`
        ],
        e2e: [
          `User opens app, enters 'Daily standup notes #work #meeting #followup #urgent', saves, verifies in todo view, checks dashboard shows correct categorization`,
          `Test complete workflow with 50 thoughts containing various tag combinations: #work+#personal, #urgent+#blocked, #today+#tomorrow`
        ]
      }
    },
    risks: [
      `Database performance degradation when storing 1000+ thoughts with 50+ tags per thought - potential index issues and query timeouts`,
      `AI service timeout causing 5+ second delays in thought processing during peak usage - user experience degradation`,
      `Memory leaks in tag extraction regex processing causing browser crashes with 10,000+ character inputs containing 100+ tags`
    ]
  };
}

/**
 * Extract key information from PR content for fallback analysis
 */
function extractPRInfo(title, body, diff) {
  // Extract feature type from title
  let featureType = 'enhancement';
  let featureName = 'application';
  
  if (title) {
    const titleLower = title.toLowerCase();
    if (titleLower.includes('auth') || titleLower.includes('login')) {
      featureType = 'authentication';
      featureName = 'user authentication';
    } else if (titleLower.includes('api') || titleLower.includes('endpoint')) {
      featureType = 'API';
      featureName = 'API functionality';
    } else if (titleLower.includes('ui') || titleLower.includes('interface')) {
      featureType = 'UI';
      featureName = 'user interface';
    } else if (titleLower.includes('thought') || titleLower.includes('input')) {
      featureType = 'thought capture';
      featureName = 'thought input system';
    } else if (titleLower.includes('todo') || titleLower.includes('task')) {
      featureType = 'task management';
      featureName = 'todo system';
    } else if (titleLower.includes('dashboard')) {
      featureType = 'dashboard';
      featureName = 'dashboard';
    } else if (titleLower.includes('tag') || titleLower.includes('categorization')) {
      featureType = 'tagging';
      featureName = 'tag system';
    }
  }
  
  // Extract affected area from diff
  let affectedArea = 'frontend';
  if (diff) {
    const diffLower = diff.toLowerCase();
    if (diffLower.includes('.js') || diffLower.includes('.ts')) {
      affectedArea = 'frontend';
    } else if (diffLower.includes('.py') || diffLower.includes('.java')) {
      affectedArea = 'backend';
    } else if (diffLower.includes('api/') || diffLower.includes('routes/')) {
      affectedArea = 'API';
    } else if (diffLower.includes('test') || diffLower.includes('spec')) {
      affectedArea = 'testing';
    }
  }
  
  return {
    featureType,
    featureName,
    affectedArea
  };
}

/**
 * Generate error response when unable to access real PR data
 */
function generateDataAccessError(title, repo, prNumber) {
  console.log('⚠️ Generating data access error response');
  
  return {
    summary: {
      description: `🚨 **Unable to analyze PR #${prNumber}** - Cannot access real code changes due to authentication or permission issues`,
      riskLevel: "UNKNOWN",
      shipScore: "N/A",
      reasoning: "Analysis cannot be performed without access to actual code changes"
    },
    questions: [
              "🔐 **Authentication Issue**: Is the FirstQA GitHub App properly installed on this repository?",
      "🔑 **Permissions**: Does the GitHub App have 'Pull requests' read permissions?",
      "📊 **Repository Access**: Can the app access private repositories if needed?",
      "⚙️ **Configuration**: Are the GITHUB_APP_ID and GITHUB_PRIVATE_KEY properly configured?",
      "🔄 **Manual Review**: Please manually review the actual code changes in this PR"
    ],
    testRecipe: {
      criticalPath: [
        "❌ **Cannot generate test plan** - No access to actual code changes",
        "🔍 **Manual Review Required** - Please examine the PR diff manually",
        "⚠️ **Contact Support** - Report this authentication issue to FirstQA support"
      ],
      edgeCases: [
        "Unable to identify edge cases without code access",
        "Recommend manual testing of all changed functionality"
      ],
      automation: {
        unit: ["Cannot suggest unit tests without seeing code changes"],
        integration: ["Manual review needed for integration testing"],
        e2e: ["End-to-end testing requires manual analysis of changes"]
      }
    },
    risks: [
      "🚨 **Critical**: Cannot assess risks without access to actual code changes",
              "🔐 **Authentication Failure**: FirstQA app may not be properly configured for this repository",
      "⚠️ **Manual Review Essential**: All changes must be manually reviewed and tested",
              "📞 **Support Needed**: Contact FirstQA support to resolve access issues"
    ]
  };
}

/**
 * Generate ultimate fallback when everything else fails
 */
function generateUltimateFallback(title) {
  console.log('🔄 Generating ultimate fallback analysis');
  
  return {
    summary: {
      description: `Updates ${title || 'the application'} with new features and improvements`,
      riskLevel: "MEDIUM",
      shipScore: 6,
      reasoning: "Unable to perform detailed analysis due to AI processing issues - manual review recommended"
    },
    questions: [
      "What is the main purpose and scope of these changes?",
      "Are there any breaking changes that could affect existing functionality?",
      "What are the key user workflows that need to be tested?",
      "Are there any dependencies or integrations that might be affected?"
    ],
    testRecipe: [
      {
        scenario: "Test the main functionality that was changed",
        steps: "Test the main functionality that was changed",
        expected: "Core features work as expected",
        priority: "Critical Path",
        automation: "Manual",
        reason: "Core functionality verification"
      },
      {
        scenario: "Verify that existing features still work as expected",
        steps: "Verify that existing features still work as expected",
        expected: "No existing functionality is broken",
        priority: "Critical Path",
        automation: "Manual",
        reason: "Regression testing"
      },
      {
        scenario: "Check for any new error conditions or edge cases",
        steps: "Check for any new error conditions or edge cases",
        expected: "Proper error handling and recovery",
        priority: "Critical Path",
        automation: "Manual",
        reason: "Error handling verification"
      }
    ],
    risks: [
      "Unable to perform detailed risk analysis due to AI processing error",
      "Please review the changes manually for potential issues",
      "Consider testing the affected functionality thoroughly"
    ]
  };
}

/**
 * Test OpenAI connection
 * @returns {Promise<boolean>} True if connection is working
 */
async function testConnection() {
  try {
    if (!openai) {
      console.error('❌ OpenAI client not initialized');
      return false;
    }

    const completion = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [{ role: 'user', content: 'Test connection. Reply with "OK".' }],
      max_tokens: 10
    });

    const response = completion.choices[0]?.message?.content;
    console.log('✅ OpenAI connection test successful:', response);
    return true;
  } catch (error) {
    console.error('❌ OpenAI connection test failed:', error.message);
    return false;
  }
}

/**
 * Extract changed file paths from git diff
 */
function extractChangedFiles(diff) {
  if (!diff) return [];
  
  const files = [];
  const lines = diff.split('\n');
  
  for (const line of lines) {
    // Match git diff file headers
    if (line.startsWith('diff --git a/') || line.startsWith('--- a/') || line.startsWith('+++ b/')) {
      const match = line.match(/[ab]\/(.+)/);
      if (match && !files.includes(match[1])) {
        files.push(match[1]);
      }
    }
  }
  
  return files.filter(file => 
    // Focus on code files, exclude generated files
    /\.(js|ts|jsx|tsx|py|java|cpp|c|cs|php|rb|go|rs|swift|kt|scala)$/i.test(file) &&
    !file.includes('node_modules') &&
    !file.includes('dist') &&
    !file.includes('build') &&
    !file.includes('.min.') &&
    !file.includes('package-lock.json')
  );
}

/**
 * Build comprehensive code context for deep analysis with enhanced algorithmic awareness
 * @param {Object} options - Optional { fileContents: { path: content }, selectorHints: [] }
 */
async function buildCodeContext(repo, pr_number, changedFiles, diff, options = {}) {
  const { fileContents = {}, selectorHints = [] } = options;
  const context = {
    changedFiles: changedFiles,
    fileTypes: {},
    complexity: {},
    dependencies: {},
    patterns: {},
    risks: {},
    codeQuality: {},
    architecture: {},
    dataFlow: {},
    algorithms: {},
    boundaries: {},
    performance: {},
    concurrency: {},
    automationSelectors: selectorHints.length > 0 ? selectorHints.slice(0, 30) : []
    // fullFileContents & selectorHints passed separately to prompt (fileContentsForPrompt, selectorHintsFormatted)
  };

  // Analyze file types and patterns
  for (const file of changedFiles) {
    const extension = file.split('.').pop()?.toLowerCase();
    context.fileTypes[extension] = (context.fileTypes[extension] || 0) + 1;
    
    // Detect patterns based on file type
    if (extension === 'js' || extension === 'ts' || extension === 'jsx' || extension === 'tsx') {
      context.patterns.frontend = true;
    } else if (extension === 'py' || extension === 'java' || extension === 'php') {
      context.patterns.backend = true;
    }
  }

  // Analyze diff for complexity indicators
  const diffLines = diff.split('\n');
  context.complexity.totalLines = diffLines.length;
  context.complexity.additions = diffLines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length;
  context.complexity.deletions = diffLines.filter(line => line.startsWith('-') && !line.startsWith('---')).length;
  context.complexity.changes = context.complexity.additions + context.complexity.deletions;

  // Enhanced algorithmic analysis
  context.algorithms = analyzeAlgorithms(diff);
  context.boundaries = analyzeBoundaries(diff);
  context.performance = analyzePerformance(diff);
  context.concurrency = analyzeConcurrency(diff);

  // Advanced code quality analysis
  context.codeQuality = analyzeCodeQuality(diff, changedFiles);
  
  // Architecture analysis
  context.architecture = analyzeArchitecture(changedFiles, diff);
  
  // Data flow analysis
  context.dataFlow = analyzeDataFlow(diff, changedFiles);

  // Detect potential risk patterns
  context.risks = detectRiskPatterns(diff, changedFiles);

  return context;
}

/**
 * Analyze code quality metrics
 */
function analyzeCodeQuality(diff, changedFiles) {
  const quality = {
    cyclomaticComplexity: 0,
    maintainabilityIndex: 0,
    codeSmells: [],
    testCoverage: 0,
    documentation: 0
  };

  const lines = diff.split('\n');
  const diffLower = diff.toLowerCase();

  // Cyclomatic complexity estimation
  const complexityIndicators = [
    'if(', 'else', 'switch', 'case', 'for(', 'while(', 'catch', '&&', '||', '?'
  ];
  
  for (const indicator of complexityIndicators) {
    const matches = lines.filter(line => line.includes(indicator)).length;
    quality.cyclomaticComplexity += matches;
  }

  // Code smells detection
  if (lines.some(line => line.length > 120)) {
    quality.codeSmells.push('Long lines detected (>120 chars)');
  }
  
  if (lines.filter(line => line.includes('function')).length > 5) {
    quality.codeSmells.push('Multiple functions in single change');
  }
  
  if (lines.some(line => line.includes('TODO') || line.includes('FIXME'))) {
    quality.codeSmells.push('TODO/FIXME comments detected');
  }

  // Test coverage estimation
  const testFiles = changedFiles.filter(f => f.includes('test') || f.includes('spec'));
  const sourceFiles = changedFiles.filter(f => !f.includes('test') && !f.includes('spec'));
  quality.testCoverage = testFiles.length / Math.max(sourceFiles.length, 1);

  // Documentation estimation
  const commentLines = lines.filter(line => 
    line.trim().startsWith('//') || 
    line.trim().startsWith('*') || 
    line.trim().startsWith('/**')
  ).length;
  quality.documentation = commentLines / Math.max(lines.length, 1);

  return quality;
}

/**
 * Analyze architecture patterns
 */
function analyzeArchitecture(changedFiles, diff) {
  const architecture = {
    layers: [],
    patterns: [],
    integrations: [],
    boundaries: []
  };

  // Detect architectural layers
  if (changedFiles.some(f => f.includes('component') || f.includes('ui'))) {
    architecture.layers.push('Presentation Layer');
  }
  
  if (changedFiles.some(f => f.includes('service') || f.includes('business'))) {
    architecture.layers.push('Business Logic Layer');
  }
  
  if (changedFiles.some(f => f.includes('data') || f.includes('model') || f.includes('entity'))) {
    architecture.layers.push('Data Access Layer');
  }

  // Detect design patterns
  if (diff.includes('singleton') || diff.includes('getInstance')) {
    architecture.patterns.push('Singleton Pattern');
  }
  
  if (diff.includes('factory') || diff.includes('create')) {
    architecture.patterns.push('Factory Pattern');
  }
  
  if (diff.includes('observer') || diff.includes('subscribe')) {
    architecture.patterns.push('Observer Pattern');
  }

  // Detect integrations
  if (changedFiles.some(f => f.includes('api') || f.includes('endpoint'))) {
    architecture.integrations.push('External API Integration');
  }
  
  if (changedFiles.some(f => f.includes('database') || f.includes('db'))) {
    architecture.integrations.push('Database Integration');
  }
  
  if (changedFiles.some(f => f.includes('auth') || f.includes('login'))) {
    architecture.integrations.push('Authentication Integration');
  }

  // Detect boundaries
  if (changedFiles.some(f => f.includes('controller') || f.includes('handler'))) {
    architecture.boundaries.push('Controller Boundary');
  }
  
  if (changedFiles.some(f => f.includes('repository') || f.includes('dao'))) {
    architecture.boundaries.push('Repository Boundary');
  }

  return architecture;
}

/**
 * Analyze data flow patterns
 */
function analyzeDataFlow(diff, changedFiles) {
  const dataFlow = {
    inputs: [],
    outputs: [],
    transformations: [],
    validations: [],
    persistence: []
  };

  const diffLower = diff.toLowerCase();

  // Input analysis
  if (diffLower.includes('input') || diffLower.includes('form') || diffLower.includes('request')) {
    dataFlow.inputs.push('User Input');
  }
  
  if (diffLower.includes('file') || diffLower.includes('upload')) {
    dataFlow.inputs.push('File Input');
  }
  
  if (diffLower.includes('api') || diffLower.includes('fetch')) {
    dataFlow.inputs.push('API Input');
  }

  // Output analysis
  if (diffLower.includes('response') || diffLower.includes('return')) {
    dataFlow.outputs.push('API Response');
  }
  
  if (diffLower.includes('render') || diffLower.includes('display')) {
    dataFlow.outputs.push('UI Output');
  }
  
  if (diffLower.includes('email') || diffLower.includes('notification')) {
    dataFlow.outputs.push('Notification Output');
  }

  // Transformation analysis
  if (diffLower.includes('map') || diffLower.includes('transform')) {
    dataFlow.transformations.push('Data Mapping');
  }
  
  if (diffLower.includes('filter') || diffLower.includes('sort')) {
    dataFlow.transformations.push('Data Filtering');
  }
  
  if (diffLower.includes('aggregate') || diffLower.includes('group')) {
    dataFlow.transformations.push('Data Aggregation');
  }

  // Validation analysis
  if (diffLower.includes('validate') || diffLower.includes('check')) {
    dataFlow.validations.push('Input Validation');
  }
  
  if (diffLower.includes('sanitize') || diffLower.includes('clean')) {
    dataFlow.validations.push('Data Sanitization');
  }

  // Persistence analysis
  if (diffLower.includes('save') || diffLower.includes('store')) {
    dataFlow.persistence.push('Data Storage');
  }
  
  if (diffLower.includes('update') || diffLower.includes('modify')) {
    dataFlow.persistence.push('Data Update');
  }
  
  if (diffLower.includes('delete') || diffLower.includes('remove')) {
    dataFlow.persistence.push('Data Deletion');
  }

  return dataFlow;
}

/**
 * Detect risk patterns in code changes with advanced analysis
 */
function detectRiskPatterns(diff, changedFiles) {
  const risks = {
    security: [],
    performance: [],
    reliability: [],
    maintainability: [],
    build: [],
    architecture: [],
    dataIntegrity: []
  };

  const diffLower = diff.toLowerCase();
  const filesLower = changedFiles.map(f => f.toLowerCase());
  const lines = diff.split('\n');

  // Advanced Security Analysis
  analyzeSecurityRisks(diff, lines, risks);
  
  // Advanced Performance Analysis
  analyzePerformanceRisks(diff, lines, risks);
  
  // Advanced Reliability Analysis
  analyzeReliabilityRisks(diff, lines, risks);
  
  // Advanced Maintainability Analysis
  analyzeMaintainabilityRisks(diff, lines, risks);
  
  // Advanced Build Analysis
  analyzeBuildRisks(diff, lines, risks);
  
  // Architecture Analysis
  analyzeArchitectureRisks(diff, changedFiles, risks);
  
  // Data Integrity Analysis
  analyzeDataIntegrityRisks(diff, lines, risks);

  return risks;
}

/**
 * Advanced security risk analysis
 */
function analyzeSecurityRisks(diff, lines, risks) {
  const diffLower = diff.toLowerCase();
  
  // XSS vulnerabilities
  if (diffLower.includes('innerhtml') || diffLower.includes('dangerouslysetinnerhtml')) {
    risks.security.push('🚨 XSS vulnerability: innerHTML usage without sanitization');
  }
  
  // Code injection
  if (diffLower.includes('eval(') || diffLower.includes('settimeout(') || diffLower.includes('setinterval(')) {
    risks.security.push('🚨 Code injection risk: eval/setTimeout/setInterval with user input');
  }
  
  // SQL injection
  if (diffLower.includes('sql') && (diffLower.includes('select') || diffLower.includes('insert') || diffLower.includes('update'))) {
    risks.security.push('🚨 SQL injection risk: Raw SQL queries without parameterization');
  }
  
  // Authentication bypass
  if (diffLower.includes('bypass') || diffLower.includes('skip') || diffLower.includes('ignore')) {
    risks.security.push('⚠️ Authentication bypass: Potential security bypass detected');
  }
  
  // Sensitive data exposure
  if (diffLower.includes('password') || diffLower.includes('secret') || diffLower.includes('token')) {
    risks.security.push('⚠️ Sensitive data: Password/secret handling detected');
  }
  
  // CORS issues
  if (diffLower.includes('cors') || diffLower.includes('origin')) {
    risks.security.push('⚠️ CORS configuration: Cross-origin requests detected');
  }
  
  // File upload vulnerabilities
  if (diffLower.includes('upload') || diffLower.includes('file')) {
    risks.security.push('⚠️ File upload: Potential file upload vulnerabilities');
  }
}

/**
 * Advanced performance risk analysis
 */
function analyzePerformanceRisks(diff, lines, risks) {
  const diffLower = diff.toLowerCase();
  
  // N+1 query patterns
  if (diffLower.includes('foreach') && diffLower.includes('api') && diffLower.includes('call')) {
    risks.performance.push('🐌 N+1 query pattern: forEach with API calls detected');
  }
  
  // Memory leaks
  if (diffLower.includes('settimeout') || diffLower.includes('setinterval')) {
    risks.performance.push('🐌 Memory leak risk: Timers without cleanup detected');
  }
  
  // Event listener leaks
  if (diffLower.includes('addlistener') || diffLower.includes('addeventlistener')) {
    risks.performance.push('🐌 Event listener leak: Listeners without removal detected');
  }
  
  // Large data processing
  if (diffLower.includes('map(') && diffLower.includes('filter(') && diffLower.includes('reduce(')) {
    risks.performance.push('🐌 Performance: Multiple array operations chained');
  }
  
  // Synchronous operations
  if (diffLower.includes('sync') && !diffLower.includes('async')) {
    risks.performance.push('🐌 Blocking operation: Synchronous I/O detected');
  }
  
  // Large loops
  const loopPatterns = lines.filter(line => 
    line.includes('for(') || line.includes('while(') || line.includes('forEach(')
  );
  if (loopPatterns.length > 3) {
    risks.performance.push('🐌 Performance: Multiple loops detected');
  }
}

/**
 * Advanced reliability risk analysis
 */
function analyzeReliabilityRisks(diff, lines, risks) {
  const diffLower = diff.toLowerCase();
  
  // Error handling
  if (diffLower.includes('try') && !diffLower.includes('catch')) {
    risks.reliability.push('💥 Unhandled errors: Try block without catch');
  }
  
  // Promise handling
  if (diffLower.includes('promise') && !diffLower.includes('catch')) {
    risks.reliability.push('💥 Promise errors: Missing error handling');
  }
  
  // Async/await
  if (diffLower.includes('async') && diffLower.includes('await')) {
    risks.reliability.push('💥 Async errors: Verify proper error handling');
  }
  
  // Null/undefined checks
  if (diffLower.includes('null') || diffLower.includes('undefined')) {
    risks.reliability.push('💥 Null safety: Potential null/undefined access');
  }
  
  // Network calls
  if (diffLower.includes('fetch') || diffLower.includes('axios') || diffLower.includes('request')) {
    risks.reliability.push('💥 Network reliability: HTTP calls without timeout/retry');
  }
  
  // Database operations
  if (diffLower.includes('database') || diffLower.includes('db.') || diffLower.includes('query')) {
    risks.reliability.push('💥 Database reliability: DB operations without error handling');
  }
}

/**
 * Advanced maintainability risk analysis
 */
function analyzeMaintainabilityRisks(diff, lines, risks) {
  const diffLower = diff.toLowerCase();
  
  // Magic numbers
  if (diffLower.includes('magic') && diffLower.includes('number')) {
    risks.maintainability.push('🔧 Magic numbers: Consider using constants');
  }
  
  // Hardcoded values
  if (diffLower.includes('hardcoded') || diffLower.includes('hard-coded')) {
    risks.maintainability.push('🔧 Hardcoded values: Consider configuration');
  }
  
  // Complex conditionals
  const complexConditions = lines.filter(line => 
    line.includes('&&') && line.includes('||') && line.length > 100
  );
  if (complexConditions.length > 0) {
    risks.maintainability.push('🔧 Complex logic: Consider breaking down complex conditions');
  }
  
  // Long functions
  const functionLines = lines.filter(line => line.includes('function') || line.includes('=>'));
  if (functionLines.length > 10) {
    risks.maintainability.push('🔧 Function complexity: Consider breaking down large functions');
  }
  
  // Duplicate code
  const duplicatePatterns = findDuplicatePatterns(lines);
  if (duplicatePatterns.length > 0) {
    risks.maintainability.push('🔧 Code duplication: Consider extracting common logic');
  }
}

/**
 * Advanced build risk analysis
 */
function analyzeBuildRisks(diff, lines, risks) {
  const diffLower = diff.toLowerCase();
  
  // Import analysis
  const importLines = lines.filter(line => line.includes('import') && line.includes('from'));
  if (importLines.length > 5) {
    risks.build.push('🔨 Import complexity: Multiple imports detected');
  }
  
  // Variable declarations
  const declaredVariables = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('const ') || trimmedLine.startsWith('let ') || trimmedLine.startsWith('var ')) {
      const match = trimmedLine.match(/(?:const|let|var)\s+(\w+)/);
      if (match) {
        declaredVariables.push(match[1]);
      }
    }
  }
  
  if (declaredVariables.length > 10) {
    risks.build.push('🔨 Variable complexity: Multiple declarations detected');
  }
  
  // Destructured imports
  if (diffLower.includes('import') && diffLower.includes('{') && diffLower.includes('}')) {
    risks.build.push('🔨 Destructured imports: Verify all imported items are used');
  }
  
  // TypeScript issues
  if (diffLower.includes('typescript') || diffLower.includes('tsconfig')) {
    risks.build.push('🔨 TypeScript: Verify type definitions and compilation');
  }
}

/**
 * Architecture risk analysis
 */
function analyzeArchitectureRisks(diff, changedFiles, risks) {
  const diffLower = diff.toLowerCase();
  
  // Cross-cutting concerns
  if (changedFiles.some(f => f.includes('auth')) && changedFiles.some(f => f.includes('api'))) {
    risks.architecture.push('🏗️ Cross-cutting: Authentication and API changes together');
  }
  
  // Database schema changes
  if (changedFiles.some(f => f.includes('migration') || f.includes('schema'))) {
    risks.architecture.push('🏗️ Schema change: Database migration detected');
  }
  
  // API changes
  if (changedFiles.some(f => f.includes('api') || f.includes('route'))) {
    risks.architecture.push('🏗️ API change: Backend API modifications detected');
  }
  
  // Frontend changes
  if (changedFiles.some(f => f.includes('component') || f.includes('ui'))) {
    risks.architecture.push('🏗️ UI change: Frontend component modifications detected');
  }
  
  // Configuration changes
  if (changedFiles.some(f => f.includes('config') || f.includes('env'))) {
    risks.architecture.push('🏗️ Configuration: Environment or config changes detected');
  }
}

/**
 * Data integrity risk analysis
 */
function analyzeDataIntegrityRisks(diff, lines, risks) {
  const diffLower = diff.toLowerCase();
  
  // Data validation
  if (diffLower.includes('validation') || diffLower.includes('validate')) {
    risks.dataIntegrity.push('📊 Data validation: Verify input validation logic');
  }
  
  // Data transformation
  if (diffLower.includes('transform') || diffLower.includes('map') || diffLower.includes('filter')) {
    risks.dataIntegrity.push('📊 Data transformation: Verify data integrity during processing');
  }
  
  // Data persistence
  if (diffLower.includes('save') || diffLower.includes('store') || diffLower.includes('persist')) {
    risks.dataIntegrity.push('📊 Data persistence: Verify data consistency during storage');
  }
  
  // Data migration
  if (diffLower.includes('migrate') || diffLower.includes('migration')) {
    risks.dataIntegrity.push('📊 Data migration: Verify data integrity during migration');
  }
}

/**
 * Find duplicate code patterns
 */
function findDuplicatePatterns(lines) {
  const patterns = [];
  const seen = new Set();
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.length > 20 && !line.startsWith('//') && !line.startsWith('*')) {
      if (seen.has(line)) {
        patterns.push(line);
      } else {
        seen.add(line);
      }
    }
  }
  
  return patterns;
}

/**
 * Generate fallback analysis based on deep code context
 */
function generateDeepFallbackAnalysis(title, body, diff, codeContext) {
  console.log('🔄 Generating intelligent fallback analysis based on deep code context');
  
  const prInfo = extractPRInfo(title, body, diff);
  
  // Extract specific features from the PR description
  const features = [];
  if (body) {
    if (body.includes('text area')) features.push('direct text input');
    if (body.includes('tag support') || body.includes('#')) features.push('tag system');
    if (body.includes('To-Do') || body.includes('todo')) features.push('todo management');
    if (body.includes('Dashboard') || body.includes('dashboard')) features.push('dashboard enhancements');
    if (body.includes('AI') || body.includes('artificial intelligence')) features.push('AI integration');
    if (body.includes('overdue') || body.includes('priority')) features.push('priority management');
    if (body.includes('sub-tasks') || body.includes('subtasks')) features.push('subtask support');
  }

  // Determine if the changes are primarily frontend or backend
  const isFrontendChange = codeContext.patterns.frontend;
  const isBackendChange = codeContext.patterns.backend;

  // Generate specific questions based on the type of change
  const questions = [];
  if (isFrontendChange) {
    questions.push(`How does the new ${features.includes('tag system') ? 'tag extraction regex in utils.js' : 'input processing'} handle special characters like #meeting-2024-01-15 and #urgent! in the text area?`);
    questions.push(`What happens when a user enters 2000+ characters with 25+ tags like #work #personal #urgent #meeting #followup #blocked in a single thought?`);
    questions.push(`How does the ${features.includes('AI integration') ? 'AI categorization service in services.js' : 'new service'} handle rate limiting when processing 50+ thoughts simultaneously during peak usage?`);
    questions.push(`Are there any database schema changes or migrations that need to be tested in staging before production deployment?`);
  } else if (isBackendChange) {
    questions.push(`How does the new ${prInfo.featureName} in api.js handle rate limiting when processing 50+ requests simultaneously during peak usage?`);
    questions.push(`Are there any database schema changes or migrations that need to be tested in staging before production deployment?`);
  } else {
    questions.push(`How does the new ${prInfo.featureName} handle rate limiting when processing 50+ requests simultaneously during peak usage?`);
    questions.push(`Are there any database schema changes or migrations that need to be tested in staging before production deployment?`);
  }

  // Generate a test recipe based on the type of change
  const testRecipe = {};
  if (isFrontendChange) {
    testRecipe.criticalPath = [
      `As a user, I can add a thought with tags and see it categorized correctly in the today view`,
      `As a user, I can mark a thought as urgent and see the priority icon change immediately`,
      `As a user, I can view today's insights and see AI-generated recommendations`
    ];
    testRecipe.edgeCases = [
      `As a user, I can add a thought with 50+ tags and the system handles it gracefully`,
      `As a user, I can try to add a thought with empty content and get appropriate feedback`,
      `As a user, I can still use the app when the AI service is down`
    ];
    testRecipe.automation = {
      unit: [
        `Test tag extraction function with input 'Hello #work #urgent #meeting-2024' returns ['work', 'urgent', 'meeting-2024']`,
        `Test input validation with 10,000 characters and 100 tags, verify it rejects or truncates appropriately`
      ],
      integration: [
        `Test POST /api/thoughts with valid JSON containing 15 tags and verify all are stored in database with correct relationships`,
        `Test AI service integration with mock responses: success (200ms), timeout (30s), error (500) scenarios`
      ],
      e2e: [
        `User opens app, enters 'Daily standup notes #work #meeting #followup #urgent', saves, verifies in todo view, checks dashboard shows correct categorization`,
        `Test complete workflow with 50 thoughts containing various tag combinations: #work+#personal, #urgent+#blocked, #today+#tomorrow`
      ]
    };
  } else if (isBackendChange) {
    testRecipe.criticalPath = [
      `As a user, I can use the main functionality that was changed`,
      `As a user, I can still access existing features without issues`,
      `As a user, I get appropriate error messages when something goes wrong`
    ];
    testRecipe.edgeCases = [
      `As a user, I can handle invalid inputs gracefully`,
      `As a user, I can recover from errors and continue using the app`,
      `As a user, I can use the app under normal load conditions`
    ];
    testRecipe.automation = {
      unit: [`Add unit tests for new functionality`],
      integration: [`Test integration points and dependencies`],
      e2e: [`Verify end-to-end user workflows`]
    };
  } else {
    testRecipe.criticalPath = [
      `As a user, I can use the main functionality that was changed`,
      `As a user, I can still access existing features without issues`,
      `As a user, I get appropriate error messages when something goes wrong`
    ];
    testRecipe.edgeCases = [
      `As a user, I can handle invalid inputs gracefully`,
      `As a user, I can recover from errors and continue using the app`,
      `As a user, I can use the app under normal load conditions`
    ];
    testRecipe.automation = {
      unit: [`Add unit tests for new functionality`],
      integration: [`Test integration points and dependencies`],
      e2e: [`Verify end-to-end user workflows`]
    };
  }

  // Generate risks based on code context
  const risks = [];
  if (codeContext.complexity.totalLines > 1000) {
    risks.push(`Large codebase changes (${codeContext.complexity.totalLines} lines) - potential for complex interactions and regressions`);
  }
  if (codeContext.complexity.additions > 500) {
    risks.push(`Significant additions (${codeContext.complexity.additions} lines) - potential for new bugs and regressions`);
  }
  if (codeContext.complexity.deletions > 500) {
    risks.push(`Significant deletions (${codeContext.complexity.deletions} lines) - potential for regressions and missing functionality`);
  }
  if (codeContext.risks.security.length > 0) {
    risks.push(`Security risks identified in code: ${codeContext.risks.security.join(', ')}`);
  }
  if (codeContext.risks.performance.length > 0) {
    risks.push(`Performance risks identified in code: ${codeContext.risks.performance.join(', ')}`);
  }
  if (codeContext.risks.reliability.length > 0) {
    risks.push(`Reliability risks identified in code: ${codeContext.risks.reliability.join(', ')}`);
  }
  if (codeContext.risks.maintainability.length > 0) {
    risks.push(`Maintainability risks identified in code: ${codeContext.risks.maintainability.join(', ')}`);
  }
  if (codeContext.risks.build.length > 0) {
    risks.push(`Build risks identified in code: ${codeContext.risks.build.join(', ')}`);
  }

  return {
    summary: {
      riskLevel: "MEDIUM",
      shipScore: 7,
      reasoning: `Medium risk due to deep code changes and potential for complex interactions. ${prInfo.featureName} changes are primarily ${prInfo.affectedArea}.`
    },
    questions: questions,
    testRecipe: testRecipe,
    risks: risks
  };
}

/**
 * Generate short QA insights for a pull request (only Release Confidence Score, Risks, Test Recipe)
 * @param {Object} options - PR details
 * @param {string} options.repo - Repository name (e.g., "owner/repo")
 * @param {number} options.pr_number - Pull request number
 * @param {string} options.title - PR title
 * @param {string} options.body - PR description/body
 * @param {string} options.diff - Code diff
 * @returns {Promise<Object>} Short QA insights or error object
 */
async function generateShortAnalysis({ repo, pr_number, title, body, diff }) {
  try {
    // Validate OpenAI client
    if (!openai) {
      throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
    }

    console.log(`🔍 Starting SHORT ANALYSIS for PR #${pr_number} in ${repo}`);

    // Validate that we have real PR data, not simulated/fake data
    const isSimulatedData = diff && (
      diff.includes('This is a simulated PR description') ||
      diff.includes('diff --git a/src/auth.js b/src/auth.js') ||
      diff.includes('const jwt = require(\'jsonwebtoken\')') ||
      diff.includes('Error fetching PR diff') ||
      diff === 'No code changes detected'
    );

    if (isSimulatedData || !diff || diff.length < 50) {
      console.log('⚠️ Detected simulated/fake data or missing PR diff - cannot perform real analysis');
      const errorInsights = generateShortDataAccessError(title, repo, pr_number);
      return {
        success: true,
        data: errorInsights,
        metadata: {
          repo, pr_number, model: 'short-data-access-error', timestamp: new Date().toISOString(),
          note: 'Unable to access real PR data due to authentication or permission issues',
          analysisType: 'short-data-access-error'
        }
      };
    }

    // Sanitize inputs for short analysis
    const sanitizedTitle = trunc(title || 'No title provided', 200);
    const sanitizedBody = trunc(body || 'No description provided', 1000);
    const sanitizedDiff = trunc(diff, 4000); // Lower limit for short analysis

    console.log(`🔍 Short analysis input: Title=${sanitizedTitle.length} chars, Body=${sanitizedBody.length} chars, Diff=${sanitizedDiff.length} chars`);

    // Load and render the short analysis prompt template
    const promptTemplatePath = path.join(__dirname, 'prompts', 'short-analysis.ejs');
    let prompt;
    
    if (!fs.existsSync(promptTemplatePath)) {
      throw new Error('Short analysis template not found');
    }
    
    const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');
    prompt = ejs.render(promptTemplate, {
      title: sanitizedTitle,
      body: sanitizedBody,
      diff: sanitizedDiff
    });

    console.log(`📝 Generated prompt length: ${prompt.length} characters`);

    // Call OpenAI API with short analysis prompt
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are Ovi AI, FirstQA\'s senior QA engineer. Generate ONLY the requested short analysis format with the exact sections specified. Do not include any additional content or explanations outside the format.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 2000, // Lower token limit for short analysis
      temperature: 0.1, // Very low temperature for maximum consistency
      top_p: 0.9
    });

    if (!response.choices || !response.choices[0] || !response.choices[0].message) {
      throw new Error('Invalid response from OpenAI API');
    }

    const aiResponse = response.choices[0].message.content.trim();
    console.log(`✅ Short analysis generated successfully (${aiResponse.length} characters)`);

    return {
      success: true,
      data: aiResponse, // Return the raw AI response as it's already formatted
      metadata: {
        repo,
        pr_number,
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        timestamp: new Date().toISOString(),
        analysisType: 'short-analysis',
        promptLength: prompt.length,
        responseLength: aiResponse.length
      }
    };

  } catch (error) {
    console.error('❌ Error generating short analysis:', error.message);
    
    // Generate fallback short analysis
    const fallbackInsights = generateShortFallbackAnalysis(title, body, diff);
    
    return {
      success: true,
      data: fallbackInsights,
      metadata: {
        repo,
        pr_number,
        model: 'short-fallback',
        timestamp: new Date().toISOString(),
        error: error.message,
        note: 'Fallback short analysis due to AI processing error',
        analysisType: 'short-fallback'
      }
    };
  }
}

/**
 * Generate short fallback analysis when AI fails
 */
function generateShortFallbackAnalysis(title, body, diff) {
  return `# 🎯 Ovi QA Analysis - Short Version

## 📊 Deployment Score

| Metric | Value | Notes |
|---------|---------|-------|
| **Score** | 5.0/10 | (Pass threshold: 7.5) |
| **Risk** | Medium | (0 blocker, 2 majors) |
| **Confidence** | Low | (AI analysis failed - manual review required) |
| **Scope** | Unknown files, unknown LOC touched, unknown feature flags |
| **Decision** | ❌ Block | (run manual review before proceeding) |

## ⚠️ Risks

**Based on actual code changes and diff analysis:**

- AI analysis could not be completed - manual review needed
- Unable to perform detailed risk analysis due to system error
- Please review the changes manually for potential issues

*Focus on concrete risks from the code, not general best practices*

## 🧪 Test Recipe

| Scenario | Steps | Expected Result | Priority | Type |
|----------|-------|-----------------|----------|------|
| Core functionality test | Test the main feature that was changed | Main feature works as expected | Critical | ❌ Manual |
| Basic user workflow | Complete the primary user journey | End-to-end success | Critical | ❌ Manual |
| Main functionality | Test the core changes | Core feature works | Critical | ❌ Manual |
| Integration points | Test affected systems | No breaking changes | Critical | ❌ Manual |
| Error handling | Trigger failure conditions | Graceful error handling | High | ❌ Manual |

---

*Note: This is a fallback analysis due to AI processing error. Please review the actual code changes manually.*`;
}

/**
 * Generate short data access error insights
 */
function generateShortDataAccessError(title, repo, prNumber) {
  return `# 🎯 Ovi QA Analysis - Short Version

## 📊 Deployment Score

| Metric | Value | Notes |
|---------|---------|-------|
| **Score** | 3.0/10 | (Pass threshold: 7.5) |
| **Risk** | High | (1 blocker, 2 majors) |
| **Confidence** | Low | (Cannot review actual code changes) |
| **Scope** | Unknown files, unknown LOC touched, unknown feature flags |
| **Decision** | ❌ Block | (run manual review before proceeding) |

## ⚠️ Risks

**Based on actual code changes and diff analysis:**

- Unable to access PR data for automated analysis
- Cannot perform code review due to permission issues
- Manual review required to assess risks

*Focus on concrete risks from the code, not general best practices*

## 🧪 Test Recipe

| Scenario | Steps | Expected Result | Priority | Type |
|----------|-------|-----------------|----------|------|
| Manual code review | Review the actual code changes | Identify potential issues | Critical | ❌ Manual |
| Basic functionality | Test the main feature manually | Core feature works | Critical | ❌ Manual |
| Code review | Examine the diff manually | Understand the changes | Critical | ❌ Manual |
| Testing | Test affected functionality | Verify no regressions | Critical | ❌ Manual |
| Integration | Test with related systems | No breaking changes | High | ❌ Manual |

---

*Note: Unable to access PR data. Please review the actual code changes manually.*`;
}

/**
 * Generate QA insights for tickets (Linear/Jira) using GPT-4o
 * @param {Object} options - Ticket details
 * @param {string} options.ticketId - Ticket ID (e.g., "PROJ-123")
 * @param {string} options.title - Ticket title
 * @param {string} options.description - Ticket description
 * @param {Array} options.comments - Array of comment strings
 * @param {Array} options.labels - Array of label strings
 * @param {string} options.platform - Platform name ("linear" or "jira")
 * @param {string} options.priority - Priority level
 * @param {string} options.type - Ticket type
 * @returns {Promise<Object>} QA insights or error object
 */
async function generateTicketInsights({ ticketId, title, description, comments, labels, platform, priority, type }) {
  try {
    // Validate OpenAI client
    if (!openai) {
      throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
    }

    console.log(`🔍 Starting SINGLE FAST TICKET ANALYSIS for ${ticketId} on ${platform}`);

    // Sanitize inputs (safe for any type)
    const sanitizedTitle = trunc(title || 'No title provided', 300);
    const sanitizedDescription = trunc(description || 'No description provided', 2000);
    const sanitizedComments = comments.slice(0, 3).map(c => trunc(c, 500)); // Last 3 comments, max 500 chars each
    const sanitizedLabels = labels.slice(0, 10); // Max 10 labels

    console.log(`🔍 Ticket analysis input: Title=${sanitizedTitle.length} chars, Description=${sanitizedDescription.length} chars, Comments=${sanitizedComments.length}, Labels=${sanitizedLabels.length}`);

    // Generate single fast analysis with low temperature
    const analysis = await generateSingleAnalysis(sanitizedTitle, sanitizedDescription, sanitizedComments, sanitizedLabels, platform, priority, type);
    
    return {
      success: true,
      data: analysis,
      metadata: {
        ticketId,
        platform,
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        timestamp: new Date().toISOString(),
        analysisType: 'ticket-analysis-single-fast'
      }
    };

  } catch (error) {
    console.error('❌ Error in ticket analysis:', error.message);
    
    // Return fallback analysis
    return {
      success: true,
      data: generateTicketFallbackAnalysis(title, description, platform),
      metadata: {
        ticketId,
        platform,
        model: 'fallback',
        timestamp: new Date().toISOString(),
        error: error.message,
        note: 'Fallback analysis due to error',
        analysisType: 'ticket-fallback'
      }
    };
  }
}

// Removed calculateInitialReadinessScore - now handled by AI

async function generateSingleAnalysis(title, description, comments, labels, platform, priority, type) {
  const prompt = `You are a senior QA engineer analyzing tickets for development readiness. 

CRITICAL: Every ticket is UNIQUE. Analyze THIS SPECIFIC TICKET only. Do NOT use generic feedback or copy-paste from previous analyses.

Evaluate based ONLY on what's actually present in THIS ticket.

**IMPLEMENTATION-SPECIFIC ANALYSIS REQUIREMENTS:**
- **ALWAYS** extract and specify exact requirements, acceptance criteria, and expected behaviors from the ticket description
- **NEVER** use generic descriptions like "works correctly", "handles gracefully", or "proper functionality"
- **INCLUDE** specific user actions, data inputs, validation rules, and expected outputs mentioned in the ticket
- When analyzing ticket requirements:
  - Extract all specific user actions and workflows described
  - Identify exact validation rules, constraints, and business logic mentioned
  - Note any specific data formats, field requirements, or input constraints
  - Include specific acceptance criteria and success conditions
- Replace generic expected results with implementation-specific ones:
  - Instead of "User can upload file successfully", specify "User uploads .jpg/.png file under 10MB, sees 'Upload successful' message, file appears in gallery"
- For any validation, input handling, or user workflows:
  - Test exact input constraints and validation rules mentioned
  - Test boundary conditions (min/max values, character limits, file sizes)
  - Test edge cases (empty inputs, invalid formats, error states)
  - Test all possible user actions and workflow paths described
- Provide concrete test data examples that demonstrate:
  - Each specific user action mentioned in the ticket
  - Boundary conditions and validation limits
  - Edge cases and error scenarios
  - Realistic usage scenarios based on the ticket context
- Instead of generic error handling descriptions, specify:
  - Exact error messages or user feedback mentioned in the ticket
  - Specific fallback behaviors or default states
  - Precise UI behavior during error states
  - Recovery mechanisms or user guidance
- When identifying risks or issues:
  - Specify exact scenarios that could break the described functionality
  - Identify specific edge cases not covered in the ticket
  - Suggest concrete test scenarios for boundary conditions
  - Focus on real risks based on the actual ticket requirements
- Before finalizing analysis, verify:
  - All user actions and workflows are explicitly stated
  - All validation rules and constraints are specified
  - Concrete test data examples are provided
  - Boundary conditions are covered
  - Error handling specifics are detailed with exact behaviors
  - Test scenarios are immediately actionable without additional investigation
- Focus purely on ticket requirements and acceptance criteria, not assumptions about implementation
- Extract facts from the ticket description rather than making inferences
- Provide specific, verifiable details rather than general statements
- Let the ticket requirements speak for themselves in the analysis

TICKET DATA:
- Title: ${title}
- Description: ${description}
- Comments: ${comments.join(' | ')}
- Labels: ${labels.join(', ')}
- Priority: ${priority}
- Type: ${type}

You are analyzing as a senior QA Engineer and CTO with deep startup experience. Be direct, actionable, and prioritize what matters.

OUTPUT STRUCTURE:

- readinessScore: number 1-5. How ready is this ticket for development (clarity of requirements, acceptance criteria).
- affectedAreas: array of strings (e.g. ["auth", "registration", "validation"]).
- highestRisk: string or null. If there's a notable risk or blocker, state it briefly. Otherwise omit or null.
- recommendations: array of max 5 items. Each item must be a READY-TO-COPY acceptance criteria or text block that can be pasted directly into the ticket body. Full, self-contained sentences.
- testRecipe: REQUIRED. array of 4-8 test scenarios { testType, scenario, priority }. Sort by priority (Smoke first, then Critical Path, then Regression).
  - testType: "UI" | "API" | "Unit/Component" | "Manual". Use UI for user-facing flows (including E2E). Smoke must be UI for functional changes (user perspective). For non-functional (e.g. backend-only): use API as smoke if no UI, or UI if the API is consumed in the UI. Unit/Component for isolated logic/components.
  - priority: "Smoke" | "Critical Path" | "Regression"

MINIMAL MODE: If ticket has insufficient info, return minimalMode: true, readinessScore, affectedAreas, highestRisk (if any), recommendations, testRecipe.

**ENHANCED TEST RECIPE REQUIREMENTS:**
- **Boundary Testing**: Include boundary test cases for any numeric inputs, character limits, file sizes, or validation constraints mentioned in the ticket
- **Specific Data Examples**: Provide concrete test data that matches the ticket requirements (e.g., specific email formats, file types, user names, etc.)
- **Validation Testing**: Test exact validation rules mentioned in the ticket (e.g., "password must be 8+ characters", "email format validation", "file size limit 10MB")
- **Error State Testing**: Test specific error scenarios and edge cases that could occur based on the ticket description
- **User Workflow Testing**: Test complete user journeys described in the ticket with realistic data
- **State Testing**: Test all possible states, statuses, or conditions mentioned in the ticket
- **Edge Case Prioritization**: For Edge Case scenarios, focus ONLY on the most impactful edge cases specific to THIS ticket. Prioritize scenarios that could cause the highest risk, most user confusion, or biggest system failures based on the ticket's specific functionality
- For each test scenario:
  - Use specific, realistic test data that matches the ticket context
  - Include exact input values, expected outputs, and validation criteria
  - Specify boundary conditions (min/max values, edge cases)
  - Include error scenarios and recovery paths
  - Make steps detailed and immediately actionable

Return JSON format. For FULL analysis:
{
  "minimalMode": false,
  "readinessScore": 4,
  "affectedAreas": ["area1", "area2"],
  "highestRisk": "Brief risk if any, or null",
  "recommendations": [
    "**Input fields:** Email (required, valid format), Password (8+ chars), Username (3-20 chars).",
    "**Post-registration:** User is auto-signed in and redirected to dashboard. Show welcome toast.",
    "**Error handling:** Inline validation per field. On submit failure: toast with error, keep form data, retry option."
  ],
  "testRecipe": [
    {"testType": "UI", "scenario": "Complete registration with valid inputs → user lands on dashboard", "priority": "Smoke"},
    {"testType": "API", "scenario": "Submit invalid email format → returns 400 with clear error message", "priority": "Critical Path"}
  ]
}

Recommendations: ready-to-paste text for the ticket body. Test scenarios: clear, complete descriptions. No blocked/caveat suffixes.`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, // Very low temperature for consistency and speed
    max_tokens: 2000
  });

  const content = response.choices[0].message.content;
  
  // Log summary instead of full response
  console.log('🤖 AI response:', {
    length: content.length,
    usage: response.usage,
    model: response.model
  });
  
  // Extract JSON from the response
  const jsonMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[1]);
  }
  
  // Try to parse the entire response as JSON
  return JSON.parse(content);
}

/**
 * Generate fallback analysis when AI fails for tickets
 */

/**
 * Generate fallback analysis when AI fails for tickets
 */
function generateTicketFallbackAnalysis(title, description, platform) {
  return {
    minimalMode: false,
    readinessScore: 3,
    affectedAreas: ['auth', 'email', 'security'],
    highestRisk: null,
    recommendations: [
      '**Error handling:** Specify expected error messages, retry behavior, and user feedback.',
      '**Validation:** Define validation rules and inline error display.'
    ],
    testRecipe: [
      { testType: 'UI', scenario: 'Successful flow → user can complete action', priority: 'Smoke' },
      { testType: 'API', scenario: 'Invalid input → returns appropriate error', priority: 'Critical Path' }
    ]
  };
}

/**
 * Analyze algorithms and computational patterns in the diff
 */
function analyzeAlgorithms(diff) {
  const algorithms = {
    sorting: [],
    searching: [],
    hashing: [],
    recursion: [],
    loops: [],
    dataStructures: [],
    complexity: {}
  };

  const lines = diff.split('\n');
  const codeLines = lines.filter(line => line.startsWith('+') || line.startsWith('-')).map(line => line.substring(1));

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i].toLowerCase();
    
    // Detect sorting algorithms
    if (line.includes('sort') || line.includes('sorted') || line.includes('ordering')) {
      algorithms.sorting.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect searching algorithms
    if (line.includes('find') || line.includes('search') || line.includes('indexof') || line.includes('includes')) {
      algorithms.searching.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect hashing
    if (line.includes('hash') || line.includes('map') || line.includes('dictionary') || line.includes('object')) {
      algorithms.hashing.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect recursion
    if (line.includes('function') && (line.includes('return') || line.includes('recursive'))) {
      algorithms.recursion.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect loops and their complexity
    if (line.includes('for') || line.includes('while') || line.includes('foreach')) {
      algorithms.loops.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect data structures
    if (line.includes('array') || line.includes('list') || line.includes('stack') || line.includes('queue')) {
      algorithms.dataStructures.push({ line: i + 1, context: line.trim() });
    }
  }

  // Estimate complexity
  algorithms.complexity = {
    timeComplexity: estimateTimeComplexity(codeLines),
    spaceComplexity: estimateSpaceComplexity(codeLines),
    nestedLoops: algorithms.loops.length > 2
  };

  return algorithms;
}

/**
 * Analyze boundary conditions and edge cases
 */
function analyzeBoundaries(diff) {
  const boundaries = {
    numeric: [],
    string: [],
    array: [],
    object: [],
    nullChecks: [],
    edgeCases: []
  };

  const lines = diff.split('\n');
  const codeLines = lines.filter(line => line.startsWith('+') || line.startsWith('-')).map(line => line.substring(1));

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i];
    
    // Detect numeric boundaries
    const numberMatches = line.match(/\b\d+\b/g);
    if (numberMatches) {
      boundaries.numeric.push({ line: i + 1, values: numberMatches, context: line.trim() });
    }
    
    // Detect string operations
    if (line.includes('length') || line.includes('substring') || line.includes('slice')) {
      boundaries.string.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect array operations
    if (line.includes('length') && (line.includes('[') || line.includes('array'))) {
      boundaries.array.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect null/undefined checks
    if (line.includes('null') || line.includes('undefined') || line.includes('?')) {
      boundaries.nullChecks.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect edge case handling
    if (line.includes('if') && (line.includes('empty') || line.includes('zero') || line.includes('max'))) {
      boundaries.edgeCases.push({ line: i + 1, context: line.trim() });
    }
  }

  return boundaries;
}

/**
 * Analyze performance implications
 */
function analyzePerformance(diff) {
  const performance = {
    bottlenecks: [],
    memoryUsage: [],
    asyncOperations: [],
    loops: [],
    apiCalls: []
  };

  const lines = diff.split('\n');
  const codeLines = lines.filter(line => line.startsWith('+') || line.startsWith('-')).map(line => line.substring(1));

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i].toLowerCase();
    
    // Detect potential bottlenecks
    if (line.includes('for') && line.includes('for')) { // Nested loops
      performance.bottlenecks.push({ line: i + 1, type: 'nested_loops', context: line.trim() });
    }
    
    // Detect memory-intensive operations
    if (line.includes('new array') || line.includes('clone') || line.includes('copy')) {
      performance.memoryUsage.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect async operations
    if (line.includes('async') || line.includes('await') || line.includes('promise')) {
      performance.asyncOperations.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect API calls
    if (line.includes('fetch') || line.includes('axios') || line.includes('http')) {
      performance.apiCalls.push({ line: i + 1, context: line.trim() });
    }
  }

  return performance;
}

/**
 * Analyze concurrency and thread safety
 */
function analyzeConcurrency(diff) {
  const concurrency = {
    raceConditions: [],
    locks: [],
    asyncOperations: [],
    sharedState: [],
    threadSafety: []
  };

  const lines = diff.split('\n');
  const codeLines = lines.filter(line => line.startsWith('+') || line.startsWith('-')).map(line => line.substring(1));

  for (let i = 0; i < codeLines.length; i++) {
    const line = codeLines[i].toLowerCase();
    
    // Detect async operations
    if (line.includes('async') || line.includes('await') || line.includes('promise')) {
      concurrency.asyncOperations.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect shared state modifications
    if (line.includes('this.') || line.includes('global') || line.includes('window.')) {
      concurrency.sharedState.push({ line: i + 1, context: line.trim() });
    }
    
    // Detect potential race conditions
    if (line.includes('settimeout') || line.includes('setinterval') || line.includes('event')) {
      concurrency.raceConditions.push({ line: i + 1, context: line.trim() });
    }
  }

  return concurrency;
}

/**
 * Estimate time complexity based on code patterns
 */
function estimateTimeComplexity(codeLines) {
  let complexity = 'O(1)';
  let nestedLoops = 0;
  let hasRecursion = false;
  
  for (const line of codeLines) {
    const lowerLine = line.toLowerCase();
    
    // Count nested loops
    if (lowerLine.includes('for') || lowerLine.includes('while')) {
      nestedLoops++;
    }
    
    // Detect recursion
    if (lowerLine.includes('function') && lowerLine.includes('return')) {
      hasRecursion = true;
    }
  }
  
  if (nestedLoops > 1) {
    complexity = `O(n^${nestedLoops})`;
  } else if (nestedLoops === 1) {
    complexity = 'O(n)';
  } else if (hasRecursion) {
    complexity = 'O(log n) to O(n)';
  }
  
  return complexity;
}

/**
 * Estimate space complexity based on code patterns
 */
function estimateSpaceComplexity(codeLines) {
  let complexity = 'O(1)';
  let hasArrays = false;
  let hasRecursion = false;
  
  for (const line of codeLines) {
    const lowerLine = line.toLowerCase();
    
    if (lowerLine.includes('array') || lowerLine.includes('[]')) {
      hasArrays = true;
    }
    
    if (lowerLine.includes('function') && lowerLine.includes('return')) {
      hasRecursion = true;
    }
  }
  
  if (hasArrays && hasRecursion) {
    complexity = 'O(n)';
  } else if (hasArrays) {
    complexity = 'O(n)';
  } else if (hasRecursion) {
    complexity = 'O(log n)';
  }
  
  return complexity;
}

module.exports = {
  generateQAInsights,
  generateShortAnalysis,
  generateTicketInsights,
  testConnection
}; 