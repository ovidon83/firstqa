/**
 * GitHub Service for webhook processing
 * Implements actual functionality for handling /qa commands
 */
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');
const githubAppAuth = require('./githubAppAuth');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const { generateAnalysisId, feedbackFooter } = require('./feedbackHelper');
// Initialize GitHub client with token (for backward compatibility)
let octokit;
let simulatedMode = false;
try {
  if (process.env.GITHUB_TOKEN) {
    octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
    console.log('✅ GitHub API client initialized with token (PAT)');
  } else {
    console.warn('⚠️ No GITHUB_TOKEN found, will use GitHub App authentication');
  }
} catch (error) {
  console.error('⚠️ Error initializing GitHub client:', error.message);
  console.warn('⚠️ Will use GitHub App authentication');
}
// Configure email transporter - DISABLED to prevent spam
let emailTransporter = null;
// try {
//   // Use nodemailer to send emails
//   emailTransporter = nodemailer.createTransport({
//     service: 'gmail',
//     auth: {
//       user: process.env.SMTP_USER || process.env.EMAIL_FROM,
//       pass: process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD
//     }
//   });
//   console.log('✅ Email transporter initialized');
// } catch (error) {
//   console.error('⚠️ Error initializing email transporter:', error.message);
// }
console.log('📧 Email notifications disabled to prevent spam');
// Ensure data directory exists
const homeDir = process.env.HOME || process.env.USERPROFILE;
let dataDir = process.env.DATA_DIR || path.join(homeDir, '.firstqa', 'data');
if (!fs.existsSync(dataDir)) {
  // Create the directory structure recursively
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory at ${dataDir}`);
  } catch (error) {
    console.error(`Failed to create data directory at ${dataDir}:`, error.message);
    // Fallback to the local data directory
    dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
      console.log(`Created fallback data directory at ${dataDir}`);
    }
  }
}
// Path to test requests storage
const TEST_REQUESTS_PATH = path.join(dataDir, 'test-requests.json');
const ARCHIVE_PATH = path.join(dataDir, 'archived-requests.json');
// Keep requests for 14 days by default
const DATA_RETENTION_DAYS = process.env.DATA_RETENTION_DAYS ? parseInt(process.env.DATA_RETENTION_DAYS) : 14;
console.log(`Test requests will be stored at: ${TEST_REQUESTS_PATH}`);
console.log(`Data retention period: ${DATA_RETENTION_DAYS} days`);
// Simple label for when Ovi AI has reviewed a PR
const OVI_REVIEWED_LABEL = 'Reviewed by Ovi AI';

/**
 * Save analysis to Supabase database
 * @param {Object} data - Analysis data
 * @returns {Promise<Object>} Database result
 */
async function saveAnalysisToDatabase(data) {
  if (!isSupabaseConfigured()) {
    console.warn('⚠️ Supabase not configured, skipping database save');
    return null;
  }
  
  const { userId, provider, repository, prNumber, prTitle, prUrl, analysisType, analysisOutput, analysisId } = data;
  
  try {
    const insertRow = {
      user_id: userId,
      provider: provider,
      repository: repository,
      pr_number: prNumber,
      pr_title: prTitle,
      pr_url: prUrl,
      analysis_type: analysisType,
      status: 'completed',
      result: analysisOutput,
      completed_at: new Date().toISOString()
    };
    if (analysisId) insertRow.id = analysisId;

    const { data: result, error } = await supabaseAdmin
      .from('analyses')
      .insert(insertRow)
      .select()
      .single();
    
    if (error) {
      throw error;
    }
    
    // Also increment user's analyses count for this month
    await supabaseAdmin.rpc('increment_user_analyses_count', {
      user_id_param: userId
    });
    
    return result;
  } catch (error) {
    console.error('Error saving analysis to database:', error);
    throw error;
  }
}

/**
 * Check if user has exceeded their usage limits
 * @param {string} userId - User UUID
 * @returns {Promise<Object>} { allowed: boolean, current: number, limit: number, plan: string }
 */
async function checkUsageLimits(userId) {
  if (!isSupabaseConfigured()) {
    return { allowed: true, current: 0, limit: Infinity, plan: 'unknown' };
  }
  
  try {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('plan, trial_started_at')
      .eq('id', userId)
      .single();
    
    if (error) throw error;
    
    const plan = user.plan || 'free_trial';
    const PAID_PLANS = ['pro', 'Pro', 'enterprise', 'Enterprise', 'Launch Partner', 'FirstQA'];

    if (PAID_PLANS.includes(plan)) {
      return { allowed: true, plan };
    }

    // Free trial: 5-day full access from trial_started_at
    const TRIAL_DAYS = 5;
    const trialStart = user.trial_started_at ? new Date(user.trial_started_at) : null;
    const trialExpired = trialStart
      ? (Date.now() - trialStart.getTime()) > TRIAL_DAYS * 24 * 60 * 60 * 1000
      : false;
    const daysLeft = trialStart
      ? Math.max(0, TRIAL_DAYS - Math.floor((Date.now() - trialStart.getTime()) / (24 * 60 * 60 * 1000)))
      : TRIAL_DAYS;

    return { allowed: !trialExpired, trialExpired, daysLeft, plan };
  } catch (error) {
    console.error('Error checking usage limits:', error);
    return { allowed: true, plan: 'error' };
  }
}

/**
 * Get production readiness score emoji
 * @param {number} score - The production readiness score (0-10)
 * @returns {string} Appropriate emoji for the production readiness level
 */
function getProductionReadinessEmoji(score) {
  if (score >= 9) return '🚀';
  if (score >= 7) return '✅';
  if (score >= 5) return '⚠️';
  if (score >= 3) return '❌';
  return '🚨';
}
/**
 * Get production readiness score emoji
 * @param {number} score - The production readiness score (0-10)
 * @returns {string} Appropriate emoji for the production readiness level
 */
function getProductionReadinessEmoji(score) {
  if (score >= 8) return '✅';
  if (score >= 5) return '⚠️';
  return '❌';
}
/**
 * Call the /generate-test-recipe endpoint for AI insights
 * @param {Object} data - PR data
 * @returns {Promise<Object>} AI insights or fallback
 */
async function callTestRecipeEndpoint(data) {
  try {
    // Determine the base URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    console.log(`📡 Calling AI endpoint: ${baseUrl}/generate-test-recipe`);
    // Make the API call
    const response = await axios.post(`${baseUrl}/generate-test-recipe`, data, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout
    });
    if (response.data && response.data.success) {
      console.log('✅ AI analysis successful');
      return response.data;
    } else {
      console.error('❌ AI analysis failed:', response.data?.error);
      throw new Error(response.data?.error || 'AI analysis failed');
    }
  } catch (error) {
    console.error('❌ Error calling AI endpoint:', error.message);
    // Use the new intelligent fallback system
    console.log('🔄 Using intelligent fallback analysis');
    const { generateQAInsights } = require('../ai/openaiClient');
    try {
      // This will use the new bulletproof system with intelligent fallbacks
      const fallbackResult = await generateQAInsights(data);
      console.log('✅ Intelligent fallback analysis completed');
      return fallbackResult;
    } catch (fallbackError) {
      console.error('❌ Even fallback failed:', fallbackError.message);
      // Ultimate fallback - generate basic analysis
      return {
        success: true,
        data: {
          changeReview: {
            smartQuestions: [
              "What is the main purpose of these changes?",
              "Are there any breaking changes that could affect existing functionality?",
              "Have you tested the core functionality manually?",
              "Are there any dependencies or integrations that might be affected?",
              "What is the expected user impact of these changes?"
            ],
            risks: [
              "Unable to perform detailed risk analysis due to system error",
              "Please review the changes manually for potential issues",
              "Consider testing the affected functionality thoroughly"
            ],
            productionReadinessScore: {
              score: 5,
              level: "Needs Manual Review",
              reasoning: "System error occurred - manual review required to assess production readiness",
              criticalIssues: [
                "System analysis could not be completed - manual review needed"
              ],
              recommendations: [
                "Review the changes manually before proceeding",
                "Test the affected functionality thoroughly",
                "Consider running the full test suite"
              ]
            }
          },
          testRecipe: {
            criticalPath: [
              "Test the main functionality that was changed",
              "Verify that existing features still work as expected",
              "Check for any new error conditions or edge cases"
            ],
            general: [
              "Run the existing test suite",
              "Test the user interface if UI changes were made",
              "Verify API endpoints if backend changes were made"
            ],
            edgeCases: [
              "Test with invalid or unexpected inputs",
              "Check error handling and recovery",
              "Verify performance under load if applicable"
            ],
            automationPlan: {
              unit: ["Add unit tests for new functionality"],
              integration: ["Test integration points and dependencies"],
              e2e: ["Verify end-to-end user workflows"]
            }
          },
          codeQuality: {
            affectedModules: [
              "Manual review needed to identify affected modules"
            ],
            testCoverage: {
              existing: "Unable to analyze existing test coverage",
              gaps: "Manual review needed to identify test gaps",
              recommendations: "Add tests for new functionality and affected areas"
            },
            bestPractices: [
              "Review code for security best practices",
              "Ensure proper error handling is in place"
            ]
          }
        },
        metadata: {
          repo: data.repo,
          pr_number: data.pr_number,
          model: 'ultimate-fallback',
          attempt: 'ultimate-fallback',
          timestamp: new Date().toISOString(),
          error: error.message,
          note: 'Ultimate fallback due to system error'
        }
      };
    }
  }
}
/**
 * Call the /generate-short-analysis endpoint for AI insights
 * @param {Object} data - PR data
 * @returns {Promise<Object>} AI insights or fallback
 */
async function callShortAnalysisEndpoint(data) {
  try {
    // Determine the base URL
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    console.log(`📡 Calling short analysis endpoint: ${baseUrl}/generate-short-analysis`);
    // Make the API call
    const response = await axios.post(`${baseUrl}/generate-short-analysis`, data, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 60000 // 60 second timeout
    });
    if (response.data && response.data.success) {
      console.log('✅ Short analysis successful');
      return response.data;
    } else {
      console.error('❌ Short analysis failed:', response.data?.error);
      throw new Error(response.data?.error || 'Short analysis failed');
    }
  } catch (error) {
    console.error('❌ Error calling short analysis endpoint:', error.message);
    // Use the intelligent fallback system for short analysis
    console.log('🔄 Using intelligent fallback for short analysis');
    const { generateShortAnalysis } = require('../ai/openaiClient');
    try {
      // This will use the new short analysis system with intelligent fallbacks
      const fallbackResult = await generateShortAnalysis(data);
      console.log('✅ Intelligent fallback short analysis completed');
      return fallbackResult;
    } catch (fallbackError) {
      console.error('❌ Even short analysis fallback failed:', fallbackError.message);
      // Ultimate fallback - generate basic short analysis
      return {
        success: true,
        data: `# 🎯 Ovi QA Analysis - Short Version
## 📊 Release Confidence Score
| Metric | Value | Notes |
|---------|---------|-------|
| 🔴 Risk | High | System error occurred during analysis |
| ⚖️ Confidence | Low | Unable to perform automated code review |
| ⭐ Score | 3/10 | Manual review required before proceeding |
## ⚠️ Risks
**Based on actual code changes and diff analysis:**
- System error occurred during AI analysis
- Unable to perform detailed risk analysis
- Manual review required to assess risks
*Focus on concrete risks from the code, not general best practices*
## 🧪 Test Recipe
### 🟢 Happy Path Scenarios
| Scenario | Steps | Expected Result | Priority |
|----------|-------|-----------------|----------|
| Core functionality test | Test the main feature that was changed | Main feature works as expected | Critical |
| Basic user workflow | Complete the primary user journey | End-to-end success | Critical |
### 🔴 Critical Path Scenarios
| Scenario | Steps | Expected Result | Priority |
|----------|-------|-----------------|----------|
| Main functionality | Test the core changes | Core feature works | Critical |
| Integration points | Test affected systems | No breaking changes | Critical |
| Error handling | Trigger failure conditions | Graceful error handling | High |
---
*Note: This is a fallback analysis due to system error. Please review the actual code changes manually.*`,
        metadata: {
          repo: data.repo,
          pr_number: data.pr_number,
          model: 'short-ultimate-fallback',
          attempt: 'short-ultimate-fallback',
          timestamp: new Date().toISOString(),
          error: error.message,
          note: 'Ultimate fallback short analysis due to system error'
        }
      };
    }
  }
}
/**
 * Load test requests from storage
 */
function loadTestRequests() {
  try {
    if (!fs.existsSync(TEST_REQUESTS_PATH)) {
      // Try to restore from backup if available
      restoreFromBackup();
      // If still doesn't exist, create empty file
      if (!fs.existsSync(TEST_REQUESTS_PATH)) {
        console.log(`Creating empty test requests file at ${TEST_REQUESTS_PATH}`);
        fs.writeFileSync(TEST_REQUESTS_PATH, JSON.stringify([]));
        return [];
      }
    }
    const data = fs.readFileSync(TEST_REQUESTS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading test requests:', error);
    return [];
  }
}
/**
 * Save test requests to storage
 */
function saveTestRequests(requests) {
  try {
    console.log(`Saving ${requests.length} test requests to ${TEST_REQUESTS_PATH}`);
    fs.writeFileSync(TEST_REQUESTS_PATH, JSON.stringify(requests, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving test requests:', error);
    return false;
  }
}
/**
 * Archive older test requests to prevent data loss
 * This keeps the main file smaller while preserving historical data
 */
function archiveOldRequests() {
  try {
    const currentRequests = loadTestRequests();
    if (currentRequests.length === 0) return true;
    // Current date minus retention period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_RETENTION_DAYS);
    // Split requests into current and archived
    const toKeep = [];
    const toArchive = [];
    currentRequests.forEach(request => {
      const requestDate = new Date(request.requestedAt);
      if (requestDate < cutoffDate && request.status.startsWith('complete')) {
        // Archive completed requests older than the retention period
        toArchive.push(request);
      } else {
        // Keep recent requests and any non-completed ones
        toKeep.push(request);
      }
    });
    if (toArchive.length === 0) return true;
    // Load existing archive
    let archivedRequests = [];
    if (fs.existsSync(ARCHIVE_PATH)) {
      const archiveData = fs.readFileSync(ARCHIVE_PATH, 'utf8');
      archivedRequests = JSON.parse(archiveData);
    }
    // Add newly archived requests
    archivedRequests = [...archivedRequests, ...toArchive];
    // Save updated files
    fs.writeFileSync(ARCHIVE_PATH, JSON.stringify(archivedRequests, null, 2));
    fs.writeFileSync(TEST_REQUESTS_PATH, JSON.stringify(toKeep, null, 2));
    console.log(`Archived ${toArchive.length} old requests. Active requests: ${toKeep.length}`);
    return true;
  } catch (error) {
    console.error('Error archiving old requests:', error);
    return false;
  }
}
/**
 * Load both current and archived test requests
 * This can be used for the dashboard to show complete history
 */
function loadAllTestRequests() {
  const currentRequests = loadTestRequests();
  try {
    if (fs.existsSync(ARCHIVE_PATH)) {
      const archiveData = fs.readFileSync(ARCHIVE_PATH, 'utf8');
      const archivedRequests = JSON.parse(archiveData);
      // Return combined results with current requests first
      return [...currentRequests, ...archivedRequests];
    }
  } catch (error) {
    console.error('Error loading archived requests:', error);
  }
  return currentRequests;
}
/**
 * Parse a /qa comment to extract test request details
 */
function parseTestRequestComment(comment) {
  // Skip the "/qa" part
  const content = comment.replace(/^\/qa\s+/, '').trim();
  const parsedDetails = {
    // Include the full content as the first field
    fullContent: content
  };
  // Parse common patterns
  // Look for environment details
  const envMatch = content.match(/(?:environment|env):\s*([^\n]+)/i);
  if (envMatch) {
    parsedDetails.environment = envMatch[1].trim();
  }
  // Look for browser details
  const browserMatch = content.match(/(?:browser|browsers):\s*([^\n]+)/i);
  if (browserMatch) {
    parsedDetails.browsers = browserMatch[1].trim();
  }
  // Look for device details
  const deviceMatch = content.match(/(?:device|devices):\s*([^\n]+)/i);
  if (deviceMatch) {
    parsedDetails.devices = deviceMatch[1].trim();
  }
  // Look for test scope/focus area
  const scopeMatch = content.match(/(?:scope|focus area|test area):\s*([^\n]+)/i);
  if (scopeMatch) {
    parsedDetails.scope = scopeMatch[1].trim();
  }
  // Look for priority
  const priorityMatch = content.match(/(?:priority):\s*([^\n]+)/i);
  if (priorityMatch) {
    parsedDetails.priority = priorityMatch[1].trim();
  }
  // Look for any special instructions
  const instructionsMatch = content.match(/(?:instructions|notes):\s*([^\n]+(?:\n[^\n]+)*)/i);
  if (instructionsMatch) {
    parsedDetails.instructions = instructionsMatch[1].trim();
  }
  // If we couldn't parse structured information, ensure we at least have the full content
  if (Object.keys(parsedDetails).length === 1 && content) {
    parsedDetails.description = content;
  }
  return parsedDetails;
}
/**
 * Send email notification about a new test request
 */
async function sendEmailNotification(testRequest) {
  if (!emailTransporter) {
    console.log('[SIMULATED] Email notification would be sent but transporter not available');
    return { success: false, simulated: true };
  }
  try {
          const toEmail = process.env.NOTIFICATION_EMAIL || process.env.EMAIL_TO || 'hello@firstqa.dev';
    const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@firstqa.dev';
    // Extract repository owner and name
    const [owner, repo] = testRequest.repository ? testRequest.repository.split('/') : ['unknown', 'unknown'];
    const mailOptions = {
              from: `"FirstQA" <${fromEmail}>`,
      to: toEmail,
      subject: `Ovi QA Analysis Complete for PR #${testRequest.prNumber}`,
      html: `
        <h2>🤖 Ovi QA Analysis Complete</h2>
        <p>Ovi QA Assistant has completed analysis of this PR.</p>
        <h3>Request Details:</h3>
        <ul>
          <li><strong>Request ID:</strong> ${testRequest.id}</li>
          <li><strong>Repository:</strong> ${testRequest.repository}</li>
          <li><strong>PR Number:</strong> <a href="${testRequest.prUrl}">#${testRequest.prNumber}</a></li>
          <li><strong>Requested by:</strong> ${testRequest.requestedBy}</li>
          <li><strong>Date:</strong> ${new Date(testRequest.requestedAt).toLocaleString()}</li>
          <li><strong>Status:</strong> ${testRequest.status}</li>
        </ul>
        <h3>PR Description:</h3>
        <div style="background-color: #f6f8fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <pre style="white-space: pre-wrap; font-family: monospace;">${testRequest.prDescription || 'No description provided'}</pre>
        </div>
        <h3>Test Request Content:</h3>
        <div style="background-color: #f6f8fa; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
          <pre style="white-space: pre-wrap; font-family: monospace;">${testRequest.comment ? testRequest.comment.replace(/^\/qa\s+/, '').trim() : 'No content available'}</pre>
        </div>
        <p>Please login to the <a href="http://localhost:3000/dashboard" style="background-color: #0366d6; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">dashboard</a> to view full analysis details.</p>
        <p>Thank you,<br/>Ovi QA Assistant</p>
      `,
      text: `
🤖 Ovi QA Analysis Complete
Ovi QA Assistant has completed analysis of this PR.
Request Details:
- Request ID: ${testRequest.id}
- Repository: ${testRequest.repository}
- PR Number: #${testRequest.prNumber}
- Requested by: ${testRequest.requestedBy}
- Date: ${new Date(testRequest.requestedAt).toLocaleString()}
- Status: ${testRequest.status}
PR Description:
${testRequest.prDescription || 'No description provided'}
Test Request Content:
        ${testRequest.comment ? testRequest.comment.replace(/^\/qa\s+/, '').trim() : 'No content available'}
Please login to the dashboard to view full analysis details: http://localhost:3000/dashboard
Thank you,
Ovi QA Assistant
      `
    };
    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Email notification sent: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    console.error('Failed to send email notification:', error.message);
    return { success: false, error: error.message };
  }
}
/**
 * Fetch PR description from GitHub
 */
