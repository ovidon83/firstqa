/**
 * GitHub Service for webhook processing
 * Implements actual functionality for handling /qa-review commands
 */
const { Octokit } = require('@octokit/rest');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const axios = require('axios');
const githubAppAuth = require('./githubAppAuth');

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

// Configure email transporter
let emailTransporter;
try {
  // Use nodemailer to send emails
  emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_FROM,
      pass: process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD
    }
  });
  console.log('✅ Email transporter initialized');
} catch (error) {
  console.error('⚠️ Error initializing email transporter:', error.message);
}

// Ensure data directory exists
const homeDir = process.env.HOME || process.env.USERPROFILE;
let dataDir = process.env.DATA_DIR || path.join(homeDir, '.getyourtester', 'data');

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

// Define status labels with emojis
const STATUS_LABELS = {
  'pending': '⏳ GYT-Pending',
  'in-progress': '🔄 GYT-In Progress',
  'delayed': '⏰ GYT-Delayed',
  'blocked': '🚫 GYT-Blocked',
  'complete-pass': '✅ GYT-Complete: PASS',
  'complete-fail': '❌ GYT-Complete: FAIL'
};

// Get all status label patterns (without emoji) for removal
const STATUS_LABEL_PATTERNS = Object.values(STATUS_LABELS).map(label => 
  label.substring(label.indexOf('GYT-'))
);

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
    const { generateQAInsights } = require('../../ai/openaiClient');
    
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
    const { generateShortAnalysis } = require('../../ai/openaiClient');
    
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
 * Parse a /qa-review comment to extract test request details
 */
function parseTestRequestComment(comment) {
  // Skip the "/qa-review" part
  const content = comment.replace(/^\/qa-review\s+/, '').trim();
  
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
    const toEmail = process.env.NOTIFICATION_EMAIL || process.env.EMAIL_TO || 'ovidon83@gmail.com';
    const fromEmail = process.env.EMAIL_FROM || process.env.SMTP_USER || 'noreply@getyourtester.com';

    // Extract repository owner and name
    const [owner, repo] = testRequest.repository ? testRequest.repository.split('/') : ['unknown', 'unknown'];

    const mailOptions = {
      from: `"GetYourTester" <${fromEmail}>`,
      to: toEmail,
      subject: `New Test Request for PR #${testRequest.prNumber}`,
      html: `
        <h2>🧪 New Test Request Received</h2>
        <p>A new test request has been submitted and requires your attention.</p>
        
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
          <pre style="white-space: pre-wrap; font-family: monospace;">${testRequest.comment ? testRequest.comment.replace(/^\/qa-review\s+/, '').trim() : 'No content available'}</pre>
        </div>
        
        <p>Please login to the <a href="http://localhost:3000/dashboard" style="background-color: #0366d6; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">dashboard</a> to manage this request.</p>
        
        <p>Thank you,<br/>GetYourTester Bot</p>
      `,
      text: `
🧪 New Test Request Received

A new test request has been submitted and requires your attention.

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
${testRequest.comment ? testRequest.comment.replace(/^\/qa-review\s+/, '').trim() : 'No content available'}

Please login to the dashboard to manage this request: http://localhost:3000/dashboard

Thank you,
GetYourTester Bot
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
    if (simulatedMode || !octokit) {
      console.error(`❌ Cannot fetch real PR description for ${repository}#${prNumber} - Authentication not available`);
      return 'Error: Authentication not configured or app not installed';
    }
    
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repository}. Should be in format 'owner/repo'`);
      return 'Error: Invalid repository format';
    }
    
    // Try to get repository-specific authentication first
    let repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
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
 * Fetch PR diff for AI analysis
 */
async function fetchPRDiff(repository, prNumber) {
  try {
    // Check if we're in simulated mode or don't have authentication
    if (simulatedMode || !octokit) {
      console.error(`❌ Cannot fetch real PR diff for ${repository}#${prNumber} - Authentication not available`);
      console.log(`📋 Simulated mode: ${simulatedMode}, Octokit available: ${!!octokit}`);
      return 'Error fetching PR diff: Authentication not configured or app not installed';
    }
    
    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repository}. Should be in format 'owner/repo'`);
      return 'Error: Invalid repository format';
    }
    
    // Try to get repository-specific authentication first
    let repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
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
 * Update labels on a GitHub PR, removing old status labels and adding new ones
 */
async function updateLabels(repo, issueNumber, newLabels) {
  try {
    const [owner, repoName] = repo.split('/');
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repo}. Should be in format 'owner/repo'`);
      return { success: false, error: 'Invalid repository format' };
    }
    
    // Get an Octokit instance for this repository
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    
    if (!repoOctokit) {
      console.log(`[SIMULATED] Would update labels on ${repo}#${issueNumber} to: ${newLabels.join(', ')}`);
      return { success: true, simulated: true };
    }
    
    // Get current labels
    const currentLabelsResponse = await repoOctokit.issues.listLabelsOnIssue({
      owner,
      repo: repoName,
      issue_number: issueNumber
    });
    
    const currentLabels = currentLabelsResponse.data.map(label => label.name);
    
    // Remove existing status labels
    const labelsToKeep = currentLabels.filter(label => {
      return !STATUS_LABEL_PATTERNS.some(pattern => label.includes(pattern));
    });
    
    // Add new labels
    const updatedLabels = [...labelsToKeep, ...newLabels];
    
    // Set the new labels
    const response = await repoOctokit.issues.setLabels({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      labels: updatedLabels
    });
    
    console.log(`Labels updated on ${repo}#${issueNumber}: ${updatedLabels.join(', ')}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`Failed to update labels on ${repo}#${issueNumber}:`, error.message);
    
    // Check if the error is due to invalid credentials or permissions
    if (error.status === 401 || error.status === 403) {
      console.warn('Authentication error: Invalid GitHub token or insufficient permissions');
    } else if (error.status === 404) {
      console.warn(`Repository or issue not found: ${repo}#${issueNumber}`);
    }
    
    console.log(`[SIMULATED] Would update labels on ${repo}#${issueNumber} to: ${newLabels.join(', ')}`);
    return { success: true, simulated: true, error: error.message };
  }
}

