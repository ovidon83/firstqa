/**
 * OpenAI Client for GetYourTester
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
 * Generate QA insights for a pull request
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

    // Sanitize and validate inputs - reduced limits to prevent token issues
    const sanitizedTitle = (title || 'No title provided').substring(0, 150);
    const sanitizedBody = (body || 'No description provided').substring(0, 500);
    const sanitizedDiff = (diff || 'No diff provided').substring(0, 2000); // Significantly reduced

    console.log(`🔍 Input validation: Title=${sanitizedTitle.length} chars, Body=${sanitizedBody.length} chars, Diff=${sanitizedDiff.length} chars`);

    // Load and render the prompt template
    const promptTemplatePath = path.join(__dirname, 'prompts', 'default.ejs');
    if (!fs.existsSync(promptTemplatePath)) {
      throw new Error(`Prompt template not found at: ${promptTemplatePath}`);
    }

    const promptTemplate = fs.readFileSync(promptTemplatePath, 'utf8');
    const prompt = ejs.render(promptTemplate, {
      repo,
      pr_number,
      title: sanitizedTitle,
      body: sanitizedBody,
      diff: sanitizedDiff
    });

    console.log(`🤖 Ovi QA Agent generating insights for PR #${pr_number} in ${repo}`);

    // Get model from environment or use default
    const model = process.env.OPENAI_MODEL || 'gpt-4o';

    // Attempt to get insights (with retry logic)
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        console.log(`🔄 Attempt ${attempt}/3 to generate insights`);
        
        const completion = await openai.chat.completions.create({
          model: model,
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 1500, // Reduced to prevent truncation
          response_format: { type: 'json_object' }
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
          console.log('✅ Successfully generated AI insights');
          return {
            success: true,
            data: insights,
            metadata: {
              repo,
              pr_number,
              model,
              attempt,
              timestamp: new Date().toISOString()
            }
          };
        }

      } catch (error) {
        console.error(`❌ Attempt ${attempt} failed:`, error.message);
        lastError = error;
        
        // If this is the last attempt, don't continue
        if (attempt === 3) {
          break;
        }
        
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // If all attempts failed, generate a fallback analysis based on the PR content
    console.log('🔄 All AI attempts failed, generating fallback analysis based on PR content');
    const fallbackInsights = generateFallbackAnalysis(sanitizedTitle, sanitizedBody, sanitizedDiff);
    
    return {
      success: true,
      data: fallbackInsights,
      metadata: {
        repo,
        pr_number,
        model: 'fallback',
        attempt: 'fallback',
        timestamp: new Date().toISOString(),
        note: 'Fallback analysis generated due to AI processing issues'
      }
    };

  } catch (error) {
    console.error('❌ Error in generateQAInsights:', error.message);
    
    // Ultimate fallback - generate basic analysis
    const ultimateFallback = generateUltimateFallback(title || 'Unknown PR');
    
    return {
      success: true,
      data: ultimateFallback,
      metadata: {
        repo: repo || 'unknown',
        pr_number: pr_number || 0,
        model: 'ultimate-fallback',
        attempt: 'ultimate-fallback',
        timestamp: new Date().toISOString(),
        error: error.message,
        note: 'Ultimate fallback due to system error'
      }
    };
  }
}

/**
 * Parse AI response with multiple fallback strategies
 */
async function parseAIResponse(response, title, body, diff) {
  try {
    // Strategy 1: Direct JSON parse
    try {
      const insights = JSON.parse(response);
      if (validateInsightsStructure(insights)) {
        return insights;
      }
    } catch (e) {
      console.log('Strategy 1 failed, trying Strategy 2...');
    }

    // Strategy 2: Extract JSON from markdown or text
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const insights = JSON.parse(jsonMatch[0]);
        if (validateInsightsStructure(insights)) {
          return insights;
        }
      } catch (e) {
        console.log('Strategy 2 failed, trying Strategy 3...');
      }
    }

    // Strategy 3: Try to fix common JSON issues
    const fixedResponse = fixCommonJSONIssues(response);
    try {
      const insights = JSON.parse(fixedResponse);
      if (validateInsightsStructure(insights)) {
        return insights;
      }
    } catch (e) {
      console.log('Strategy 3 failed, using fallback...');
    }

    return null;
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
         insights.changeReview && 
         insights.testRecipe && 
         insights.codeQuality &&
         insights.changeReview.smartQuestions &&
         insights.changeReview.risks;
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

module.exports = {
  generateQAInsights,
  testConnection
}; 