async function fetchPRDescription(repository, prNumber) {
  try {
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repository}. Should be in format 'owner/repo'`);
      return 'Error: Invalid repository format';
    }
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) {
      console.error(`❌ Failed to get authentication for ${repository} - app may not be installed`);
      return `Error: GitHub App not installed on ${repository} or insufficient permissions`;
    }
    const response = await repoOctokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber
    });
    return response.data.body || 'No description provided';
  } catch (error) {
    console.error(`Failed to fetch PR description for ${repository}#${prNumber}:`, error.message);
    return `Error fetching PR description: ${error.message}`;
  }
}
/**
 * Fetch PR details (changed_files, additions, deletions, files)
 */
async function fetchPR(repository, prNumber) {
  try {
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) return { changed_files: 0, additions: 0, deletions: 0, files: [] };
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) return { changed_files: 0, additions: 0, deletions: 0, files: [] };
    const { data: pr } = await repoOctokit.pulls.get({ owner, repo: repoName, pull_number: prNumber });
    const { data: filesData } = await repoOctokit.pulls.listFiles({ owner, repo: repoName, pull_number: prNumber });
    return {
      changed_files: pr.changed_files ?? filesData?.length ?? 0,
      additions: pr.additions ?? 0,
      deletions: pr.deletions ?? 0,
      files: (filesData || []).map(f => f.filename)
    };
  } catch (error) {
    console.warn('fetchPR failed:', error.message);
    return { changed_files: 0, additions: 0, deletions: 0, files: [] };
  }
}

/**
 * Fetch PR diff for AI analysis
 */
async function fetchPRDiff(repository, prNumber) {
  try {
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repository}. Should be in format 'owner/repo'`);
      return 'Error: Invalid repository format';
    }
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) {
      console.error(`❌ Failed to get authentication for ${repository} - app may not be installed`);
      return `Error fetching PR diff: GitHub App not installed on ${repository} or insufficient permissions`;
    }
    // Get PR files to construct diff
    const response = await repoOctokit.pulls.listFiles({
      owner,
      repo: repoName,
      pull_number: prNumber
    });
    // Combine patches from all files
    let fullDiff = '';
    response.data.forEach(file => {
      if (file.patch) {
        fullDiff += `diff --git a/${file.filename} b/${file.filename}\n`;
        fullDiff += file.patch + '\n\n';
      }
    });
    return fullDiff || 'No code changes detected';
  } catch (error) {
    console.error(`Failed to fetch PR diff for ${repository}#${prNumber}:`, error.message);
    return 'Error fetching PR diff';
  }
}

/** Max file size (chars) to fetch - skip larger files */
const MAX_FILE_CONTENT_CHARS = 8000;
/** Max number of code files to fetch full contents for */
const MAX_FILES_TO_FETCH = 12;
/** File extensions to prioritize for full content (UI/test-relevant) */
const PRIORITY_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte', '.py', '.java', '.go', '.rb'];

/**
 * Fetch full file contents for changed files (for accurate test case generation)
 * Prioritizes UI/frontend files where data-testid, aria-label, and selectors live
 * @param {string} repository - owner/repo
 * @param {number} prNumber - PR number
 * @returns {Promise<Object>} { fileContents: { path: string }, selectorHints: [...] }
 */
async function fetchChangedFileContents(repository, prNumber) {
  try {
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) return { fileContents: {}, selectorHints: [] };

    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) return { fileContents: {}, selectorHints: [] };

    const prResponse = await repoOctokit.pulls.get({ owner, repo: repoName, pull_number: prNumber });
    const headSha = prResponse.data.head.sha;

    const filesResponse = await repoOctokit.pulls.listFiles({ owner, repo: repoName, pull_number: prNumber });
    const codeFiles = filesResponse.data
      .filter(f => f.filename && !f.filename.includes('node_modules') && !f.filename.includes('dist'))
      .filter(f => /\.(js|ts|jsx|tsx|vue|svelte|py|java|go|rb|c|cs|php|ejs|html|erb|hbs|pug)$/i.test(f.filename));

    // Prioritize UI files (contain selectors, test IDs)
    codeFiles.sort((a, b) => {
      const score = (f) => {
        const ext = (f.filename.match(/\.[^.]+$/) || [])[0] || '';
        if (PRIORITY_EXTENSIONS.includes(ext)) return 10;
        if (f.filename.includes('component') || f.filename.includes('Button') || f.filename.includes('Form')) return 5;
        return 1;
      };
      return score(b) - score(a);
    });

    const fileContents = {};
    const selectorHints = [];
    let fetched = 0;

    for (const file of codeFiles) {
      if (fetched >= MAX_FILES_TO_FETCH) break;
      if (file.status === 'removed') continue;
      try {
        const { data } = await repoOctokit.repos.getContent({
          owner, repo: repoName, path: file.filename, ref: headSha
        });
        if (data.type !== 'file' || !data.content) continue;
        const content = Buffer.from(data.content, 'base64').toString('utf8');
        if (content.length > MAX_FILE_CONTENT_CHARS) continue;
        fileContents[file.filename] = content;
        fetched++;

        // Extract selector patterns for automation hints
        const patternConfigs = [
          { re: /data-testid=["']([^"']+)["']/g, type: 'data-testid' },
          { re: /aria-label=["']([^"']+)["']/g, type: 'aria-label' },
          { re: /id=["']([^"']+)["']/g, type: 'id' },
          { re: /name=["']([^"']+)["']/g, type: 'name' },
          { re: /data-cy=["']([^"']+)["']/g, type: 'data-cy' },
          { re: /testId["'\s:=]+["']?([a-zA-Z0-9_-]+)["']?/gi, type: 'testId' },
        ];
        patternConfigs.forEach(({ re, type }) => {
          let m;
          while ((m = re.exec(content)) !== null) {
            selectorHints.push({ file: file.filename, type, value: m[1] });
          }
        });
      } catch (err) {
        console.warn(`Could not fetch ${file.filename}:`, err.message);
      }
    }

    console.log(`📂 Fetched full contents for ${Object.keys(fileContents).length} files, ${selectorHints.length} selector hints`);
    return { fileContents, selectorHints };
  } catch (error) {
    console.warn('fetchChangedFileContents failed:', error.message);
    return { fileContents: {}, selectorHints: [] };
  }
}

/**
 * Get the last analyzed commit SHA for a PR
 * @param {string} repository - Repository name (e.g., "owner/repo")
 * @param {number} prNumber - Pull request number
 * @returns {string|null} - Last analyzed commit SHA or null if not found
 */
function getLastAnalyzedCommitSHA(repository, prNumber) {
  try {
    const testRequests = loadTestRequests();
    // Find the most recent test request for this PR that has a lastAnalyzedCommitSHA
    const prRequests = testRequests
      .filter(req => req.repository === repository && req.prNumber === prNumber)
      .filter(req => req.lastAnalyzedCommitSHA) // Only those with tracked commits
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt)); // Most recent first
    
    if (prRequests.length > 0) {
      return prRequests[0].lastAnalyzedCommitSHA;
    }
    return null;
  } catch (error) {
    console.error(`Error getting last analyzed commit SHA for ${repository}#${prNumber}:`, error.message);
    return null;
  }
}

/**
 * Fetch commits for a PR since a specific commit SHA
 * @param {string} repository - Repository name (e.g., "owner/repo")
 * @param {number} prNumber - Pull request number
 * @param {string} sinceSHA - Commit SHA to start from (exclusive)
 * @returns {Promise<Array>} - Array of commit objects
 */
async function fetchCommitsSince(repository, prNumber, sinceSHA) {
  try {
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repository}`);
      return [];
    }

    let repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) {
      console.error(`❌ Failed to get authentication for ${repository}`);
      return [];
    }

    // Get PR details to find the base and head refs
    const prResponse = await repoOctokit.pulls.get({
      owner,
      repo: repoName,
      pull_number: prNumber
    });

    const baseSHA = prResponse.data.base.sha;
    const headSHA = prResponse.data.head.sha;

    // Get all commits for the PR (handle pagination)
    let allCommits = [];
    let page = 1;
    const perPage = 100;
    let hasMore = true;
    
    while (hasMore) {
      const commitsResponse = await repoOctokit.pulls.listCommits({
        owner,
        repo: repoName,
        pull_number: prNumber,
        per_page: perPage,
        page: page
      });
      
      const commits = commitsResponse.data;
      allCommits = allCommits.concat(commits);
      
      // Check if there are more pages
      hasMore = commits.length === perPage;
      page++;
      
      console.log(`📄 Fetched page ${page - 1}: ${commits.length} commits (total so far: ${allCommits.length})`);
    }
    
    console.log(`✅ Fetched ${allCommits.length} total commit(s) from PR`);
    
    // GitHub API returns commits in reverse chronological order (newest first)
    // So allCommits[0] = latest commit (HEAD), allCommits[N] = oldest commit
    
    // If sinceSHA is provided, filter commits after that SHA
    if (sinceSHA) {
      // Find the index of the sinceSHA commit
      // Try exact match first
      let sinceIndex = allCommits.findIndex(commit => commit.sha === sinceSHA);
      
      // If not found, try matching just the first 7 chars (short SHA)
      if (sinceIndex === -1) {
        const shortSHA = sinceSHA.substring(0, 7);
        sinceIndex = allCommits.findIndex(commit => commit.sha.startsWith(shortSHA));
        if (sinceIndex >= 0) {
          console.log(`🔍 Found last analyzed SHA by short match: ${shortSHA} → ${allCommits[sinceIndex].sha.substring(0, 7)}`);
        }
      }
      
      console.log(`🔍 Looking for last analyzed SHA: ${sinceSHA.substring(0, 7)}`);
      console.log(`📋 All ${allCommits.length} commit SHAs (newest first): ${allCommits.map(c => `${c.sha.substring(0, 7)}`).join(', ')}`);
      console.log(`📋 Commit messages (newest first): ${allCommits.map(c => `${c.commit?.message?.split('\n')[0] || 'N/A'}`).join(' | ')}`);
      
      if (sinceIndex >= 0) {
        // Return commits that came AFTER sinceSHA (indices 0 to sinceIndex-1)
        // These are the NEWER commits
        const newCommits = allCommits.slice(0, sinceIndex);
        console.log(`📊 Commit filtering: Found ${allCommits.length} total commits`);
        console.log(`   Last analyzed commit: index ${sinceIndex} - ${allCommits[sinceIndex].sha.substring(0, 7)} (${allCommits[sinceIndex].commit?.message?.split('\n')[0] || 'N/A'})`);
        console.log(`   Returning ${newCommits.length} NEW commit(s) (indices 0-${sinceIndex - 1}):`);
        newCommits.forEach((c, i) => {
          console.log(`   ${i + 1}. [${i}] ${c.sha.substring(0, 7)} - ${c.commit?.message?.split('\n')[0] || 'N/A'}`);
        });
        
        if (newCommits.length === 0 && sinceIndex === 0) {
          console.log(`⚠️ WARNING: sinceIndex is 0, meaning the HEAD commit was already analyzed. This shouldn't happen if new commits were added.`);
        }
        
        return newCommits;
      } else {
        console.log(`⚠️ Last analyzed SHA ${sinceSHA.substring(0, 7)} not found in commit list - might be rebased or force-pushed`);
        console.log(`   Will analyze all ${allCommits.length} commits`);
      }
      // If sinceSHA not found, it might be a rebase or force push
      console.log(`⚠️ Commit SHA ${sinceSHA} not found in PR commits (might be rebased/force-pushed), analyzing all ${allCommits.length} commits`);
      console.log(`   Available commit SHAs: ${allCommits.slice(0, 5).map(c => c.sha.substring(0, 7)).join(', ')}...`);
    }

    return allCommits;
  } catch (error) {
    console.error(`Failed to fetch commits for ${repository}#${prNumber}:`, error.message);
    return [];
  }
}