/**
 * Add a label to a GitHub PR
 */
async function addLabel(repo, issueNumber, labels) {
  try {
    // Use the new updateLabels function to ensure only one status label exists
    const statusLabels = labels.filter(label => 
      STATUS_LABEL_PATTERNS.some(pattern => label.includes(pattern))
    );
    
    if (statusLabels.length > 0) {
      return await updateLabels(repo, issueNumber, labels);
    }
    
    const [owner, repoName] = repo.split('/');
    // Handle case where repo might not have correct format
    if (!owner || !repoName) {
      console.error(`Invalid repository format: ${repo}. Should be in format 'owner/repo'`);
      return { success: false, error: 'Invalid repository format' };
    }
    
    // Get an Octokit instance for this repository
    const repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
    
    if (!repoOctokit) {
      console.log(`[SIMULATED] Would add labels to ${repo}#${issueNumber}: ${labels.join(', ')}`);
      return { success: true, simulated: true };
    }
    
    const response = await repoOctokit.issues.addLabels({
      owner,
      repo: repoName,
      issue_number: issueNumber,
      labels
    });
    
    console.log(`Labels added to ${repo}#${issueNumber}: ${labels.join(', ')}`);
    return { success: true, data: response.data };
  } catch (error) {
    console.error(`Failed to add labels to ${repo}#${issueNumber}:`, error.message);
    
    // Check if the error is due to invalid credentials or permissions
    if (error.status === 401 || error.status === 403) {
      console.warn('Authentication error: Invalid GitHub token or insufficient permissions');
    } else if (error.status === 404) {
      console.warn(`Repository or issue not found: ${repo}#${issueNumber}`);
    }
    
    console.log(`[SIMULATED] Would add labels to ${repo}#${issueNumber}: ${labels.join(', ')}`);
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
  
  // Update the PR label
  if (testRequest.repository && testRequest.prNumber) {
    // Add the appropriate status label with emoji
    const statusLabel = STATUS_LABELS[newStatus];
    await updateLabels(testRequest.repository, testRequest.prNumber, [statusLabel]);
    
    // Post a comment about the status change if requested
    if (postCommentUpdate) {
      const statusComment = `
## 🔄 Test Status Update

The test request status has been updated to ${newStatus}.
      `;
      
      await postComment(testRequest.repository, testRequest.prNumber, statusComment);
    }
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

☕ If this helped you ship better, you can support the project: [BuyMeACoffee.com/getyourtester](https://buymeacoffee.com/getyourtester)
  `;
  
  // Post the report as a comment
  const commentResult = await postComment(testRequest.repository, testRequest.prNumber, reportComment);
  
  // Update the PR label with the status
  const statusLabel = STATUS_LABELS[testResult];
  await updateLabels(testRequest.repository, testRequest.prNumber, [statusLabel]);
  
  return { success: true, testRequest, commentResult };
}

/**
 * Post a welcome comment on a newly created PR
 */
async function postWelcomeComment(repository, prNumber) {
  const welcomeComment = `
**Welcome to GetYourTester!**

_Early-access mode: Your first test requests (up to 4 hours) are **FREE**!_

If you find value, you can support the project: [BuyMeACoffee.com/getyourtester](https://buymeacoffee.com/getyourtester)

Request a QA review by commenting: /qa-review followed by details like: Title, Acceptance Criteria, Test Environment, Design, and so on.

**Example test request:**
\`\`\`
/qa-review

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
 * Handle test request - core functionality
 */
async function handleTestRequest(repository, issue, comment, sender) {
  console.log(`Processing test request from ${sender.login} on PR #${issue.number}`);
  console.log(`Repository: ${repository.full_name}`);
  console.log(`Comment: ${comment.body}`);

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
  
  // Generate AI insights for the PR via API endpoint
  console.log('🤖 Ovi QA Agent analyzing PR...');
  let aiInsights;
  try {
    aiInsights = await callTestRecipeEndpoint({
      repo: repository.full_name,
      pr_number: issue.number,
      title: issue.title,
      body: prDescription,
      diff: prDiff
    });
    
    if (aiInsights && aiInsights.success) {
      console.log('✅ Ovi QA Agent analysis completed successfully');
    } else {
      console.error('❌ Ovi QA Agent analysis failed:', aiInsights?.error, aiInsights?.details);
    }
  } catch (error) {
    console.error('❌ Ovi QA Agent analysis threw exception:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Create error result
    aiInsights = {
      success: false,
      error: 'Ovi QA Agent analysis failed',
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
## 🧪 Test Request Received

Thank you for the testing request! Your request has been received and is being processed.
* **Status:** Pending
A tester will be assigned to this PR soon and you'll receive status updates notifications.
  `;
  
  // Add AI insights to the comment if they were generated successfully
  if (aiInsights && aiInsights.success) {
    // Use the same hybrid formatting as the automatic PR analysis
    acknowledgmentComment += formatHybridAnalysisForComment(aiInsights);
  } else if (aiInsights && !aiInsights.success) {
    acknowledgmentComment += `

*Note: Ovi QA Agent insights could not be generated for this PR (${aiInsights.error}), but manual testing will proceed as normal.*
    `;
  }
  
  const commentResult = await postComment(repository.full_name, issue.number, acknowledgmentComment);
  console.log(`✅ Acknowledgment comment ${commentResult.simulated ? 'would be' : 'was'} posted`);
  
  // Add status label
  const statusLabel = STATUS_LABELS['pending'];
  const labelResult = await addLabel(repository.full_name, issue.number, [statusLabel]);
  console.log(`✅ Label ${labelResult.simulated ? 'would be' : 'was'} added`);
  
  // Send email notification
  const emailResult = await sendEmailNotification(testRequest);
  if (emailResult.success) {
    console.log(`✅ Email notification sent about PR #${issue.number}`);
  } else {
    console.log(`❌ Email notification failed: ${emailResult.error || 'Unknown error'}`);
  }
  
  return {
    success: true,
    requestId,
    simulated: simulatedMode
  };
}

/**
 * Handle short request - generate a short analysis
 */
async function handleShortRequest(repository, issue, comment, sender) {
  console.log(`Processing short request from ${sender.login} on PR #${issue.number}`);
  console.log(`Repository: ${repository.full_name}`);
  console.log(`Comment: ${comment.body}`);

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
  console.log('🤖 Ovi QA Agent analyzing PR...');
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
      console.log('✅ Ovi QA Agent short analysis completed successfully');
    } else {
      console.error('❌ Ovi QA Agent short analysis failed:', aiInsights?.error, aiInsights?.details);
    }
  } catch (error) {
    console.error('❌ Ovi QA Agent short analysis threw exception:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Create error result
    aiInsights = {
      success: false,
      error: 'Ovi QA Agent short analysis failed',
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
## 🧪 Test Request Received

Thank you for the testing request! Your request has been received and is being processed.
* **Status:** Pending
A tester will be assigned to this PR soon and you'll receive status updates notifications.
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
  
  const commentResult = await postComment(repository.full_name, issue.number, acknowledgmentComment);
  console.log(`✅ Acknowledgment comment ${commentResult.simulated ? 'would be' : 'was'} posted`);
  
  // Add status label
  const statusLabel = STATUS_LABELS['pending'];
  const labelResult = await addLabel(repository.full_name, issue.number, [statusLabel]);
  console.log(`✅ Label ${labelResult.simulated ? 'would be' : 'was'} added`);
  
  // Send email notification
  const emailResult = await sendEmailNotification(testRequest);
  if (emailResult.success) {
    console.log(`✅ Email notification sent about PR #${issue.number}`);
  } else {
    console.log(`❌ Email notification failed: ${emailResult.error || 'Unknown error'}`);
  }
  
  return {
    success: true,
    requestId,
    simulated: simulatedMode
  };
}

/**
 * Format hybrid analysis for GitHub comment (shared by /qa-review and automatic PR analysis)
 */
function formatHybridAnalysisForComment(aiInsights) {
  const aiData = aiInsights.data;

  // Check if we have the new simplified format (4 questions approach)
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
    // New format - just add GetYourTester branding around it
    return `### 🤖 Ovi QA Assistant by GetYourTester

---

${aiData}

---

*🚀 Professional QA analysis generated by Ovi QA Assistant. Designed to support rapid releases with high quality.*`;
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

    return `### 🤖 Ovi QA Assistant by GetYourTester

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

*🚀 Professional QA analysis generated by Ovi QA Assistant. Designed to support rapid releases with high quality.*`;
  }

  // Final fallback for unexpected format
  return `### 🤖 Ovi QA Assistant by GetYourTester

---

**Analysis Status:** ⚠️ Processing Issue

The analysis was generated but could not be properly formatted. Please check the logs for more details.

---

*🚀 Professional QA analysis generated by Ovi QA Assistant. Designed to support rapid releases with high quality.*`;
}

/**
 * Format short analysis for GitHub comment (only Release Confidence Score, Risks, Test Recipe)
 */
            function formatShortAnalysisForComment(aiInsights) {
              const aiData = aiInsights.data;

              // Check if we have the new short analysis format
              if (typeof aiData === 'string' && (
                aiData.includes('🎯 Ovi QA Analysis - Short Version') ||
                aiData.includes('📊 Deployment Score') ||
                aiData.includes('⚠️ Risks') ||
                aiData.includes('🧪 Test Recipe')
              )) {
                // This is already in the correct short format, just add branding
                return `### 🤖 Ovi QA Assistant by GetYourTester

---

${aiData}

---

*🚀 Short QA analysis by Ovi QA Assistant. Use /qa-review for full details.*`;
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
    let shortOutput = '### 🤖 Ovi QA Assistant - Short Analysis\n\n---\n\n';
    
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
      shortOutput = `### 🤖 Ovi QA Assistant - Short Analysis\n\n---\n\n`;
      shortOutput += `*Unable to generate short format. Please use /qa-review for full analysis.*\n\n`;
      shortOutput += aiData;
    }
    
    shortOutput += `---\n\n*🚀 Short QA analysis by Ovi QA Assistant. Use /qa-review for full details.*`;
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

    return `### 🤖 Ovi QA Assistant - Short Analysis

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

*🚀 Short QA analysis by Ovi QA Assistant. Use /qa-review for full details.*`;
  }

  // Final fallback for unexpected format
  return `### 🤖 Ovi QA Assistant - Short Analysis

---

*Unable to generate short format. Please use /qa-review for full analysis.*

---

${aiData}`;
}

/**
 * Format and post detailed analysis with hybrid structure
 */
async function formatAndPostDetailedAnalysis(repository, prNumber, aiInsights) {
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
  const detailedComment = formatHybridAnalysisForComment(aiInsights);
   
   return await postComment(repository, prNumber, detailedComment);
}

/**
 * Handle PR opened event - generate comprehensive analysis
 */
async function handlePROpened(repository, pr) {
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

  // Use the same detailed analysis formatting and fallback as /ovi-details
  return await formatAndPostDetailedAnalysis(repository.full_name, pr.number, aiInsights);
}



/**
 * Process a GitHub webhook event
 */
async function processWebhookEvent(event) {
  try {
    const eventType = event.headers['x-github-event'];
    const payload = event.body;
    console.log('📣 Processing webhook event:', eventType);
    
    // Only log first 500 characters to avoid flooding the console
    const payloadString = JSON.stringify(payload, null, 2);
    console.log('Event payload:', payloadString.length > 500 
      ? payloadString.substring(0, 500) + '...(truncated)' 
      : payloadString);
    
    // Handle pull_request event (for PR opening - NEW BEHAVIOR)
    if (eventType === 'pull_request' && payload.action === 'opened') {
      console.log('🚀 New PR opened - generating short summary analysis');
      const { repository, pull_request: pr } = payload;
      
      if (!repository || !pr) {
        console.error('Missing required properties in payload');
        return { success: false, message: 'Missing required properties in payload' };
      }
      
      // Generate short summary for the PR
      console.log(`⚡ Generating short critical summary for PR #${pr.number}`);
      return await handlePROpened(repository, pr);
    }
    
    // Handle issue comment event (for /ovi-details commands)
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
      if (sender.type === 'Bot' || sender.login.includes('bot') || comment.body.includes('🤖 Ovi QA Assistant')) {
        console.log(`Skipping bot comment from ${sender.login}`);
        return { success: true, message: 'Skipped bot comment' };
      }

      console.log(`Comment body: ${comment.body}`);
      
      // Check for /qa-review command (manual QA review requests)
      if (comment.body.trim().startsWith('/qa-review')) {
        console.log('🧪 /qa-review command detected!');
        return await handleTestRequest(repository, issue, comment, sender);
      }
      
      // Check for /short command (short QA analysis)
      if (comment.body.trim().startsWith('/short')) {
        console.log('📝 /short command detected!');
        return await handleShortRequest(repository, issue, comment, sender);
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

// Export new functions
module.exports = {
  ...module.exports,
  getAuthenticationStatus,
  testRepositoryAccess
};

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
  addLabel,
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
  formatShortAnalysisForComment
};