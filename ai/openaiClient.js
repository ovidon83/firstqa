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
 * Generate QA insights for a pull request with DEEP CODE ANALYSIS
 * @param {Object} options - PR details
 * @param {string} options.repo - Repository name (e.g., "owner/repo")
 * @param {number} options.pr_number - Pull request number
 * @param {string} options.title - PR title
 * @param {string} options.body - PR description/body
 * @param {string} options.diff - Code diff
 * @returns {Promise<Object>} QA insights or error object
 */
async function generateQAInsights({ repo, pr_number, title, body, diff }) {
  try {
    // Validate OpenAI client
    if (!openai) {
      throw new Error('OpenAI client not initialized. Check OPENAI_API_KEY.');
    }

    console.log(`🔍 Starting DEEP CODE ANALYSIS for PR #${pr_number} in ${repo}`);

    // Extract file paths from diff for comprehensive analysis
    const changedFiles = extractChangedFiles(diff);
    console.log(`📁 Changed files detected: ${changedFiles.length} files`);

    // Get comprehensive code context
    const codeContext = await buildCodeContext(repo, pr_number, changedFiles, diff);
    
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

    // Sanitize inputs with much higher limits for deep analysis
    const sanitizedTitle = (title || 'No title provided').substring(0, 300);
    const sanitizedBody = (body || 'No description provided').substring(0, 2000);
    const sanitizedDiff = diff.substring(0, 8000); // Much higher limit
    const sanitizedContext = JSON.stringify(codeContext).substring(0, 6000); // Code context

    console.log(`🔍 Deep analysis input: Title=${sanitizedTitle.length} chars, Body=${sanitizedBody.length} chars, Diff=${sanitizedDiff.length} chars, Context=${sanitizedContext.length} chars`);

    // Load and render the deep analysis prompt template
    const promptTemplatePath = path.join(__dirname, 'prompts', 'deep-analysis.ejs');
    let prompt;
    
    if (!fs.existsSync(promptTemplatePath)) {
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
    } else {
      console.log('✅ Using deep analysis template for comprehensive code review');
      const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');
      prompt = ejs.render(promptTemplate, {
        repo,
        pr_number,
        title: sanitizedTitle,
        body: sanitizedBody,
        diff: sanitizedDiff,
        codeContext: sanitizedContext,
        changedFiles: changedFiles
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

        // Log the raw response for debugging (truncated)
        console.log('🔍 Raw AI response (first 500 chars):', response.substring(0, 500));
        console.log('🔍 Response length:', response.length);

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
    testRecipe: {
      criticalPath: [
        "Test the main functionality that was changed",
        "Verify that existing features still work as expected",
        "Check for any new error conditions or edge cases"
      ],
      edgeCases: [
        "Test with invalid or unexpected inputs",
        "Check error handling and recovery",
        "Verify performance under load if applicable"
      ],
      automation: {
        unit: ["Add unit tests for new functionality"],
        integration: ["Test integration points and dependencies"],
        e2e: ["Verify end-to-end user workflows"]
      }
    },
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
 * Build comprehensive code context for deep analysis
 */
async function buildCodeContext(repo, pr_number, changedFiles, diff) {
  const context = {
    changedFiles: changedFiles,
    fileTypes: {},
    complexity: {},
    dependencies: {},
    patterns: {},
    risks: {}
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

  // Detect potential risk patterns
  context.risks = detectRiskPatterns(diff, changedFiles);

  return context;
}

/**
 * Detect risk patterns in code changes
 */
function detectRiskPatterns(diff, changedFiles) {
  const risks = {
    security: [],
    performance: [],
    reliability: [],
    maintainability: [],
    build: []
  };

  const diffLower = diff.toLowerCase();
  const filesLower = changedFiles.map(f => f.toLowerCase());

  // Security risks
  if (diffLower.includes('innerhtml') || diffLower.includes('dangerouslysetinnerhtml')) {
    risks.security.push('Potential XSS vulnerability with innerHTML usage');
  }
  if (diffLower.includes('eval(') || diffLower.includes('settimeout(') || diffLower.includes('setinterval(')) {
    risks.security.push('Potential code injection with eval/setTimeout/setInterval');
  }
  if (diffLower.includes('sql') && (diffLower.includes('select') || diffLower.includes('insert') || diffLower.includes('update'))) {
    risks.security.push('SQL queries detected - verify proper parameterization');
  }

  // Performance risks
  if (diffLower.includes('foreach') && diffLower.includes('api') && diffLower.includes('call')) {
    risks.performance.push('Potential N+1 query pattern with forEach and API calls');
  }
  if (diffLower.includes('settimeout') || diffLower.includes('setinterval')) {
    risks.performance.push('Timers detected - verify cleanup to prevent memory leaks');
  }
  if (diffLower.includes('addlistener') || diffLower.includes('addeventlistener')) {
    risks.performance.push('Event listeners detected - verify proper removal');
  }

  // Reliability risks
  if (diffLower.includes('try') && !diffLower.includes('catch')) {
    risks.reliability.push('Try block without catch - potential unhandled errors');
  }
  if (diffLower.includes('async') && diffLower.includes('await')) {
    risks.reliability.push('Async/await usage - verify proper error handling');
  }
  if (diffLower.includes('promise') && !diffLower.includes('catch')) {
    risks.reliability.push('Promises detected - verify error handling');
  }

  // Maintainability risks
  if (diffLower.includes('magic') && diffLower.includes('number')) {
    risks.maintainability.push('Magic numbers detected - consider constants');
  }
  if (diffLower.includes('hardcoded') || diffLower.includes('hard-coded')) {
    risks.maintainability.push('Hardcoded values detected - consider configuration');
  }

  // Build risks - detect potential unused imports and variables
  const lines = diff.split('\n');
  const importLines = lines.filter(line => line.includes('import') && line.includes('from'));
  const declaredVariables = [];
  
  // Look for variable declarations
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('const ') || trimmedLine.startsWith('let ') || trimmedLine.startsWith('var ')) {
      const match = trimmedLine.match(/(?:const|let|var)\s+(\w+)/);
      if (match) {
        declaredVariables.push(match[1]);
      }
    }
  }

  // Check for potential unused imports (imports that might not be used)
  if (importLines.length > 5) {
    risks.build.push('Multiple imports detected - verify all imports are actually used to avoid TypeScript compilation errors');
  }

  // Check for potential unused variables
  if (declaredVariables.length > 10) {
    risks.build.push('Multiple variable declarations detected - verify all variables are used to avoid TypeScript compilation errors');
  }

  // Look for specific patterns that often lead to unused imports
  if (diffLower.includes('import') && diffLower.includes('{') && diffLower.includes('}')) {
    risks.build.push('Destructured imports detected - verify all imported items are used');
  }

  return risks;
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
    const sanitizedTitle = (title || 'No title provided').substring(0, 200);
    const sanitizedBody = (body || 'No description provided').substring(0, 1000);
    const sanitizedDiff = diff.substring(0, 4000); // Lower limit for short analysis

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

    // Sanitize inputs
    const sanitizedTitle = (title || 'No title provided').substring(0, 300);
    const sanitizedDescription = (description || 'No description provided').substring(0, 2000);
    const sanitizedComments = comments.slice(0, 3).map(c => c.substring(0, 500)); // Last 3 comments, max 500 chars each
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

TICKET DATA:
- Title: ${title}
- Description: ${description}
- Comments: ${comments.join(' | ')}
- Labels: ${labels.join(', ')}
- Priority: ${priority}
- Type: ${type}

DUAL SCORING SYSTEM - REQUIRED:
1. initialReadinessScore (1-5): Rate how ready this ticket is for development RIGHT NOW, as-is
2. readyForDevelopmentScore (1-5): Rate how ready this ticket is AFTER adding your analysis (Risks, Questions, Test Recipe)

CRITICAL: You MUST provide BOTH scores. readyForDevelopmentScore should always be >= initialReadinessScore because your analysis enhances the ticket.

SCORING SCALE (1-5):
1 = Not ready (major gaps)
2 = Needs work (some key info missing)
3 = Decent (basic requirements clear)
4 = Good (well-defined with clear AC)
5 = Excellent (comprehensive, edge cases covered)

Analyze THIS specific ticket content. Generate unique insights based on what's actually written.

MINIMAL ANALYSIS MODE: If the ticket has insufficient information (very vague title, no description, or extremely brief content), return a minimal analysis with:
- minimalMode: true
- readyForDevelopmentScore: 1
- scoreImpactFactors: explain what's missing
- message: explain that more details are needed before full analysis
- Skip qaQuestions, testRecipe, and other detailed fields

For normal tickets:
- Determine changeType (frontend/backend/full-stack) from ticket content
- For frontend tickets: look for design materials (Figma, mockups, screenshots, etc.)
- For backend tickets: focus on APIs, data models, business logic
- Generate userValue: simple metric (High/Medium/Low) and short summary of user benefit
- Generate scoreImpactFactors that explain your specific score for THIS ticket
- Generate improvementsNeeded: specific, actionable items that would bridge the gap between initialReadinessScore and readyForDevelopmentScore. Each item should be specific to THIS ticket (e.g., "Add AC: User sees success message after file upload" not generic advice)
- For testRecipe priority values, use ONLY: "Happy Path" (core functionality), "Critical Path" (important scenarios), "Edge Case" (edge cases)

Return JSON format - MUST include BOTH initialReadinessScore AND readyForDevelopmentScore:

For MINIMAL analysis (insufficient info):
{
  "title": "Definition of Ready Analysis",
  "minimalMode": true,
  "initialReadinessScore": 1,
  "readyForDevelopmentScore": 1,
  "scoreImpactFactors": ["what's missing from this ticket"],
  "message": "This ticket needs more detail before full analysis. Adding [specifics] would enable better development planning and reduce confusion."
}

For FULL analysis (sufficient info):
{
  "title": "Definition of Ready Analysis",
  "minimalMode": false,
  "changeType": "frontend|backend|full-stack",
  "hasDesignMaterials": true|false,
  "designDetails": "description" or null,
  "userValue": {"level": "High|Medium|Low", "summary": "short description of user benefit"},
  "qaQuestions": ["array of 5-8 questions"],
  "keyRisks": ["array of risks"],
  "scoreImpactFactors": ["array of score factors"],
  "improvementsNeeded": ["specific actionable items to bridge the gap between scores"],
  "testRecipe": [{"scenario": "...", "steps": "...", "expected": "...", "priority": "Happy Path|Critical Path|Edge Case", "automation": "...", "reason": "..."}],
  "initialReadinessScore": 1-5,
  "readyForDevelopmentScore": 1-5,
  "scoreBreakdown": {"clarity": 0.0-1.0, "dependencies": 0.0-1.0, "testability": 0.0-1.0, "riskProfile": 0.0-1.0, "scopeReadiness": 0.0-1.0, "rawTotal": 0.0-5.0, "scaledScore": 1-5},
  "tip": "actionable suggestion",
  "missingInfo": ["specific missing details"]
}

Generate ALL important test scenarios, not just 3. Ask the 'What if' questions that matter.`;

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1, // Very low temperature for consistency and speed
    max_tokens: 2000
  });

  const content = response.choices[0].message.content;
  console.log('🤖 Raw AI response:', content);
  
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
    title: 'Definition of Ready Analysis',
    qaQuestions: [
      "What if the user enters an invalid email format? How should the system respond?",
      "What if the email service is down when a user requests a password reset?",
      "What if a user clicks the reset link multiple times? Should we allow it?",
      "What if the user's email has changed since they last logged in?",
      "What if the password reset token expires while the user is filling out the form?"
    ],
    keyRisks: [
      "Security risk: Password reset tokens could be intercepted if not using HTTPS; mitigate with secure token generation and HTTPS enforcement.",
      "User experience risk: Users may get frustrated if reset emails are delayed; implement clear feedback and retry mechanisms.",
      "Technical risk: Email service dependency could cause password reset failures; need fallback mechanisms and monitoring."
    ],
    testRecipe: [
      {
        "scenario": "Successful Password Reset Flow",
        "steps": "1. User enters valid email. 2. User receives reset email. 3. User clicks link and sets new password.",
        "expected": "User can successfully log in with new password.",
        "priority": "Happy Path",
        "automation": "E2E",
        "reason": "Core functionality that must work perfectly for user satisfaction."
      },
      {
        "scenario": "Invalid Email Handling",
        "steps": "1. User enters invalid email format. 2. User submits form.",
        "expected": "User receives clear error message about invalid email format.",
        "priority": "Critical Path",
        "automation": "Unit",
        "reason": "Input validation is critical for security and user experience."
      },
      {
        "scenario": "Expired Token Handling",
        "steps": "1. User requests reset. 2. User waits beyond token expiration. 3. User clicks expired link.",
        "expected": "User sees clear message about expired token and option to request new one.",
        "priority": "Critical Path",
        "automation": "Integration",
        "reason": "Security requirement to prevent unauthorized password changes."
      },
      {
        "scenario": "Email Service Failure",
        "steps": "1. Email service is down. 2. User requests password reset.",
        "expected": "System logs error, shows user-friendly message, and offers retry option.",
        "priority": "Edge Case",
        "automation": "Manual",
        "reason": "Rare but critical for system reliability and user experience."
      },
      {
        "scenario": "Multiple Reset Requests",
        "steps": "1. User requests reset multiple times quickly. 2. User receives multiple emails.",
        "expected": "System handles gracefully, invalidates old tokens, and prevents abuse.",
        "priority": "Edge Case",
        "automation": "Integration",
        "reason": "Security requirement to prevent token abuse and confusion."
      },
      {
        "scenario": "Password Strength Validation",
        "steps": "1. User sets weak password. 2. User submits form.",
        "expected": "System validates password strength and shows clear requirements.",
        "priority": "Critical Path",
        "automation": "Unit",
        "reason": "Security requirement to ensure strong passwords."
      }
    ],
    readyForDevelopmentScore: 4,
    scoreBreakdown: {
      "clarity": 0.5,
      "dependencies": 0.5,
      "testability": 1.0,
      "riskProfile": 0.5,
      "scopeReadiness": 0.5,
      "uxStates": 0.5,
      "rawTotal": 3.5,
      "scaledScore": 4
    },
    tip: "Add detailed acceptance criteria, error handling scenarios, and security requirements to improve readiness score",
    missingInfo: ["Detailed acceptance criteria", "Error handling specifications", "Security requirements", "Email service integration details"]
  };
}

module.exports = {
  generateQAInsights,
  generateShortAnalysis,
  generateTicketInsights,
  testConnection
}; 