/**
 * Fetch commit details including diff and message
 * @param {string} repository - Repository name (e.g., "owner/repo")
 * @param {string} commitSHA - Commit SHA
 * @returns {Promise<Object>} - Commit details with message and diff
 */
async function fetchCommitDetails(repository, commitSHA) {
  try {
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      return { sha: commitSHA, message: '', diff: '' };
    }

    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) {
      return { sha: commitSHA, message: '', diff: '' };
    }

    // Get commit details
    const commitResponse = await repoOctokit.repos.getCommit({
      owner,
      repo: repoName,
      ref: commitSHA
    });

    const commit = commitResponse.data;
    const message = commit.commit.message || '';
    
    // Get the diff for this commit (parent to commit)
    let diff = '';
    if (commit.files && commit.files.length > 0) {
      commit.files.forEach(file => {
        if (file.patch) {
          diff += `diff --git a/${file.filename} b/${file.filename}\n`;
          diff += file.patch + '\n\n';
        } else if (file.status === 'added' || file.status === 'removed') {
          diff += `${file.status === 'added' ? '+++' : '---'} ${file.filename}\n`;
        }
      });
    }

    return {
      sha: commitSHA,
      message: message,
      diff: diff || 'No changes in this commit',
      author: commit.commit.author.name || '',
      date: commit.commit.author.date || ''
    };
  } catch (error) {
    console.error(`Failed to fetch commit details for ${commitSHA}:`, error.message);
    return { sha: commitSHA, message: '', diff: '', error: error.message };
  }
}

/**
 * Fetch new commits with their details since last analysis
 * @param {string} repository - Repository name
 * @param {number} prNumber - Pull request number
 * @param {string} lastAnalyzedSHA - Last analyzed commit SHA
 * @returns {Promise<Array>} - Array of commit details with diffs and messages
 */
async function fetchNewCommitsWithDetails(repository, prNumber, lastAnalyzedSHA) {
  try {
    console.log(`🔍 Fetching new commits since ${lastAnalyzedSHA || 'beginning'} for ${repository}#${prNumber}`);
    
    const newCommits = await fetchCommitsSince(repository, prNumber, lastAnalyzedSHA);
    
    if (newCommits.length === 0) {
      console.log('✅ No new commits found');
      return [];
    }

    console.log(`📦 Found ${newCommits.length} new commit(s), fetching details...`);

    // Fetch details for each commit
    const commitDetails = await Promise.all(
      newCommits.map(commit => fetchCommitDetails(repository, commit.sha))
    );

    console.log(`✅ Fetched details for ${commitDetails.length} commit(s)`);
    return commitDetails;
  } catch (error) {
    console.error(`❌ Error fetching new commits with details:`, error.message);
    return [];
  }
}
/**
 * Post a comment on a GitHub PR
 */
async function postComment(repo, issueNumber, body) {
  try {
    console.log(`📝 Attempting to post comment to ${repo}#${issueNumber}`);
    // Force refresh the GitHub App token by clearing cache
    const [owner, repository] = repo.split('/');
    const installationToken = await githubAppAuth.getInstallationToken(owner, repository, true); // Force refresh
    if (!installationToken) {
      console.error('❌ Failed to get installation token for posting comment');
      console.log('[SIMULATED] Would post comment to PR');
      return { success: false, error: 'No installation token available' };
    }
    const octokit = new Octokit({ auth: installationToken });
    const response = await octokit.issues.createComment({
      owner,
      repo: repository,
      issue_number: issueNumber,
      body: body
    });
    console.log(`✅ Comment posted successfully to ${repo}#${issueNumber}`);
    return { success: true, commentId: response.data.id };
  } catch (error) {
    console.error(`❌ Failed to post comment to ${repo}#${issueNumber}:`, error.message);
    // If it's an authentication error, try to refresh the token
    if (error.status === 401 || error.message.includes('Bad credentials')) {
      console.log('🔄 Authentication error detected, attempting token refresh...');
      try {
        const [owner, repository] = repo.split('/');
        // Clear any cached token and get a fresh one
        const freshToken = await githubAppAuth.getInstallationToken(owner, repository, true); // Force refresh
        if (freshToken) {
          const freshOctokit = new Octokit({ auth: freshToken });
          const response = await freshOctokit.issues.createComment({
            owner,
            repo: repository,
            issue_number: issueNumber,
            body: body
          });
          console.log(`✅ Comment posted successfully after token refresh to ${repo}#${issueNumber}`);
          return { success: true, commentId: response.data.id };
        }
      } catch (refreshError) {
        console.error('❌ Token refresh also failed:', refreshError.message);
      }
    }
    console.log('[SIMULATED] Would post comment to PR');
    return { success: false, error: error.message };
  }
}

/**
 * Add the "Reviewed by Ovi" label to a GitHub PR
 */
async function addOviReviewedLabel(repo, issueNumber) {
  try {
    const [owner, repoName] = repo.split('/');
    // Handle case where repo might not have correct format
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repo}. Should be in format 'owner/repo'`);
      return { success: false, error: 'Invalid repository format' };
    }
    // Get an Octokit instance for this repository
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) {
      console.log(`[SIMULATED] Would add "Reviewed by Ovi" label to ${repo}#${issueNumber}`);
      return { success: true, simulated: true };
    }
    const response = await repoOctokit.issues.addLabels({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      labels: [OVI_REVIEWED_LABEL]
    });
    console.log(`"Reviewed by Ovi" label added to ${repo}#${issueNumber}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`Failed to add "Reviewed by Ovi" label to ${repo}#${issueNumber}:`, error.message);
    // Check if the error is due to invalid credentials or permissions
    if (error.status === 401 || error.status === 403) {
      console.warn('Authentication error: Invalid GitHub token or insufficient permissions');
    } else if (error.status === 404) {
      console.warn(`Repository or issue not found: ${repo}#${issueNumber}`);
    }
    console.log(`[SIMULATED] Would add "Reviewed by Ovi" label to ${repo}#${issueNumber}`);
    return { success: true, simulated: true, error: error.message };
  }
}
/**
 * Post a comment to a PR from a test request
 */
async function postCommentToPR(requestId, commentBody, newStatus = null) {
  const testRequests = loadTestRequests();
  const testRequest = testRequests.find(r => r.id === requestId);
  if (!testRequest) {
    throw new Error(`Test request with ID ${requestId} not found`);
  }
  if (!testRequest.repository || !testRequest.prNumber) {
    throw new Error('Test request does not have valid repository or PR information');
  }
  // Format the comment
  let formattedComment = '';
  if (newStatus) {
    // Merge status update with the tester comment
    formattedComment = `
## 💬 Tester Comment
${commentBody}
**Status update:** ${newStatus}
`;
    // Update the test request status
    await updateTestRequestStatus(requestId, newStatus, false); // Don't post a separate status comment
  } else {
    // Standard comment without status update
    formattedComment = `
## 💬 Tester Comment
${commentBody}
    `;
  }
  // Post the comment
  const result = await postComment(testRequest.repository, testRequest.prNumber, formattedComment);
  return result;
}
/**
 * Update a test request status
 */
async function updateTestRequestStatus(requestId, newStatus, postCommentUpdate = true) {
  const testRequests = loadTestRequests();
  const testRequest = testRequests.find(r => r.id === requestId);
  if (!testRequest) {
    throw new Error(`Test request with ID ${requestId} not found`);
  }
  // Update the status
  const oldStatus = testRequest.status;
  testRequest.status = newStatus;
  saveTestRequests(testRequests);
  // Post a comment about the status change if requested
  if (postCommentUpdate && testRequest.repository && testRequest.prNumber) {
    const statusComment = `
## 🔄 Test Status Update
The test request status has been updated to ${newStatus}.
    `;
    await postComment(testRequest.repository, testRequest.prNumber, statusComment);
  }
  return { success: true, testRequest };
}
/**
 * Submit a test report and update PR status
 */
async function submitTestReport(requestId, reportContent, testResult) {
  console.log(`📝 Submitting test report for request ${requestId} with result ${testResult}`);
  // Find the test request
  const testRequests = loadTestRequests();
  const testRequest = testRequests.find(r => r.id === requestId);
  if (!testRequest) {
    throw new Error(`Test request ${requestId} not found`);
  }
  if (!testRequest.repository || !testRequest.prNumber) {
    throw new Error('Test request does not have valid repository or PR information');
  }
  // Save the report to the test request
  testRequest.report = {
    reportContent,
    testResult,
    submittedAt: new Date().toISOString()
  };
  // Update status based on test result
  testRequest.status = testResult;
  // Save the updated test request
  saveTestRequests(testRequests);
  // Format the report as a comment
  const reportComment = `
## 📋 Manual Test Report
${reportContent}
### Status
**Test result:** ${testResult === 'complete-pass' ? '✅ PASS' : '❌ FAIL'}
---
☕ If this helped you ship better, you can support the project: [BuyMeACoffee.com/firstqa](https://buymeacoffee.com/firstqa)
  `;
  // Post the report as a comment
  const commentResult = await postComment(testRequest.repository, testRequest.prNumber, reportComment);

  return { success: true, testRequest, commentResult };
}
/**
 * Post a welcome comment on a newly created PR
 */
async function postWelcomeComment(repository, prNumber) {
  const welcomeComment = `
**Welcome to FirstQA!**
_Early-access mode: Your first test requests (up to 4 hours) are **FREE**!_
If you find value, you can support the project: [BuyMeACoffee.com/firstqa](https://buymeacoffee.com/firstqa)
Request a QA review by commenting: /qa followed by details like: Title, Acceptance Criteria, Test Environment, Design, and so on.
**Example test request:**
\`\`\`
/qa
Please run a full manual QA on this PR. Here's what I'd like you to focus on:
- Main goal: Verify the new user onboarding flow (sign up, email verification, and first login).
- Browsers: Chrome (latest), Firefox (latest), Safari (latest).
- Devices: Desktop and mobile (iPhone 13, Pixel 6).
- Test data: Use test email addresses (e.g., test+onboarding1@myapp.com).
- What to look for:
  - Any blockers or bugs in the onboarding steps
  - Usability issues or confusing UI
  - Broken links, typos, or missing error messages
  - Accessibility issues (keyboard navigation, screen reader basics)
  - Edge cases (weak passwords, invalid emails, slow network)
- Environment: https://staging.myapp.com
- Test user: testuser / password: Test1234!
\`\`\`
For more information and tips, check out our [Documentation Guide](/docs).
That's it! We'll handle the rest. 🚀
`;
  return await postComment(repository, prNumber, welcomeComment);
}

/**
 * Parse /qa command flags from comment body
 * Supports: /qa -testrun -env=https://example.com/ -index -reindex -analyze_codebase
 * @returns {{ testRun: boolean, envUrl: string|null, indexCodebase: boolean }}
 */
function parseQaFlags(commentBody) {
  const body = String(commentBody || '').trim();
  const hasFlag = (flag) => new RegExp(`(^|\\s)${flag}(\\s|$)`, 'i').test(body);
  const testRun = hasFlag('-testrun');
  const envMatch = body.match(/-env=(\S+)/i);
  const envUrl = envMatch ? envMatch[1].trim() : null;
  const indexCodebase =
    hasFlag('-index') ||
    hasFlag('-reindex') ||
    hasFlag('-analyze_codebase') ||
    hasFlag('-setup');
  return { testRun, envUrl, indexCodebase };
}

/**
 * Parse test recipe from AI markdown response (Test Recipe table)
 * @param {string|object} aiData - AI response (markdown or object with testRecipe)
 * @returns {Array<{scenario, steps, expected, priority}>}
 */
function parseTestRecipeFromAiResponse(aiData) {
  if (!aiData) return [];
  if (typeof aiData === 'object' && Array.isArray(aiData.testRecipe)) return aiData.testRecipe;
  if (typeof aiData === 'object') {
    const combined = [...(aiData.featureTestRecipe || []), ...(aiData.technicalTestRecipe || [])];
    if (combined.length > 0) return combined.map(t => ({
      scenario: t.scenario || t.description,
      steps: t.steps || t.description,
      expected: t.expected || t.description,
      priority: t.priority || 'Medium',
      automation: t.automation || null
    }));
  }
  if (typeof aiData !== 'string') return [];
  // Parse markdown table: | Scenario | Steps | Expected Result | Priority | Automation |
  const tableMatch = aiData.match(/\|\s*Scenario\s*\|\s*Steps\s*\|\s*Expected Result\s*\|\s*Priority\s*(?:\|\s*Automation\s*)?\|[\s\S]*?(?=\n## |\n---|\n\*\*|$)/i);
  if (!tableMatch) return [];
  const tableBody = tableMatch[0];
  const rows = tableBody.split('\n').filter(line => {
    const t = line.trim();
    if (!t.startsWith('|') || line.includes('Scenario')) return false;
    const firstCell = t.split('|').map(c => c.trim())[1] || '';
    return !/^[\s\-:]+$/.test(firstCell);
  });
  const recipe = [];
  for (const row of rows) {
    const cells = row.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length >= 4 && cells[0] && cells[0].length > 0) {
      recipe.push({
        scenario: cells[0] || 'Test scenario',
        steps: cells[1] || '',
        expected: cells[2] || '',
        priority: cells[3] || 'Medium',
        automation: cells[4] || null
      });
    }
  }
  return recipe;
}

/**
 * Handle test request - core functionality
 */
async function handleTestRequest(repository, issue, comment, sender, userId = null, installationId = null) {
  const analysisStartMs = Date.now();
  console.log(`Processing test request from ${sender.login} on PR #${issue.number} (${repository.full_name})`);
  console.log(`Repository: ${repository.full_name}`);
  console.log(`Comment: ${comment.body}`);
  console.log(`User ID: ${userId || 'unknown'}`);
  
  // Check usage limits if user_id is available
  if (userId && isSupabaseConfigured()) {
    const limitCheck = await checkUsageLimits(userId);
    if (!limitCheck.allowed) {
      console.warn(`⚠️ Usage limit exceeded for user ${userId}`);
      const baseUrl = process.env.BASE_URL || 'https://www.firstqa.dev';
      const limitMessage = `## ⏰ Free trial ended

FirstQA paused this review — your 5-day free trial has expired.

**Two options:**

- **Upgrade to a plan** → full QA coverage, unlimited reviews: [firstqa.dev/pricing](${baseUrl}/pricing)
- **Apply as a Launch Partner** → $149/mo locked for life (21 spots): [firstqa.dev/discovery-interview](${baseUrl}/discovery-interview)

Questions? Reply here or email hello@firstqa.dev`;
      await postComment(repository.full_name, issue.number, limitMessage);
      return { 
        success: false, 
        message: 'Trial expired',
        limitReached: true 
      };
    }
    console.log(`✅ Trial active: ${limitCheck.daysLeft} day(s) remaining`);
  }
  
  // Check for -index / -reindex / -analyze_codebase / -setup flag - trigger codebase indexing
  const qaFlags = parseQaFlags(comment.body);
  if (qaFlags.indexCodebase) {
    if (process.env.ENABLE_KNOWLEDGE_SYNC !== 'true') {
      await postComment(repository.full_name, issue.number, '❌ **Knowledge sync is disabled.** Set `ENABLE_KNOWLEDGE_SYNC=true` to use codebase indexing.');
      return { success: true, message: 'Knowledge sync disabled' };
    }
    const hasKnowledge = await (async () => {
      if (!isSupabaseConfigured()) return false;
      const { count } = await supabaseAdmin.from('product_knowledge').select('*', { count: 'exact', head: true }).eq('repo_id', repository.full_name).limit(1);
      return (count || 0) > 0;
    })();
    if (hasKnowledge) {
      await postComment(repository.full_name, issue.number, '🔄 **Re-indexing codebase...** This will take 5-10 minutes. I\'ll update you when complete.');
    } else {
      await postComment(repository.full_name, issue.number, '🚀 **FirstQA is learning your codebase...** This will take 5-10 minutes. You\'ll be notified when complete.');
    }
    const { analyzeRepository } = require('../services/knowledgeBase/codebaseAnalyzer');
    const postCommentFn = (body) => postComment(repository.full_name, issue.number, body);
    analyzeRepository(repository.full_name, installationId, 'main', { postComment: postCommentFn }).catch(err => {
      console.error('Codebase analysis error:', err);
    });
    return { success: true, message: 'Codebase indexing started' };
  }
  
  // Create a unique ID for this test request
  const requestId = `${repository.full_name.replace('/', '-')}-${issue.number}-${Date.now()}`;

  // First-time auto-index: if repo has no product knowledge, wait for indexing before analysis
  if (process.env.ENABLE_KNOWLEDGE_SYNC === 'true' && installationId) {
    const { repoNeedsFirstTimeIndex } = require('../services/knowledgeBase/firstTimeIndexTrigger');
    const { analyzeRepository } = require('../services/knowledgeBase/codebaseAnalyzer');
    try {
      const needsIndex = await repoNeedsFirstTimeIndex(repository.full_name);
      if (needsIndex) {
        console.log(`📚 First-time indexing for ${repository.full_name} — waiting before analysis`);
        await postComment(repository.full_name, issue.number, '📚 **Building product knowledge from your codebase.** Analysis will follow shortly.');
        await analyzeRepository(repository.full_name, installationId, 'main');
        console.log(`✅ First-time indexing complete for ${repository.full_name}, proceeding with analysis`);
      }
    } catch (indexErr) {
      console.warn(`⚠️ First-time indexing failed for ${repository.full_name}, continuing with analysis:`, indexErr.message);
    }
  }

  // Get the last analyzed commit SHA for this PR
  const lastAnalyzedSHA = getLastAnalyzedCommitSHA(repository.full_name, issue.number);
  console.log(`🔍 Last analyzed commit SHA: ${lastAnalyzedSHA || 'none (first analysis)'}`);
  
  // Get PR head SHA to track the latest commit
  let currentHeadSHA = null;
  try {
    const [owner, repoName] = repository.full_name.split('/');
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (repoOctokit) {
      const prResponse = await repoOctokit.pulls.get({
        owner,
        repo: repoName,
        pull_number: issue.number
      });
      currentHeadSHA = prResponse.data.head.sha;
      console.log(`📌 Current PR head SHA: ${currentHeadSHA}`);
    }
  } catch (error) {
    console.error(`⚠️ Could not fetch PR head SHA: ${error.message}`);
  }
  
  // Fetch new commits since last analysis (if any)
  let newCommits = [];
  if (lastAnalyzedSHA) {
    console.log(`🔄 Checking for new commits since last analysis (last analyzed: ${lastAnalyzedSHA.substring(0, 7)})...`);
    newCommits = await fetchNewCommitsWithDetails(repository.full_name, issue.number, lastAnalyzedSHA);
    if (newCommits.length > 0) {
      console.log(`✅ Found ${newCommits.length} new commit(s) to analyze:`);
      newCommits.forEach(commit => {
        console.log(`   - ${commit.sha.substring(0, 7)}: ${commit.message.split('\n')[0]}`);
      });
    } else {
      console.log(`ℹ️ No new commits since last analysis`);
      // Double-check: if current HEAD is different from last analyzed, we should detect it
      if (currentHeadSHA && currentHeadSHA !== lastAnalyzedSHA) {
        console.log(`⚠️ WARNING: HEAD SHA (${currentHeadSHA.substring(0, 7)}) differs from last analyzed (${lastAnalyzedSHA.substring(0, 7)}) but no commits detected - might be a rebase or force push`);
      }
    }
  } else {
    console.log(`ℹ️ First analysis for this PR - analyzing all changes`);
    // For first analysis, still fetch all commits for context
    const allCommitsList = await fetchCommitsSince(repository.full_name, issue.number, null);
    if (allCommitsList.length > 0) {
      console.log(`📋 PR has ${allCommitsList.length} total commit(s) - fetching details for context`);
      newCommits = await Promise.all(
        allCommitsList.map(commit => fetchCommitDetails(repository.full_name, commit.sha))
      );
      console.log(`✅ Fetched details for all ${newCommits.length} commit(s) for initial analysis`);
    }
  }
  
  // Get PR description and diff
  console.log(`📄 Fetching PR description for ${repository.full_name}#${issue.number}`);
  const prDescription = await fetchPRDescription(repository.full_name, issue.number);
  console.log(`📄 PR description: ${prDescription ? 'Success' : 'Failed'}`);
  console.log(`📝 Fetching PR diff for ${repository.full_name}#${issue.number}`);
  const prDiff = await fetchPRDiff(repository.full_name, issue.number);
  console.log(`📝 PR diff: ${prDiff ? `Success (${prDiff.length} chars)` : 'Failed'}`);
  
  // Build lean commit context — the full PR diff already contains all code;
  // this section only adds commit-level metadata the AI can't infer from the diff.
  let newCommitsContext = '';

  if (newCommits.length > 0) {
    const isUpdate = lastAnalyzedSHA !== null;
    const chronologicalCommits = [...newCommits].reverse(); // oldest first

    newCommitsContext = `\n\n## 🔄 ${isUpdate ? 'RE-ANALYSIS — NEW COMMITS SINCE LAST REVIEW' : 'COMMIT HISTORY'}:\n\n`;

    if (isUpdate) {
      newCommitsContext += `**${newCommits.length} new commit(s) added since last review. Regenerate a COMPLETE analysis of the entire PR. Keep the core test scenarios stable (same feature, same QA coverage structure). Add or modify scenarios only where new commits introduce fixes, behavioral changes, or new risks. Do not produce a completely different test recipe — build on the same product-level coverage.**\n\n`;
    }

    // Concise commit list — message + change type tags
    chronologicalCommits.forEach((commit, i) => {
      const msg = commit.message.split('\n')[0];
      const lower = commit.message.toLowerCase();
      const tags = [];
      if (/fix|bug|issue|resolve/i.test(lower)) tags.push('FIX');
      if (/add|implement|create|introduce/i.test(lower)) tags.push('NEW');
      if (/remove|delete|drop/i.test(lower)) tags.push('REMOVAL');
      if (/update|modify|change|refactor|improve|enhance/i.test(lower)) tags.push('CHANGE');
      const tagStr = tags.length > 0 ? ` [${tags.join(', ')}]` : '';
      newCommitsContext += `${i + 1}. \`${commit.sha.substring(0, 7)}\` ${msg}${tagStr}\n`;
    });

    newCommitsContext += `\nThe FULL PR diff below represents the final state after all commits. Use it as the single source of truth.\n`;
  }
  
  // ALWAYS use the full PR diff - we want complete analysis
  const diffToAnalyze = prDiff;
  
  // Debug what we're sending to AI
  console.log('🔍 AI Input Debug:');
  console.log(`   Repo: ${repository.full_name}`);
  console.log(`   PR #: ${issue.number}`);
  console.log(`   Title: ${issue.title}`);
  console.log(`   Body length: ${prDescription?.length || 0}`);
  console.log(`   Full PR diff length: ${prDiff?.length || 0}`);
  console.log(`   New commits: ${newCommits.length}`);
  if (newCommits.length > 0) {
    console.log(`   ⚠️ NEW COMMITS DETECTED - Will regenerate COMPLETE analysis with full PR diff`);
    console.log(`   New commits context length: ${newCommitsContext.length}`);
    console.log(`   New commits: ${newCommits.map(c => c.sha.substring(0, 7)).join(', ')}`);
  } else {
    console.log(`   ✅ No new commits - Standard full PR analysis`);
  }
  
  // Fetch full file contents for changed code files (for accurate test cases & automation)
  let fileContents = {};
  let selectorHints = [];
  try {
    const fetched = await fetchChangedFileContents(repository.full_name, issue.number);
    fileContents = fetched.fileContents || {};
    selectorHints = fetched.selectorHints || [];
  } catch (err) {
    console.warn('Could not fetch file contents for analysis:', err.message);
  }

  // Generate AI insights for the PR via API endpoint
  console.log('🤖 FirstQA Ovi AI analyzing PR (regenerating complete analysis)...');
  let aiInsights;
  try {
    // Enrich description with new commits context - but still analyze FULL PR
    const enrichedDescription = newCommits.length > 0 
      ? `${prDescription}${newCommitsContext}`
      : prDescription;
    
    // Always pass full PR diff - we want complete analysis
    aiInsights = await callTestRecipeEndpoint({
      repo: repository.full_name,
      pr_number: issue.number,
      title: issue.title + (newCommits.length > 0 ? ` [Updated: ${newCommits.length} new commit(s)]` : ''),
      body: enrichedDescription,
      diff: diffToAnalyze, // FULL PR diff - complete analysis
      newCommits: newCommits.length > 0 ? newCommits : undefined,
      fileContents,
      selectorHints
    });
    if (aiInsights && aiInsights.success) {
      console.log('✅ FirstQA Ovi AI analysis completed successfully');
      
      // NOTE: Release Pulse analysis now handled directly in AI prompt (enhanced-deep-analysis.ejs)
      // The AI generates accurate Release Decision, Affected Areas, and Risk Level based on actual findings
      // No need for post-processing since prompt instructions are comprehensive
    } else {
      console.error('❌ FirstQA Ovi AI analysis failed:', aiInsights?.error, aiInsights?.details);
    }
  } catch (error) {
    console.error('❌ FirstQA Ovi AI analysis threw exception:', error.message);
    console.error('Stack trace:', error.stack);
    // Create error result
    aiInsights = {
      success: false,
      error: 'FirstQA Ovi AI analysis failed',
      details: error.message
    };
  }
  // If AI insights failed, return an honest message instead of fabricated analysis
  if (!aiInsights || !aiInsights.success) {
    console.log('🔄 AI analysis failed, using honest fallback message');
    aiInsights = {
      success: true,
      data: `# 🎯 QA Analysis - by Ovi (the AI QA)

## ⚠️ Analysis could not be generated

The AI analysis failed: ${aiInsights?.error || 'unknown error'}

**Please try again** by commenting \`/qa\` on this PR.`
    };
  }
  // Generate test request object
  const testRequest = {
    id: requestId,
    repository: repository.full_name,
    prNumber: issue.number,
    requestedBy: sender.login,
    requestedAt: new Date().toISOString(),
    comment: comment.body,
    prDescription: prDescription,
    aiInsights: aiInsights, // Include AI insights in test request
    status: 'pending',
    prUrl: issue.html_url || `https://github.com/${repository.full_name}/pull/${issue.number}`,
    labels: [],
    // Track commit analysis
    lastAnalyzedCommitSHA: currentHeadSHA || null,
    newCommitsAnalyzed: newCommits.length,
    newCommitsDetails: newCommits.length > 0 ? newCommits.map(c => ({
      sha: c.sha,
      message: c.message.split('\n')[0],
      author: c.author
    })) : []
  };
  // Parse request details from comment
  testRequest.parsedDetails = parseTestRequestComment(comment.body);
  console.log(`✅ Created test request object:`, testRequest);
  // Store in database
  const testRequests = loadTestRequests();
  console.log(`Loaded ${testRequests.length} existing test requests`);
  testRequests.push(testRequest);
  const saveResult = saveTestRequests(testRequests);
  console.log(`✅ Test request saved to database: ${saveResult ? 'success' : 'failed'}`);
  // Post acknowledgment comment with AI insights if available
  let acknowledgmentComment = ``;

  // Single title at top: when we have commits we add one title and strip duplicate from AI output
  const hasCommitsBlock = newCommits.length > 0;
  if (hasCommitsBlock) {
    acknowledgmentComment += `# 🎯 QA Analysis - by Ovi (the AI QA)\n\n`;
    const isUpdate = lastAnalyzedSHA !== null;
    if (isUpdate) {
      acknowledgmentComment += `✅ **${newCommits.length} new commit(s)** added since last review:\n\n`;
    } else {
      acknowledgmentComment += `✅ Analyzing **${newCommits.length} commit(s)** in this PR:\n\n`;
    }
    newCommits.forEach((commit, index) => {
      const commitMessage = commit.message.split('\n')[0];
      acknowledgmentComment += `${index + 1}. \`${commit.sha.substring(0, 7)}\` - ${commitMessage}\n`;
    });
    acknowledgmentComment += `\n---\n\n`;
  }

  if (aiInsights && aiInsights.success) {
    console.log('🔍 AI Insights Debug:');
    console.log('AI Insights success:', aiInsights.success);
    console.log('AI Insights data type:', typeof aiInsights.data);
    console.log('AI Insights data length:', aiInsights.data ? aiInsights.data.length : 'undefined');
    console.log('AI Insights data preview:', aiInsights.data ? JSON.stringify(aiInsights.data).substring(0, 200) + '...' : 'undefined');
    let aiPart = formatHybridAnalysisForComment(aiInsights);
    if (hasCommitsBlock) {
      aiPart = aiPart.replace(/^#\s*🎯\s*QA Analysis[^\n]*\n+\s*/i, '');
    }
    acknowledgmentComment += aiPart;
  } else if (aiInsights && !aiInsights.success) {
    acknowledgmentComment += `
*Note: Ovi QA Agent insights could not be generated for this PR (${aiInsights.error}), but manual testing will proceed as normal.*
    `;
  }
  // Generate Playwright spec file (non-blocking, appended to comment if ready in time)
  let specResult = null;
  if (aiInsights && aiInsights.success) {
    try {
      const { generatePlaywrightSpec } = require('../ai/playwrightSpecGenerator');
      const scenarios = parseTestRecipeFromAiResponse(aiInsights.data);
      if (scenarios.length > 0) {
        specResult = await generatePlaywrightSpec({
          scenarios,
          fileContents,
          selectorHints,
          prTitle: issue.title,
          repoName: repository.full_name,
          prNumber: issue.number
        });
      }
    } catch (specErr) {
      console.warn('⚠️ Playwright spec generation skipped:', specErr.message);
    }
  }

  const fullAnalysisId = generateAnalysisId();
  if (aiInsights && aiInsights.success) {
    if (specResult && specResult.success) {
      acknowledgmentComment += `\n\n---\n\n📋 **Playwright Tests** — [Download .spec.ts](${specResult.specUrl}) (${specResult.scenarioCount} scenarios)\n`;
    }
    acknowledgmentComment += feedbackFooter(fullAnalysisId);
  }
  const elapsedSec = ((Date.now() - analysisStartMs) / 1000).toFixed(1);
  console.log(`⏱️ PR analysis completed in ${elapsedSec}s, posting comment`);
  const commentResult = await postComment(repository.full_name, issue.number, acknowledgmentComment);
  console.log(`✅ Acknowledgment comment ${commentResult.simulated ? 'would be' : 'was'} posted`);
  
  // Save analysis to database if user_id is available
  if (userId && isSupabaseConfigured() && aiInsights && aiInsights.success) {
    try {
      await saveAnalysisToDatabase({
        analysisId: fullAnalysisId,
        userId,
        provider: 'github',
        repository: repository.full_name,
        prNumber: issue.number,
        prTitle: issue.title,
        prUrl: `https://github.com/${repository.full_name}/pull/${issue.number}`,
        analysisType: 'full',
        analysisOutput: {
          raw: aiInsights.data,
          formatted: acknowledgmentComment,
          timestamp: new Date().toISOString()
        }
      });
      console.log(`✅ Analysis saved to database for user ${userId}`);
    } catch (error) {
      console.error('❌ Error saving analysis to database:', error.message);
    }
  } else if (aiInsights?.success && !userId) {
    console.warn(`⚠️ Analysis for ${repository.full_name}#${issue.number} NOT saved to DB — userId is null (installation lookup may have failed)`);
  }
  
  // Post GitHub Check status (non-blocking)
  if (installationId && currentHeadSHA && aiInsights?.success) {
    try {
      const { extractQAPulseDecision, createQAAnalysisCheck } = require('../services/githubChecksService');
      const decision = extractQAPulseDecision(aiInsights.data);
      if (decision) {
        const [chkOwner, chkRepo] = repository.full_name.split('/');
        const bugCount = typeof aiInsights.data?.bugsAndRisks?.length === 'number'
          ? aiInsights.data.bugsAndRisks.length
          : null;
        await createQAAnalysisCheck({
          installationId,
          owner: chkOwner,
          repo: chkRepo,
          sha: currentHeadSHA,
          decision,
          bugCount,
          analysisUrl: `https://github.com/${repository.full_name}/pull/${issue.number}`
        });
      }
    } catch (checkErr) {
      console.warn('⚠️ QA Check creation failed (non-fatal):', checkErr.message);
    }
  }

  // Add "Reviewed by Ovi" label after AI analysis is complete
  const labelResult = await addOviReviewedLabel(repository.full_name, issue.number);
  console.log(`✅ "Reviewed by Ovi" label ${labelResult.simulated ? 'would be' : 'was'} added`);

  // Note: test execution is now handled by the separate /qa testrun command (handleTestRunCommand).
  
  // Send email notification - DISABLED to prevent spam
  // const emailResult = await sendEmailNotification(testRequest);
  // if (emailResult.success) {
  //   console.log(`✅ Email notification sent about PR #${issue.number}`);
  // } else {
  //   console.log(`❌ Email notification failed: ${emailResult.error || 'Unknown error'}`);
  // }
  return {
    success: true,
    requestId,
    simulated: simulatedMode
  };
}
/**
 * Handle short request - generate a short analysis
 */
async function handleShortRequest(repository, issue, comment, sender, userId = null) {
  console.log(`Processing short request from ${sender.login} on PR #${issue.number}`);
  console.log(`Repository: ${repository.full_name}`);
  console.log(`Comment: ${comment.body}`);
  console.log(`User ID: ${userId || 'unknown'}`);
  
  // Check usage limits if user_id is available
  if (userId && isSupabaseConfigured()) {
    const limitCheck = await checkUsageLimits(userId);
    if (!limitCheck.allowed) {
      console.warn(`⚠️ Usage limit exceeded for user ${userId}`);
      const baseUrl = process.env.BASE_URL || 'https://www.firstqa.dev';
      const limitMessage = `## ⏰ Free trial ended

FirstQA paused this review — your 5-day free trial has expired.

**Two options:**

- **Upgrade to a plan** → full QA coverage, unlimited reviews: [firstqa.dev/pricing](${baseUrl}/pricing)
- **Apply as a Launch Partner** → $149/mo locked for life (21 spots): [firstqa.dev/discovery-interview](${baseUrl}/discovery-interview)

Questions? Reply here or email hello@firstqa.dev`;
      await postComment(repository.full_name, issue.number, limitMessage);
      return { 
        success: false, 
        message: 'Trial expired',
        limitReached: true 
      };
    }
    console.log(`✅ Trial active: ${limitCheck.daysLeft} day(s) remaining`);
  }
  
  // Create a unique ID for this test request
  const requestId = `${repository.full_name.replace('/', '-')}-${issue.number}-${Date.now()}`;
  // Get PR description and diff
  console.log(`📄 Fetching PR description for ${repository.full_name}#${issue.number}`);
  const prDescription = await fetchPRDescription(repository.full_name, issue.number);
  console.log(`📄 PR description: ${prDescription ? 'Success' : 'Failed'}`);
  console.log(`📝 Fetching PR diff for ${repository.full_name}#${issue.number}`);
  const prDiff = await fetchPRDiff(repository.full_name, issue.number);
  console.log(`📝 PR diff: ${prDiff ? `Success (${prDiff.length} chars)` : 'Failed'}`);
  // Debug what we're sending to AI
  console.log('🔍 AI Input Debug:');
  console.log(`   Repo: ${repository.full_name}`);
  console.log(`   PR #: ${issue.number}`);
  console.log(`   Title: ${issue.title}`);
  console.log(`   Body length: ${prDescription?.length || 0}`);
  console.log(`   Diff length: ${prDiff?.length || 0}`);
  // Generate AI insights for the PR via API endpoint - SHORT ANALYSIS VERSION
  console.log('🤖 FirstQA Ovi AI analyzing PR...');
  let aiInsights;
  try {
    aiInsights = await callShortAnalysisEndpoint({
      repo: repository.full_name,
      pr_number: issue.number,
      title: issue.title,
      body: prDescription,
      diff: prDiff
    });
    if (aiInsights && aiInsights.success) {
      console.log('✅ FirstQA Ovi AI short analysis completed successfully');
    } else {
      console.error('❌ FirstQA Ovi AI short analysis failed:', aiInsights?.error, aiInsights?.details);
    }
  } catch (error) {
    console.error('❌ FirstQA Ovi AI short analysis threw exception:', error.message);
    console.error('Stack trace:', error.stack);
    // Create error result
    aiInsights = {
      success: false,
      error: 'FirstQA Ovi AI short analysis failed',
      details: error.message
    };
  }
  // If AI insights failed, create a basic fallback analysis
  if (!aiInsights || !aiInsights.success) {
    console.log('🔄 Creating fallback analysis due to AI failure');
    aiInsights = {
      success: true,
      data: {
        summary: {
          riskLevel: "MEDIUM",
          shipScore: 5,
          reasoning: "AI analysis failed - manual review required to assess production readiness"
        },
        questions: [
          "What is the main purpose of these changes?",
          "Are there any breaking changes that could affect existing functionality?",
          "Have you tested the core functionality manually?",
          "Are there any dependencies or integrations that might be affected?"
        ],
        featureTestRecipe: [
          {
            scenario: "Test core feature functionality",
            priority: "Critical", 
            automation: "Manual",
            description: "Verify main user workflows work as expected"
          }
        ],
        technicalTestRecipe: [
          {
            scenario: "Test main functionality changes",
            priority: "Critical", 
            automation: "Manual",
            description: "Verify core changes work as expected"
          },
          {
            scenario: "Test error handling and edge cases",
            priority: "Medium",
            automation: "Manual",
            description: "Validate error scenarios and boundary conditions"
          }
        ],
        bugs: [],
        criticalRisks: [
          "AI analysis could not be completed - manual review needed",
          "Unable to perform detailed risk analysis due to AI processing error"
        ]
      }
    };
  }
  // Generate test request object
  const testRequest = {
    id: requestId,
    repository: repository.full_name,
    prNumber: issue.number,
    requestedBy: sender.login,
    requestedAt: new Date().toISOString(),
    comment: comment.body,
    prDescription: prDescription,
    aiInsights: aiInsights, // Include AI insights in test request
    status: 'pending',
    prUrl: issue.html_url || `https://github.com/${repository.full_name}/pull/${issue.number}`,
    labels: []
  };
  // Parse request details from comment
  testRequest.parsedDetails = parseTestRequestComment(comment.body);
  console.log(`✅ Created test request object:`, testRequest);
  // Store in database
  const testRequests = loadTestRequests();
  console.log(`Loaded ${testRequests.length} existing test requests`);
  testRequests.push(testRequest);
  const saveResult = saveTestRequests(testRequests);
  console.log(`✅ Test request saved to database: ${saveResult ? 'success' : 'failed'}`);
  // Post acknowledgment comment with AI insights if available
  let acknowledgmentComment = `
  `;
  // Add AI insights to the comment if they were generated successfully
  if (aiInsights && aiInsights.success) {
    // Use the same hybrid formatting as the automatic PR analysis
    acknowledgmentComment += formatShortAnalysisForComment(aiInsights);
  } else if (aiInsights && !aiInsights.success) {
    acknowledgmentComment += `
*Note: Ovi QA Agent insights could not be generated for this PR (${aiInsights.error}), but manual testing will proceed as normal.*
    `;
  }
  const shortAnalysisId = generateAnalysisId();
  if (aiInsights && aiInsights.success) {
    acknowledgmentComment += feedbackFooter(shortAnalysisId);
  }
  const elapsedSecShort = ((Date.now() - analysisStartMs) / 1000).toFixed(1);
  console.log(`⏱️ Short PR analysis completed in ${elapsedSecShort}s, posting comment`);
  const commentResult = await postComment(repository.full_name, issue.number, acknowledgmentComment);
  console.log(`✅ Acknowledgment comment ${commentResult.simulated ? 'would be' : 'was'} posted`);
  
  // Save analysis to database if user_id is available
  if (userId && isSupabaseConfigured() && aiInsights && aiInsights.success) {
    try {
      await saveAnalysisToDatabase({
        analysisId: shortAnalysisId,
        userId,
        provider: 'github',
        repository: repository.full_name,
        prNumber: issue.number,
        prTitle: issue.title,
        prUrl: `https://github.com/${repository.full_name}/pull/${issue.number}`,
        analysisType: 'short',
        analysisOutput: {
          raw: aiInsights.data,
          formatted: acknowledgmentComment,
          timestamp: new Date().toISOString()
        }
      });
      console.log(`✅ Short analysis saved to database for user ${userId}`);
    } catch (error) {
      console.error('❌ Error saving short analysis to database:', error.message);
    }
  } else if (aiInsights?.success && !userId) {
    console.warn(`⚠️ Short analysis for ${repository.full_name}#${issue.number} NOT saved to DB — userId is null`);
  }
  
  // Add "Reviewed by Ovi" label after AI analysis is complete
  const labelResult = await addOviReviewedLabel(repository.full_name, issue.number);
  console.log(`✅ "Reviewed by Ovi" label ${labelResult.simulated ? 'would be' : 'was'} added`);
  // Send email notification - DISABLED to prevent spam
  // const emailResult = await sendEmailNotification(testRequest);
  // if (emailResult.success) {
  //   console.log(`✅ Email notification sent about PR #${issue.number}`);
  // } else {
  //   console.log(`❌ Email notification failed: ${emailResult.error || 'Unknown error'}`);
  // }
  return {
    success: true,
    requestId,
    simulated: simulatedMode
  };
}
/** Priority order for Test Recipe: Smoke first, then Critical Path, then Regression */
function testRecipePriorityOrder(priority) {
  const p = (priority || '').trim().toLowerCase();
  if (p === 'smoke') return 0;
  if (p === 'critical path') return 1;
  if (p === 'regression') return 2;
  return 3;
}

/**
 * Sort Test Recipe table rows by Priority: Smoke -> Critical Path -> Regression.
 * Leaves table structure unchanged; only reorders data rows.
 * @param {string} markdown - Full comment markdown
 * @returns {string} Markdown with Test Recipe table rows sorted by priority
 */
function sortTestRecipeTableByPriority(markdown) {
  const tableStart = markdown.indexOf('## 🧪 Test Recipe');
  if (tableStart === -1) return markdown;
  const afterHeader = markdown.slice(tableStart);
  const headerMatch = afterHeader.match(/\|\s*Scenario\s*\|\s*Steps\s*\|\s*Expected Result\s*\|\s*Priority\s*\|\s*Automation\s*\|/i);
  if (!headerMatch) return markdown;
  const tableBlockStart = tableStart + afterHeader.indexOf(headerMatch[0]);
  const fromTable = markdown.slice(tableBlockStart);
  const lines = fromTable.split('\n');
  const dataRows = [];
  let i = 0;
  if (lines[0] && lines[0].includes('Scenario') && lines[0].includes('Priority')) i = 1;
  if (lines[i] && /^\|[\s\-:]+\|/.test(lines[i])) i++;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim().startsWith('|')) break;
    if (/^\|[\s\-:]+\|/.test(line)) continue;
    const cells = line.split('|').map(c => c.trim());
    if (cells.length >= 5 && cells[1]) {
      const priority = (cells[4] || cells[3] || '').trim();
      dataRows.push({ line, index: i, order: testRecipePriorityOrder(priority) });
    }
  }
  if (dataRows.length <= 1) return markdown;
  dataRows.sort((a, b) => a.order - b.order);
  const firstIdx = dataRows[0].index;
  const lastIdx = dataRows[dataRows.length - 1].index;
  const sortedLines = lines.slice(0, firstIdx)
    .concat(dataRows.map(r => r.line))
    .concat(lines.slice(lastIdx + 1));
  const sortedBlock = sortedLines.join('\n');
  const before = markdown.slice(0, tableBlockStart);
  return before + sortedBlock;
}

/**
 * Format hybrid analysis for GitHub comment (shared by /qa and automatic PR analysis)
 */
function formatHybridAnalysisForComment(aiInsights) {
  const aiData = aiInsights.data;

  // Check if we have the new AI prompt format (markdown with known headers)
  const hasNewFormat = typeof aiData === 'string' && (
    aiData.includes('📊 Release Pulse') ||
    aiData.includes('🧪 Release Pulse') ||
    aiData.includes('🎯 QA Pulse') ||
    aiData.includes('🎯 QA Analysis') ||
    aiData.includes('Bugs & Risks') ||
    aiData.includes('Test Recipe')
  );

  if (hasNewFormat) {
    console.log('🔍 Detected new AI prompt format, using as-is');
    
    let cleanedData = aiData
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\t/g, '\n')
      .trim();
    cleanedData = sortTestRecipeTableByPriority(cleanedData);
    
    const finalComment = `${cleanedData}

---

*🤖 **With Quality By Ovi** - AI-powered QA analysis by FirstQA*

💡 Need a human tester to help? [Hire a tester](https://www.firstqa.dev/hire) - Professional QA testing for your releases.`;
    
    console.log('Final comment length:', finalComment.length);
    
    return finalComment;
  }

  // Fallback for legacy JSON format (backward compatibility)
  if (typeof aiData === 'object' && aiData.summary) {
    // Get ship status with color indicators
    const getShipStatus = (score) => {
      if (score >= 8) return '✅ SHIP IT';
      if (score >= 6) return '⚠️ SHIP WITH MONITORING';
      return '❌ BLOCK';
    };
    // Get risk level with color emoji
    const getRiskLevel = (level) => {
      const riskLevel = (level || 'MEDIUM').toUpperCase();
      switch(riskLevel) {
        case 'LOW': return '🟢 LOW';
        case 'HIGH': return '🔴 HIGH';
        default: return '🟡 MEDIUM';
      }
    };
    // Question type emojis for variety
    const questionEmojis = ['❓', '🔧', '✅', '🎨', '🛡️'];
    // Combine feature and technical test recipes
    const allTests = [
      ...(aiData.featureTestRecipe || []),
      ...(aiData.technicalTestRecipe || [])
    ];
    const testRecipeTable = allTests.length > 0 ? 
      `| Scenario | Priority | Type | Automation |\n|----------|----------|------|------------|\n${allTests.map(test => 
        `| ${test.scenario || 'Test scenario'} | ${test.priority || 'Medium'} | ${test.automation || 'Manual'} | ✅ |`
      ).join('\n')}` : 
      '| Scenario | Priority | Type | Automation |\n|----------|----------|------|------------|\n| Core functionality testing | High | E2E | ✅ |';
    // Combine bugs and critical risks
    const bugsAndRisks = [
      ...(aiData.bugs || []),
      ...(aiData.criticalRisks || [])
    ];
    return `### 🤖 Ovi AI by FirstQA
---
### 📋 Summary
**Risk Level:** ${getRiskLevel(aiData.summary?.riskLevel)}
**Ship Score:** ${aiData.summary?.shipScore || 5}/10 — ${getShipStatus(aiData.summary?.shipScore || 5)}
---
### 🧠 Review Focus
${aiData.questions ? aiData.questions.slice(0, 5).map((q, i) => `${i + 1}. ${questionEmojis[i] || '❓'} ${q}`).join('\n') : '1. ❓ How does the core functionality handle edge cases?'}
---
### 🐞 Bugs & Risks
${bugsAndRisks.length > 0 ? bugsAndRisks.map(item => `- 🚨 ${item}`).join('\n') : '- ✅ No critical bugs or risks identified'}
---
### 🧪 Test Recipe
${testRecipeTable}
---
*🚀 Professional QA analysis generated by Ovi AI by FirstQA. Designed to support rapid releases with high quality.*`;
  }
  // Final fallback for unexpected format
  return `### 🤖 Ovi AI by FirstQA
---
**Analysis Status:** ⚠️ Processing Issue
The analysis was generated but could not be properly formatted. Please check the logs for more details.
---
*🚀 Professional QA analysis generated by Ovi AI by FirstQA. Designed to support rapid releases with high quality.*`;
}
/**
 * Format short analysis for GitHub comment (only Release Confidence Score, Risks, Test Recipe)
 */
            function formatShortAnalysisForComment(aiInsights) {
              const aiData = aiInsights.data;

              // Check if we have the new short analysis format
              if (typeof aiData === 'string' && (
                aiData.includes('📊 Release Pulse') ||
                aiData.includes('🎯 QA Analysis - by Ovi (the AI QA) - Short Version')
              )) {
                // This is already in the correct short format, just add branding
                return `### 🤖 Ovi AI by FirstQA

---

${aiData}

---

*🤖 **With Quality By Ovi AI** - AI-powered QA analysis by FirstQA*

💡 Need a human tester to help? [Hire a tester](https://www.firstqa.dev/hire) - Professional QA testing for your releases.*`;
              }
  // Check if we have the legacy simplified format (4 questions approach)
  if (typeof aiData === 'string' && (
    aiData.includes('Ship Score') || 
    aiData.includes('Risk Level') || 
    aiData.includes('Confidence Level') ||
    aiData.includes('biggest risk') ||
    aiData.includes('test manually') ||
    aiData.includes('automated tests') ||
    aiData.includes('🎯 Ovi QA Analysis') || 
    aiData.includes('📊 **Ship Assessment**') || 
    aiData.includes('📋 Summary')
  )) {
    // Extract the key sections from the existing format
    let shortOutput = '### 🤖 Ovi AI by FirstQA - Short Analysis\n\n---\n\n';
    // Extract Release Confidence Score (Ship Score)
    const shipScoreMatch = aiData.match(/Ship Score.*?(\d+)\/10/);
    const confidenceMatch = aiData.match(/Confidence.*?(LOW|MEDIUM|HIGH)/i);
    if (shipScoreMatch && confidenceMatch) {
      shortOutput += `## 📊 Release Confidence Score\n`;
      shortOutput += `**Ship Score:** ${shipScoreMatch[1]}/10 • **Confidence:** ${confidenceMatch[1].toUpperCase()}\n\n`;
    }
    // Extract Risks section
    const risksMatch = aiData.match(/Risks.*?Issues.*?(\n.*?)(?=\n##|\n---|$)/s);
    if (risksMatch) {
      shortOutput += `## ⚠️ Risks\n`;
      shortOutput += `${risksMatch[1].trim()}\n\n`;
    }
    // Extract Test Recipe section
    const testRecipeMatch = aiData.match(/Test Plan.*?(\n.*?)(?=\n---|$)/s);
    if (testRecipeMatch) {
      shortOutput += `## 🧪 Test Recipe\n`;
      shortOutput += `${testRecipeMatch[1].trim()}\n\n`;
    }
    // If we couldn't extract properly, fall back to the full format
    if (!shipScoreMatch || !risksMatch || !testRecipeMatch) {
      shortOutput = `### 🤖 Ovi AI by FirstQA - Short Analysis\n\n---\n\n`;
      shortOutput += `*Unable to generate short format. Please use /qa for full analysis.*\n\n`;
      shortOutput += aiData;
    }
    shortOutput += `---\n\n*🚀 Short QA analysis by Ovi AI by FirstQA. Use /qa for full details.*`;
    return shortOutput;
  }
  // Fallback for legacy JSON format (backward compatibility)
  if (typeof aiData === 'object' && aiData.summary) {
    // Get ship status with color indicators
    const getShipStatus = (score) => {
      if (score >= 8) return '✅ SHIP IT';
      if (score >= 6) return '⚠️ SHIP WITH MONITORING';
      return '❌ BLOCK';
    };
    // Get risk level with color emoji
    const getRiskLevel = (level) => {
      const riskLevel = (level || 'MEDIUM').toUpperCase();
      switch(riskLevel) {
        case 'LOW': return '🟢 LOW';
        case 'HIGH': return '🔴 HIGH';
        default: return '🟡 MEDIUM';
      }
    };
    // Combine feature and technical test recipes
    const allTests = [
      ...(aiData.featureTestRecipe || []),
      ...(aiData.technicalTestRecipe || [])
    ];
    const testRecipeTable = allTests.length > 0 ? 
      `| Scenario | Priority | Type | Automation |\n|----------|----------|------|------------|\n${allTests.map(test => 
        `| ${test.scenario || 'Test scenario'} | ${test.priority || 'Medium'} | ${test.automation || 'Manual'} | ✅ |`
      ).join('\n')}` : 
      '| Scenario | Priority | Type | Automation |\n|----------|----------|------|------------|\n| Core functionality testing | High | E2E | ✅ |';
    // Combine bugs and critical risks
    const bugsAndRisks = [
      ...(aiData.bugs || []),
      ...(aiData.criticalRisks || [])
    ];
    return `### 🤖 Ovi AI by FirstQA - Short Analysis
---
## 📊 Release Confidence Score
**Ship Score:** ${aiData.summary?.shipScore || 5}/10 — ${getShipStatus(aiData.summary?.shipScore || 5)}
**Risk Level:** ${getRiskLevel(aiData.summary?.riskLevel)}
---
## ⚠️ Risks
${bugsAndRisks.length > 0 ? bugsAndRisks.map(item => `- 🚨 ${item}`).join('\n') : '- ✅ No critical bugs or risks identified'}
---
## 🧪 Test Recipe
${testRecipeTable}
---
*🚀 Short QA analysis by Ovi AI by FirstQA. Use /qa-review for full details.*`;
  }
  // Final fallback for unexpected format
  return `### 🤖 Ovi AI by FirstQA - Short Analysis
---
*Unable to generate short format. Please use /qa for full analysis.*
---
${aiData}`;
}
/**
 * Format and post detailed analysis with hybrid structure
 * @param {string} [options.banner] - Optional banner to prepend (e.g. for post-merge staging analysis)
 */
async function formatAndPostDetailedAnalysis(repository, prNumber, aiInsights, options = {}, analysisId = null) {
  // Handle fallback if AI insights failed
  if (!aiInsights || !aiInsights.success) {
    console.log('🔄 Creating fallback analysis due to AI failure');
    aiInsights = {
      success: true,
      data: {
        summary: {
          riskLevel: "MEDIUM",
          shipScore: 5,
          reasoning: "AI analysis failed - manual review required to assess production readiness"
        },
        questions: [
          "What is the main purpose of these changes?",
          "Are there any breaking changes that could affect existing functionality?",
          "Have you tested the core functionality manually?",
          "Are there any dependencies or integrations that might be affected?"
        ],
        featureTestRecipe: [
          {
            scenario: "Test core feature functionality",
            priority: "Critical", 
            automation: "Manual",
            description: "Verify main user workflows work as expected"
          }
        ],
        technicalTestRecipe: [
          {
            scenario: "Test main functionality changes",
            priority: "Critical", 
            automation: "Manual",
            description: "Verify core changes work as expected"
          },
          {
            scenario: "Test error handling and edge cases",
            priority: "Medium",
            automation: "Manual",
            description: "Validate error scenarios and boundary conditions"
          }
        ],
        bugs: [],
        criticalRisks: [
          "AI analysis could not be completed - manual review needed",
          "Unable to perform detailed risk analysis due to AI processing error"
        ]
      }
    };
  }
  // Use the shared hybrid formatting function
  let detailedComment = formatHybridAnalysisForComment(aiInsights);
  if (options.banner) {
    detailedComment = `${options.banner}\n\n${detailedComment}`;
  }
  if (analysisId && aiInsights?.success) {
    detailedComment += feedbackFooter(analysisId);
  }
  return await postComment(repository, prNumber, detailedComment);
}

/**
 * Handle PR opened event - generate comprehensive analysis
 */
async function handlePROpened(repository, pr, installationId) {
  console.log(`🔍 Handling PR opened event for ${repository.full_name}#${pr.number}`);
  // Get PR description and diff for analysis
  const prDescription = await fetchPRDescription(repository.full_name, pr.number);
  const prDiff = await fetchPRDiff(repository.full_name, pr.number);
  console.log(`🔍 Generating COMPREHENSIVE ANALYSIS for PR #${pr.number}`);
  // Generate comprehensive analysis using the detailed endpoint
  let aiInsights;
  try {
    aiInsights = await callTestRecipeEndpoint({
      repo: repository.full_name,
      pr_number: pr.number,
      title: pr.title,
      body: prDescription,
      diff: prDiff
    });
  if (aiInsights && aiInsights.success) {
    console.log('✅ Comprehensive analysis generated successfully');
    
    // NOTE: Release Pulse analysis now handled directly in AI prompt (enhanced-deep-analysis.ejs)
    // The AI generates accurate Release Decision, Affected Areas, and Risk Level based on actual findings
  } else {
    console.error('❌ Comprehensive analysis generation failed:', aiInsights?.error);
  }
} catch (error) {
  console.error('❌ Comprehensive analysis threw exception:', error.message);
  aiInsights = {
    success: false,
    error: 'Comprehensive analysis generation failed',
    details: error.message
  };
}
  
  // Post the analysis first
  const prOpenedAnalysisId = generateAnalysisId();
  const analysisResult = await formatAndPostDetailedAnalysis(repository.full_name, pr.number, aiInsights, {}, prOpenedAnalysisId);
  
  // Check if automated testing should run
  const { shouldRunAutomatedTests, executeAutomatedTests } = require('../services/automatedTestOrchestrator');
  
  if (shouldRunAutomatedTests(pr, aiInsights)) {
    console.log('🤖 Automated testing is enabled for this PR');
    
    // Extract test recipe from AI insights
    const testRecipe = aiInsights?.data?.testRecipe || [];
    
    if (testRecipe.length > 0) {
      // Parse repository owner and name
      const [owner, repo] = repository.full_name.split('/');
      
      // Execute automated tests asynchronously (don't block)
      executeAutomatedTests({
        owner,
        repo,
        prNumber: pr.number,
        sha: pr.head.sha,
        testRecipe,
        baseUrl: process.env.TEST_AUTOMATION_BASE_URL,
        installationId
      }).catch(error => {
        console.error('❌ Automated test execution failed:', error.message);
      });
    } else {
      console.log('⏭️  No test recipe available for automated testing');
    }
  }
  
  return analysisResult;
}

/** Comma-separated staging branch names (e.g. staging,stage,develop) */
const STAGING_BRANCHES = (process.env.STAGING_BRANCHES || 'staging,stage,develop')
  .split(',')
  .map(b => b.trim().toLowerCase())
  .filter(Boolean);

/**
 * Handle PR merged into staging - auto-generate analysis for staging testing
 * Triggered when a PR is closed (merged) and its base branch is a staging branch
 */
async function handlePRMergedToStaging(repository, pr, userId, installationId) {
  const baseRef = (pr.base?.ref || '').toLowerCase();
  console.log(`🚀 Post-merge staging analysis: PR #${pr.number} merged into ${baseRef}`);

  // Check usage limits
  if (userId && isSupabaseConfigured()) {
    const limitCheck = await checkUsageLimits(userId);
    if (!limitCheck.allowed) {
      console.warn(`⚠️ Skipping post-merge analysis: usage limit exceeded for user ${userId}`);
      return { success: false, message: 'Usage limit exceeded', skipped: true };
    }
  }

  // First-time auto-index (same as /qa flow)
  const { triggerGitHubFirstTimeIndex } = require('../services/knowledgeBase/firstTimeIndexTrigger');
  triggerGitHubFirstTimeIndex(repository.full_name, installationId);

  const prDescription = await fetchPRDescription(repository.full_name, pr.number);
  const prDiff = await fetchPRDiff(repository.full_name, pr.number);

  let fileContents = {};
  let selectorHints = [];
  try {
    const fetched = await fetchChangedFileContents(repository.full_name, pr.number);
    fileContents = fetched.fileContents || {};
    selectorHints = fetched.selectorHints || [];
  } catch (err) {
    console.warn('Could not fetch file contents for post-merge analysis:', err.message);
  }

  let aiInsights;
  try {
    aiInsights = await callTestRecipeEndpoint({
      repo: repository.full_name,
      pr_number: pr.number,
      title: pr.title,
      body: prDescription,
      diff: prDiff,
      fileContents,
      selectorHints
    });

    // NOTE: Release Pulse analysis now handled directly in AI prompt (enhanced-deep-analysis.ejs)
  } catch (error) {
    console.error('Post-merge analysis failed:', error.message);
    aiInsights = { success: false, error: error.message };
  }

  const postMergeAnalysisId = generateAnalysisId();
  const banner = `## 🚀 Post-Merge Staging Analysis\n\n*Automatically generated when this PR was merged into \`${baseRef}\`. Use this to prepare staging testing.*\n`;
  await formatAndPostDetailedAnalysis(repository.full_name, pr.number, aiInsights, { banner }, postMergeAnalysisId);

  if (userId && isSupabaseConfigured() && aiInsights?.success) {
    try {
      await saveAnalysisToDatabase({
        analysisId: postMergeAnalysisId,
        userId,
        provider: 'github',
        repository: repository.full_name,
        prNumber: pr.number,
        prTitle: pr.title,
        prUrl: pr.html_url || `https://github.com/${repository.full_name}/pull/${pr.number}`,
        analysisType: 'full',
        analysisOutput: { raw: aiInsights.data, postMergeStaging: true }
      });
      await supabaseAdmin.rpc('increment_user_analyses_count', { user_id_param: userId });
    } catch (e) {
      console.error('Error saving post-merge analysis:', e.message);
    }
  }

  console.log(`✅ Post-merge staging analysis completed for PR #${pr.number}`);
  return { success: true, postMergeStaging: true };
}

/**
 * Handle /qa testrun command.
 * Looks up the most recent /qa analysis for the PR and executes the test recipe
 * against the staging URL (from -env=URL flag or client settings).
 * Requires a prior /qa analysis to exist.
 */
async function handleTestRunCommand(repository, issue, comment, sender, userId, installationId) {
  const repoFullName = repository.full_name;
  const prNumber = issue.number;
  const [owner, repo] = repoFullName.split('/');

  console.log(`🔬 [testrun] Manual test run requested by ${sender.login} for ${repoFullName}#${prNumber}`);

  // Parse flags from comment
  const envMatch = comment.body.match(/-env=(\S+)/i);
  const envUrl = envMatch ? envMatch[1].trim() : null;
  // Accept -context in any format — quoted, =value, or free-form space-separated
  // e.g: -context="email: foo@bar.com; password: Abc123"
  //      -context=cookie:session=abc123
  //      -context credentials email: foo@bar.com; password: Abc123.
  const contextMatch =
    comment.body.match(/-context="([^"]+)"/i) ||              // -context="..."
    comment.body.match(/-context='([^']+)'/i) ||              // -context='...'
    comment.body.match(/-context=(\S+)/i) ||                  // -context=word
    comment.body.match(/-context\s+(.+?)(?=\s+-\w|\n|$)/is); // -context anything until next flag or EOL
  const rawContext = contextMatch ? contextMatch[1].trim() : null;

  // Always pass the full raw text to the agent so it can interpret anything
  let userContext = rawContext;
  let authCookies = null;
  let inlineCredentials = null;

  if (rawContext) {
    // Extract explicit cookie:name=value entries (must be injected programmatically)
    const cookiePattern = /cookie:([^\s,]+(?:=[^\s,]+)?(?:;[^\s,]+(?:=[^\s,]+)?)*)/gi;
    const cookieMatches = rawContext.match(cookiePattern);
    if (cookieMatches) {
      authCookies = cookieMatches.map(m => m.replace(/^cookie:/i, '')).join(';');
      console.log(`🍪 [testrun] Auth cookies detected in context`);
    }

    // Use AI to extract email + password in any format the user typed
    // (e.g. "credentials email: foo@bar.com; password: Abc." or "login with foo / Bar123")
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const extraction = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        temperature: 0,
        messages: [{
          role: 'user',
          content: `Extract login credentials from this text. Reply with JSON only: {"email":"...","password":"..."} or {"email":null,"password":null} if not present. Strip trailing punctuation from values.\n\nText: ${rawContext}`
        }]
      });
      const rawText = extraction.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
      const json = JSON.parse(rawText);
      if (json.email && json.password) {
        inlineCredentials = { email: json.email, password: json.password };
        console.log(`🔐 [testrun] AI extracted credentials for: ${inlineCredentials.email}`);
      }
    } catch (err) {
      console.warn(`⚠️ [testrun] Could not AI-extract credentials from context: ${err.message}`);
    }
  }

  // 1. Look up staging URL + test credentials: inline flag > client settings > env var
  let baseUrl = envUrl || null;
  let testCredentials = inlineCredentials || null;

  if (isSupabaseConfigured() && userId) {
    const { data: settings } = await supabaseAdmin
      .from('client_settings')
      .select('staging_url, test_user_email, test_user_password')
      .eq('user_id', userId)
      .maybeSingle();
    if (!baseUrl) baseUrl = settings?.staging_url || null;
    // Inline credentials from the comment take priority over saved settings
    if (!testCredentials && settings?.test_user_email) {
      testCredentials = {
        email: settings.test_user_email,
        password: settings.test_user_password || ''
      };
    }
  }

  if (!baseUrl) {
    baseUrl = process.env.TEST_AUTOMATION_BASE_URL || null;
  }

  if (!baseUrl) {
    await postComment(repoFullName, prNumber,
      `⚠️ **No staging URL configured.**\n\nProvide one inline:\n\`\`\`\n/qa testrun -env=https://staging.yourapp.com\n\`\`\`\nOr set it in [FirstQA Settings](${process.env.BASE_URL || 'https://www.firstqa.dev'}/dashboard/settings).`
    );
    return { success: false, message: 'No staging URL' };
  }
  baseUrl = baseUrl.replace(/\/+$/, '');

  // 2. Look up the most recent /qa analysis for this PR (DB first, then PR comments as fallback)
  let fullRecipe = [];

  if (isSupabaseConfigured()) {
    const { data: analysis } = await supabaseAdmin
      .from('analyses')
      .select('result')
      .eq('repository', repoFullName)
      .eq('pr_number', prNumber)
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (analysis?.result) {
      const rawData = analysis.result.raw || analysis.result;
      fullRecipe = parseTestRecipeFromAiResponse(rawData);
      console.log(`📊 [testrun] Found analysis in DB: ${fullRecipe.length} scenarios`);
    }
  }

  // Fallback: parse test recipe from PR comments if DB had nothing
  if (fullRecipe.length === 0) {
    console.log(`🔄 [testrun] No analysis in DB — scanning PR comments for test recipe...`);
    try {
      const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repo);
      if (repoOctokit) {
        const { data: comments } = await repoOctokit.issues.listComments({
          owner, repo, issue_number: prNumber, per_page: 30
        });
        // Find the most recent bot comment containing a Test Recipe table
        const botComments = comments
          .filter(c => c.user?.login?.includes('[bot]') || c.user?.type === 'Bot')
          .filter(c => c.body?.includes('Test Recipe') && c.body?.includes('| Scenario'))
          .reverse();

        for (const bc of botComments) {
          fullRecipe = parseTestRecipeFromAiResponse(bc.body);
          if (fullRecipe.length > 0) {
            console.log(`✅ [testrun] Parsed ${fullRecipe.length} scenarios from PR comment fallback`);
            break;
          }
        }
      }
    } catch (err) {
      console.warn(`⚠️ [testrun] Comment fallback failed: ${err.message}`);
    }
  }

  if (fullRecipe.length === 0) {
    await postComment(repoFullName, prNumber,
      `⚠️ **No prior analysis found for this PR.**\n\nRun \`/qa\` first to generate a QA analysis with a test recipe, then use \`/qa testrun\` to execute those tests.`
    );
    return { success: false, message: 'No prior analysis' };
  }


  // 4. Filter: run UI + API scenarios, skip Unit
  const unitSkipped = fullRecipe.filter(s => s.automation && s.automation.toLowerCase() === 'unit');
  const runnableRecipe = fullRecipe.filter(s => {
    if (!s.automation) return true;
    return s.automation.toLowerCase() !== 'unit';
  });

  if (runnableRecipe.length === 0) {
    await postComment(repoFullName, prNumber,
      `⏭️ All ${fullRecipe.length} test scenario(s) are Unit-level — these need a code test runner, not a browser. Nothing to execute.`
    );
    return { success: true, message: 'All Unit scenarios — skipped' };
  }

  // 5. Classify change type — block docs/infra, warn backend-only
  let changeNote = '';
  if (installationId) {
    try {
      const { getOctokit } = require('../services/githubChecksService');
      const octokit = await getOctokit(installationId);
      const { data: files } = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber, per_page: 100 });
      const { classifyPRChangeType } = require('./changeTypeClassifier');
      const classification = classifyPRChangeType(files.map(f => f.filename));

      if (classification.type === 'documentation' || classification.type === 'infrastructure') {
        await postComment(repoFullName, prNumber,
          `⏭️ This PR is classified as **${classification.type}** — no testable UI changes detected. Skipping test execution.`
        );
        return { success: true, message: `Skipped: ${classification.type} PR` };
      }

      if (!classification.shouldRunBrowserTests) {
        changeNote = `\n> ℹ️ This PR is classified as **${classification.type}** — browser tests may have limited coverage for non-frontend changes.\n`;
      }
    } catch (err) {
      console.warn('⚠️ [testrun] Could not classify change type:', err.message);
    }
  }

  // 6. Post acknowledgment and start execution
  let unitNote = '';
  if (unitSkipped.length > 0) {
    unitNote = `\n> ${unitSkipped.length} unit test scenario${unitSkipped.length > 1 ? 's' : ''} skipped (run in your test suite):\n${unitSkipped.map(s => `> - ${s.scenario}`).join('\n')}\n`;
  }

  await postComment(repoFullName, prNumber,
    `🤖 **Starting test execution** — ${runnableRecipe.length} scenario${runnableRecipe.length > 1 ? 's' : ''} against \`${baseUrl}\`${changeNote}${unitNote}\nResults will be posted here when complete.`
  );

  // 7. Get PR head SHA for the Check Run
  let sha = null;
  try {
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repo);
    if (repoOctokit) {
      const { data: prData } = await repoOctokit.pulls.get({ owner, repo, pull_number: prNumber });
      sha = prData.head.sha;
    }
  } catch (err) {
    console.warn('⚠️ [testrun] Could not fetch PR SHA:', err.message);
  }

  if (!sha) {
    console.warn('⚠️ [testrun] No SHA available — Check Run will not be created');
  }

  // 8. Fetch product knowledge for executor context (routes, UI vocab, flows)
  let appKnowledge = null;
  if (process.env.ENABLE_KNOWLEDGE_SYNC === 'true' && isSupabaseConfigured()) {
    try {
      const { data: rc } = await supabaseAdmin
        .from('repo_context')
        .select('product_areas, user_flows')
        .eq('repo_id', repoFullName)
        .maybeSingle();
      if (rc) {
        const areas = rc.product_areas ? Object.values(rc.product_areas).slice(0, 8).map(a => a.name || a.slug).filter(Boolean) : [];
        const flows = rc.user_flows ? rc.user_flows.slice(0, 10).map(f => f.name).filter(Boolean) : [];
        if (areas.length || flows.length) {
          appKnowledge = [
            areas.length ? `App areas: ${areas.join(', ')}` : '',
            flows.length ? `Key flows: ${flows.join(', ')}` : ''
          ].filter(Boolean).join('\n');
          console.log(`📚 [testrun] App knowledge loaded for executor: ${areas.length} areas, ${flows.length} flows`);
        }
      }
    } catch (pkErr) {
      console.warn(`⚠️ [testrun] Could not load app knowledge: ${pkErr.message}`);
    }
  }

  // 9. Execute tests (non-blocking)
  const { executeAutomatedTests } = require('../services/automatedTestOrchestrator');
  executeAutomatedTests({
    owner,
    repo,
    prNumber,
    sha: sha || null,
    testRecipe: runnableRecipe,
    baseUrl,
    installationId,
    userContext,
    testCredentials,
    authCookies,
    appKnowledge
  }).catch(err => {
    console.error(`❌ [testrun] Execution failed for ${repoFullName}#${prNumber}:`, err.message);
    postComment(repoFullName, prNumber,
      `❌ **Test execution failed:** ${err.message}\n\nCheck the logs or try again with \`/qa testrun\`.`
    ).catch(() => {});
  });

  return { success: true, message: `Test execution started: ${runnableRecipe.length} scenarios` };
}

/**
 * Process a GitHub webhook event
 */
async function processWebhookEvent(event) {
  try {
    const eventType = event.headers['x-github-event'];
    const payload = event.body;
    console.log('📣 Processing webhook event:', eventType);
    
    // Extract installation_id to link webhook to user account
    const installationId = payload.installation?.id;
    console.log(`🔑 Installation ID: ${installationId}`);
    
    // Look up user_id from database using installation_id
    let userId = null;
    if (installationId && isSupabaseConfigured()) {
      try {
        console.log(`🔍 Looking up user for installation: ${installationId} (${typeof installationId})`);
        // Use .limit(1) instead of .single() to handle potential duplicates gracefully
        const { data: integrations, error } = await supabaseAdmin
          .from('integrations')
          .select('user_id')
          .eq('provider', 'github')
          .eq('account_id', installationId.toString())
          .limit(1);
        
        console.log(`🔍 Query result - data:`, integrations, error ? `queryErr: ${error.message}` : 'ok');
        
        if (error) {
          console.error(`❌ Error querying for user:`, error);
        }
        
        if (integrations && integrations.length > 0) {
          userId = integrations[0].user_id;
          console.log(`✅ Found user_id: ${userId} for installation: ${installationId}`);
        } else {
          console.warn(`⚠️ No user found for installation ${installationId}`);
        }
      } catch (error) {
        console.error('❌ Exception looking up user by installation_id:', error.message);
        console.error('❌ Stack:', error.stack);
      }
    }
    
    // Log a short summary only (no payload body/diff to avoid leaking code and flooding logs)
    const repo = payload.repository?.full_name || payload.pull_request?.base?.repo?.full_name || '?';
    const prNum = payload.pull_request?.number ?? payload.issue?.number;
    const action = payload.action || payload.review?.state;
    console.log(`Event: ${eventType} action=${action} repo=${repo}${prNum != null ? ` #${prNum}` : ''}`);

    // Handle GitHub App uninstall — clean up stale integration records
    if (eventType === 'installation' && payload.action === 'deleted' && installationId) {
      console.log(`🗑️ GitHub App uninstalled (installation ${installationId}) — removing integration records`);
      if (isSupabaseConfigured()) {
        try {
          const { error } = await supabaseAdmin
            .from('integrations')
            .delete()
            .eq('provider', 'github')
            .eq('account_id', installationId.toString());
          if (error) {
            console.error('❌ Failed to delete integration on uninstall:', error.message);
          } else {
            console.log(`✅ Removed GitHub integration for installation ${installationId}`);
          }
        } catch (e) {
          console.error('❌ Exception during uninstall cleanup:', e.message);
        }
      }
      return { success: true, message: 'Installation deleted — integration cleaned up' };
    }

    // Handle installation_repositories - auto-index on repo connection
    if (eventType === 'installation_repositories' && payload.action === 'added' && process.env.AUTO_INDEX_ON_INSTALL === 'true') {
      const repos = payload.repositories_added || [];
      for (const repo of repos) {
        const repoFullName = repo.full_name || `${repo.owner?.login}/${repo.name}`;
        const hasKnowledge = await (async () => {
          if (!isSupabaseConfigured()) return true;
          const { count } = await supabaseAdmin.from('product_knowledge').select('*', { count: 'exact', head: true }).eq('repo_id', repoFullName).limit(1);
          return (count || 0) > 0;
        })();
        if (!hasKnowledge) {
          const { analyzeRepository } = require('../services/knowledgeBase/codebaseAnalyzer');
          const { getOctokit } = require('../services/githubChecksService');
          const octokit = await getOctokit(installationId);
          let prNumber = null;
          if (octokit) {
            try {
              const [owner, repoName] = repoFullName.split('/');
              const prs = await octokit.pulls.list({ owner, repo: repoName, state: 'open', sort: 'created', direction: 'desc', per_page: 1 });
              if (prs.data?.[0]) prNumber = prs.data[0].number;
            } catch (e) {
              console.warn('Could not fetch latest PR for installation comment:', e.message);
            }
          }
          const postCommentFn = prNumber ? (body) => postComment(repoFullName, prNumber, body) : null;
          if (postCommentFn) {
            await postCommentFn('🚀 **FirstQA is learning your codebase...** This will take 5-10 minutes. You\'ll be notified when complete.');
          }
          analyzeRepository(repoFullName, installationId, 'main', postCommentFn ? { postComment: postCommentFn } : null).catch(err => {
            console.error('Auto-index on install failed:', err.message);
          });
        }
      }
    }

    // Handle pull_request event - NO automatic analysis on PR open
    // Analysis is triggered ONLY via /qa comment command
    if (eventType === 'pull_request' && payload.action === 'opened') {
      const { repository, pull_request: pr } = payload;
      console.log(`📋 PR #${pr?.number} opened on ${repository?.full_name} - waiting for /qa command to trigger analysis`);
      // Background PR knowledge sync (non-blocking)
      if (process.env.ENABLE_KNOWLEDGE_SYNC === 'true' && installationId && pr?.head?.sha) {
        const { syncPRKnowledge } = require('../services/knowledgeBase/prKnowledgeSync');
        syncPRKnowledge(pr.number, repository.full_name, installationId, pr.head.sha).catch(err =>
          console.error('PR knowledge sync error:', err.message)
        );
      }
      return { success: true, message: 'PR opened - use /qa command to trigger analysis' };
    }

    // PR synchronize (new commits) - background knowledge sync
    if (eventType === 'pull_request' && payload.action === 'synchronize') {
      const { repository, pull_request: pr } = payload;
      if (process.env.ENABLE_KNOWLEDGE_SYNC === 'true' && installationId && pr?.head?.sha) {
        const { syncPRKnowledge } = require('../services/knowledgeBase/prKnowledgeSync');
        syncPRKnowledge(pr.number, repository.full_name, installationId, pr.head.sha).catch(err =>
          console.error('PR knowledge sync error:', err.message)
        );
      }
    }

    // Handle pull_request closed + merged - knowledge sync
    if (eventType === 'pull_request' && payload.action === 'closed' && payload.pull_request?.merged === true) {
      const { repository, pull_request: pr } = payload;
      if (process.env.ENABLE_KNOWLEDGE_SYNC === 'true' && installationId && pr?.head?.sha) {
        const { syncPRKnowledge } = require('../services/knowledgeBase/prKnowledgeSync');
        syncPRKnowledge(pr.number, repository.full_name, installationId, pr.head.sha).catch(err =>
          console.error('PR knowledge sync error:', err.message)
        );
      }
    }

    // Handle issue comment event (for /qa commands)
    if (eventType === 'issue_comment' && payload.action === 'created') {
      console.log('💬 New comment detected');
      const { repository, issue, comment, sender } = payload;
      if (!repository || !issue || !comment || !sender) {
        console.error('Missing required properties in payload', { 
          hasRepository: !!repository, 
          hasIssue: !!issue, 
          hasComment: !!comment, 
          hasSender: !!sender 
        });
        return { success: false, message: 'Missing required properties in payload' };
      }
      // Only process comments on PRs
      if (!issue.pull_request) {
        console.log('Skipping non-PR comment');
        return { success: true, message: 'Skipped non-PR comment' };
      }
      // Skip comments from bots to avoid processing our own acknowledgment comments
      if (sender.type === 'Bot' || sender.login.endsWith('[bot]') || comment.body.includes('🤖 Ovi QA Assistant')) {
        console.log(`Skipping bot comment from ${sender.login}`);
        return { success: true, message: 'Skipped bot comment' };
      }
      console.log(`Comment body: ${comment.body}`);
      // Check for /qa testrun command (run tests from prior analysis)
      const commentTrimmed = comment.body.trim().toLowerCase();
      if (commentTrimmed.startsWith('/qa testrun') || commentTrimmed.startsWith('/qa -testrun')) {
        console.log('🔬 /qa testrun command detected!');
        return await handleTestRunCommand(repository, issue, comment, sender, userId, installationId);
      }
      // Check for /qa command (manual QA analysis) — must be exactly "/qa" or "/qa " followed by flags
      if (/^\/qa(\s|$)/.test(commentTrimmed)) {
        console.log('🧪 /qa command detected!');
        return await handleTestRequest(repository, issue, comment, sender, userId, installationId);
      }
      // Check for /short command (short QA analysis)
      if (/^\/short(\s|$)/.test(commentTrimmed)) {
        console.log('📝 /short command detected!');
        return await handleShortRequest(repository, issue, comment, sender, userId);
      }
    }
    // For all other event types, just log and return success
    return { 
      success: true,
      message: `Event type ${eventType} received but not processed`
    };
  } catch (error) {
    // Log detailed error information
    console.error('❌ Error processing webhook event:', error.message);
    console.error('Error details:', error);
    return {
      success: false,
      error: error.message
    };
  }
}
// Test the GitHub token immediately on startup
async function testGitHubToken() {
  try {
    // First try to verify the PAT if available
    if (octokit) {
      try {
        const response = await octokit.users.getAuthenticated();
        console.log(`✅ GitHub PAT successfully verified! Authenticated as: ${response.data.login}`);
        simulatedMode = false;
        return;
      } catch (error) {
        console.warn('❌ GitHub PAT verification failed:', error.message);
        console.log('⚠️ Will try GitHub App authentication instead');
      }
    }
    // Try to verify GitHub App authentication
    const jwt = githubAppAuth.getGitHubAppJWT();
    if (jwt) {
      const appOctokit = new Octokit({ auth: jwt });
      const { data: app } = await appOctokit.apps.getAuthenticated();
      console.log(`✅ GitHub App authentication successful! App: ${app.name}`);
      simulatedMode = false;
    } else {
      console.warn('❌ GitHub App authentication not available');
      console.warn('⚠️ Switching to simulated mode');
      simulatedMode = true;
    }
  } catch (error) {
    console.error('❌ GitHub authentication verification failed:', error.message);
    console.warn('⚠️ Switching to simulated mode');
    simulatedMode = true;
  }
}
/**
 * Get detailed authentication status for debugging
 */
async function getAuthenticationStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    simulatedMode: simulatedMode,
    patToken: !!process.env.GITHUB_TOKEN,
    githubApp: {
      appId: !!process.env.GITHUB_APP_ID,
      privateKey: !!process.env.GITHUB_PRIVATE_KEY,
      webhookSecret: !!process.env.GITHUB_WEBHOOK_SECRET
    },
    octokitInitialized: !!octokit,
    authenticationMethods: []
  };
  // Test PAT authentication
  if (octokit && process.env.GITHUB_TOKEN) {
    try {
      const response = await octokit.users.getAuthenticated();
      status.authenticationMethods.push({
        type: 'PAT',
        status: 'success',
        user: response.data.login,
        permissions: 'Standard user permissions'
      });
    } catch (error) {
      status.authenticationMethods.push({
        type: 'PAT',
        status: 'failed',
        error: error.message
      });
    }
  }
  // Test GitHub App authentication
  const jwt = githubAppAuth.getGitHubAppJWT();
  if (jwt) {
    try {
      const appOctokit = new Octokit({ auth: jwt });
      const { data: app } = await appOctokit.apps.getAuthenticated();
      status.authenticationMethods.push({
        type: 'GitHub App',
        status: 'success',
        appName: app.name,
        appId: app.id
      });
    } catch (error) {
      status.authenticationMethods.push({
        type: 'GitHub App',
        status: 'failed',
        error: error.message
      });
    }
  }
  return status;
}
/**
 * Test repository access for a specific repo
 */
async function testRepositoryAccess(repository) {
  const [owner, repoName] = repository.split('/');
  if (!owner || !repoName) {
    return { success: false, error: 'Invalid repository format' };
  }
  try {
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    if (!repoOctokit) {
      return { 
        success: false, 
        error: 'No authentication available for this repository',
        recommendation: 'Install the GitHub App on this repository'
      };
    }
    // Test basic repository access
    const repoResponse = await repoOctokit.repos.get({ owner, repo: repoName });
    // Test pull request access
    const prResponse = await repoOctokit.pulls.list({ 
      owner, 
      repo: repoName, 
      state: 'all',
      per_page: 1 
    });
    return {
      success: true,
      repository: repoResponse.data.full_name,
      permissions: {
        repository: 'read',
        pullRequests: 'read'
      },
      message: 'Repository access successful'
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      recommendation: error.status === 404 ? 
        'Repository not found or GitHub App not installed' :
        'Check repository permissions and GitHub App installation'
    };
  }
}
// Run the token test
testGitHubToken();
// Note: getAuthenticationStatus and testRepositoryAccess are exported in the final module.exports below
// Run archiving operation when module is loaded
setTimeout(() => {
  console.log('Running scheduled archive operation...');
  archiveOldRequests();
  // Also create an initial backup
  console.log('Creating initial backup...');
  backupTestRequests();
  // Schedule regular backups (every 4 hours)
  setInterval(() => {
    console.log('Running scheduled backup...');
    backupTestRequests();
  }, 4 * 60 * 60 * 1000); // 4 hours in milliseconds
}, 5000); // Wait 5 seconds after startup
/**
 * Create a backup of test requests data
 * This helps prevent data loss during deployments
 */
function backupTestRequests() {
  try {
    // Create backup directory if it doesn't exist
    const backupDir = path.join(dataDir, 'backups');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
      console.log(`Created backup directory at ${backupDir}`);
    }
    // Generate backup filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFile = path.join(backupDir, `test-requests-${timestamp}.json`);
    // Copy current test requests to backup
    if (fs.existsSync(TEST_REQUESTS_PATH)) {
      fs.copyFileSync(TEST_REQUESTS_PATH, backupFile);
      console.log(`Created backup of test requests at ${backupFile}`);
    }
    // Copy archive to backup if it exists
    if (fs.existsSync(ARCHIVE_PATH)) {
      const archiveBackupFile = path.join(backupDir, `archived-requests-${timestamp}.json`);
      fs.copyFileSync(ARCHIVE_PATH, archiveBackupFile);
      console.log(`Created backup of archived requests at ${archiveBackupFile}`);
    }
    // Clean up old backups (keep only the last 10)
    const backupFiles = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('test-requests-'))
      .sort()
      .reverse();
    if (backupFiles.length > 10) {
      const filesToDelete = backupFiles.slice(10);
      filesToDelete.forEach(file => {
        fs.unlinkSync(path.join(backupDir, file));
        console.log(`Deleted old backup file: ${file}`);
      });
    }
    return true;
  } catch (error) {
    console.error('Error creating backup:', error);
    return false;
  }
}
/**
 * Restore test requests from the most recent backup if needed
 * This is called automatically if the main data files are missing
 */
function restoreFromBackup() {
  try {
    // If both main files exist, no need to restore
    if (fs.existsSync(TEST_REQUESTS_PATH) && fs.existsSync(ARCHIVE_PATH)) {
      return false;
    }
    console.log('Main data files missing or corrupted, attempting to restore from backup...');
    // Check for backup directory
    const backupDir = path.join(dataDir, 'backups');
    if (!fs.existsSync(backupDir)) {
      console.warn('No backup directory found, cannot restore data');
      return false;
    }
    // Find the most recent backups
    const testRequestBackups = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('test-requests-'))
      .sort()
      .reverse();
    const archiveBackups = fs.readdirSync(backupDir)
      .filter(file => file.startsWith('archived-requests-'))
      .sort()
      .reverse();
    // Restore test requests if needed
    if (!fs.existsSync(TEST_REQUESTS_PATH) && testRequestBackups.length > 0) {
      const latestBackup = path.join(backupDir, testRequestBackups[0]);
      fs.copyFileSync(latestBackup, TEST_REQUESTS_PATH);
      console.log(`Restored test requests from backup: ${latestBackup}`);
    }
    // Restore archive if needed
    if (!fs.existsSync(ARCHIVE_PATH) && archiveBackups.length > 0) {
      const latestArchiveBackup = path.join(backupDir, archiveBackups[0]);
      fs.copyFileSync(latestArchiveBackup, ARCHIVE_PATH);
      console.log(`Restored archived requests from backup: ${latestArchiveBackup}`);
    }
    return true;
  } catch (error) {
    console.error('Error restoring from backup:', error);
    return false;
  }
}
module.exports = {
  processWebhookEvent,
  postComment,
  addOviReviewedLabel,
  loadTestRequests,
  loadAllTestRequests,
  saveTestRequests,
  parseTestRequestComment,
  updateTestRequestStatus,
  postCommentToPR,
  submitTestReport,
  postWelcomeComment,
  backupTestRequests,
  restoreFromBackup,
  formatHybridAnalysisForComment,
  formatShortAnalysisForComment,
  getAuthenticationStatus,
  testRepositoryAccess
};