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
    if (simulatedMode || !octokit) {
      console.error(`❌ Cannot fetch commits for ${repository}#${prNumber} - Authentication not available`);
      return [];
    }
    
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
    if (simulatedMode || !octokit) {
      console.error(`❌ Cannot fetch commit details for ${commitSHA} - Authentication not available`);
      return { sha: commitSHA, message: '', diff: '' };
    }

    const [owner, repoName] = repository.split('/');
    if (!owner || !repoName) {
      return { sha: commitSHA, message: '', diff: '' };
    }

    let repoOctokit = await githubAppAuth.getOctokitForRepo(owner, repoName);
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
 * Handle test request - core functionality
 */
async function handleTestRequest(repository, issue, comment, sender) {
  console.log(`Processing test request from ${sender.login} on PR #${issue.number}`);
  console.log(`Repository: ${repository.full_name}`);
  console.log(`Comment: ${comment.body}`);
  // Create a unique ID for this test request
  const requestId = `${repository.full_name.replace('/', '-')}-${issue.number}-${Date.now()}`;
  
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
  
  // Prepare comprehensive commits context for AI analysis
  let newCommitsContext = '';
  
  if (newCommits.length > 0) {
    const isUpdate = lastAnalyzedSHA !== null;
    
    // Analyze all commits to build a comprehensive change summary
    const chronologicalCommits = [...newCommits].reverse(); // Oldest first
    
    // Extract change types from commit messages and diffs with detailed parsing
    const changesSummary = {
      added: [],
      removed: [],
      fixed: [], // Array of objects: {commit: string, fixes: string[]}
      changed: [],
      userFacing: []
    };
    
    chronologicalCommits.forEach(commit => {
      const msg = commit.message.toLowerCase();
      const msgFirstLine = commit.message.split('\n')[0];
      const fullMessage = commit.message;
      
      // Enhanced parsing for fixes - extract what was actually fixed
      if (msg.includes('fix') || msg.includes('bug') || msg.includes('issue') || msg.includes('resolve')) {
        // Extract specific fixes mentioned in commit message with enhanced parsing
        const fixes = [];
        const fullMsgLower = fullMessage.toLowerCase();
        
        // Enhanced fix pattern extraction
        const fixPatterns = [
          /prevent\s+([^,\.:]+)/gi,
          /remove\s+([^,\.:]+)/gi,
          /fix\s+([^,\.:]+)/gi,
          /handle\s+([^,\.:]+)/gi,
          /resolve\s+([^,\.:]+)/gi,
          /avoid\s+([^,\.:]+)/gi,
          /stop\s+([^,\.:]+)/gi,
          /correct\s+([^,\.:]+)/gi,
          /add\s+([^,\.:]+)/gi, // Sometimes fixes add functionality
          /improve\s+([^,\.:]+)/gi,
          /ensure\s+([^,\.:]+)/gi
        ];
        
        fixPatterns.forEach(pattern => {
          let match;
          while ((match = pattern.exec(fullMessage)) !== null) {
            const fixDesc = match[1].trim();
            // Filter out very short or very long descriptions
            if (fixDesc && fixDesc.length > 3 && fixDesc.length < 100) {
              // Avoid duplicates and generic words
              if (!fixes.includes(fixDesc) && 
                  !fixDesc.match(/^(the|a|an|and|or|but|to|from|for|with|without|by)$/i)) {
                fixes.push(fixDesc);
              }
            }
          }
        });
        
        // Extract fixes from colon-separated format (e.g., "Fix: description")
        if (fullMessage.includes(':') && !fullMessage.includes('://')) {
          const parts = fullMessage.split(':');
          if (parts.length > 1) {
            const afterColon = parts.slice(1).join(':');
            // Split by commas, semicolons, or periods to get individual fixes
            const fixParts = afterColon.split(/[,;\.]/).map(s => s.trim()).filter(s => s.length > 5 && s.length < 150);
            fixParts.forEach(part => {
              if (!fixes.includes(part)) {
                fixes.push(part);
              }
            });
          }
        }
        
        // If commit message has specific fix descriptions, use them
        // Otherwise, try to extract from the first line
        if (fixes.length === 0) {
          // Try to extract meaningful parts from the commit message
          const meaningfulParts = msgFirstLine.split(/[:,]/).slice(1);
          if (meaningfulParts.length > 0) {
            meaningfulParts.forEach(part => {
              const trimmed = part.trim();
              if (trimmed.length > 5 && trimmed.length < 150) {
                fixes.push(trimmed);
              }
            });
          }
          
          // Last resort: use a cleaned version of the first line
          if (fixes.length === 0) {
            const cleaned = msgFirstLine.replace(/^(fix|fixes?|fixing?)\s*:?\s*/i, '').trim();
            if (cleaned && cleaned.length > 10) {
              fixes.push(cleaned);
            }
          }
        }
        
        changesSummary.fixed.push({
          commit: msgFirstLine,
          fixes: [...new Set(fixes)] // Remove duplicates
        });
      }
      
      // Categorize other changes
      if (msg.includes('add') || msg.includes('implement') || msg.includes('create') || msg.includes('introduce')) {
        changesSummary.added.push(msgFirstLine);
        if (msg.includes('ui') || msg.includes('view') || msg.includes('component') || msg.includes('button') || msg.includes('navigation') || msg.includes('toast') || msg.includes('notification')) {
          changesSummary.userFacing.push(msgFirstLine);
        }
      }
      if (msg.includes('remove') || msg.includes('delete') || msg.includes('drop')) {
        changesSummary.removed.push(msgFirstLine);
      }
      if (msg.includes('update') || msg.includes('modify') || msg.includes('change') || msg.includes('improve') || msg.includes('refactor') || msg.includes('enhance')) {
        changesSummary.changed.push(msgFirstLine);
        if (msg.includes('ui') || msg.includes('view') || msg.includes('component') || msg.includes('button') || msg.includes('navigation') || msg.includes('visible') || msg.includes('toast') || msg.includes('notification') || msg.includes('flow')) {
          changesSummary.userFacing.push(msgFirstLine);
        }
      }
    });
    
    newCommitsContext = '\n\n## 🔄 ' + (isUpdate ? 'COMPREHENSIVE ANALYSIS UPDATE - NEW COMMITS DETECTED' : 'COMPLETE PR ANALYSIS - ALL COMMITS') + ':\n\n';
    
    if (isUpdate) {
      newCommitsContext += `**⚠️ CRITICAL UPDATE: ${newCommits.length} new commit(s) have been added since the last analysis.**\n\n`;
      newCommitsContext += `**You MUST regenerate a COMPLETE analysis considering ALL commits (previous + new) as a unified set of changes.**\n\n`;
    } else {
      newCommitsContext += `**This PR contains ${newCommits.length} commit(s). Analyze ALL of them together as a cohesive change set.**\n\n`;
    }
    
    // Build comprehensive change summary
    newCommitsContext += `### 📊 COMPREHENSIVE CHANGE SUMMARY (All Commits Combined):\n\n`;
    
    if (changesSummary.added.length > 0) {
      newCommitsContext += `**✅ ADDED/NEW Features:**\n`;
      changesSummary.added.forEach(msg => {
        newCommitsContext += `- ${msg}\n`;
      });
      newCommitsContext += `\n`;
    }
    
    if (changesSummary.removed.length > 0) {
      newCommitsContext += `**❌ REMOVED/DELETED Features (VERIFY they are actually removed/not present):**\n`;
      changesSummary.removed.forEach(msg => {
        newCommitsContext += `- ${msg}\n`;
      });
      newCommitsContext += `\n`;
    }
    
    if (changesSummary.fixed.length > 0) {
      newCommitsContext += `**🔧 FIXED Issues/Bugs (CRITICAL - MUST test each fix with specific test cases):**\n`;
      changesSummary.fixed.forEach((fixObj, idx) => {
        newCommitsContext += `- **Fix ${idx + 1} - Commit:** ${fixObj.commit}\n`;
        newCommitsContext += `  - **Specific Issues Fixed:**\n`;
        fixObj.fixes.forEach(fix => {
          newCommitsContext += `    - "${fix}"\n`;
        });
        newCommitsContext += `  - **REQUIRED TEST CASE:** Generate a test case that:\n`;
        newCommitsContext += `    - Directly tests this fix (e.g., if fix says "prevent flicker", test that flicker doesn't occur)\n`;
        newCommitsContext += `    - Includes specific expected results (exact UI states, messages, behaviors)\n`;
        newCommitsContext += `    - Covers the scenario where the fix was needed\n`;
        newCommitsContext += `    - Tests edge cases related to this fix\n`;
      });
      newCommitsContext += `\n`;
    }
    
    if (changesSummary.changed.length > 0) {
      newCommitsContext += `**🔄 CHANGED/UPDATED Features:**\n`;
      changesSummary.changed.forEach(msg => {
        newCommitsContext += `- ${msg}\n`;
      });
      newCommitsContext += `\n`;
    }
    
    if (changesSummary.userFacing.length > 0) {
      newCommitsContext += `**👤 USER-FACING Changes (PRIORITY for testing):**\n`;
      changesSummary.userFacing.forEach(msg => {
        newCommitsContext += `- ${msg}\n`;
      });
      newCommitsContext += `\n`;
    }
    
    newCommitsContext += `---\n\n### 📝 COMMIT HISTORY (Chronological Order - Oldest First):\n\n`;
    
    // Show commits in chronological order with key details
    chronologicalCommits.forEach((commit, index) => {
      const commitNum = index + 1;
      const msgFirstLine = commit.message.split('\n')[0];
      const msgLower = commit.message.toLowerCase();
      
      newCommitsContext += `**Commit ${commitNum}/${chronologicalCommits.length}: \`${commit.sha.substring(0, 7)}\`**\n`;
      newCommitsContext += `- **Message:** ${commit.message}\n`;
      newCommitsContext += `- **Author:** ${commit.author || 'Unknown'}\n`;
      newCommitsContext += `- **Date:** ${commit.date || 'Unknown'}\n`;
      
      // Extract and highlight specific fixes/issues from commit message
      if (msgLower.includes('fix') || msgLower.includes('bug') || msgLower.includes('issue')) {
        // Parse what was fixed
        const fixDetails = [];
        const fullMsgLower = commit.message.toLowerCase();
        
        // Extract specific fix descriptions
        if (fullMsgLower.includes('prevent')) {
          const preventMatch = commit.message.match(/prevent\s+([^,\.:]+)/i);
          if (preventMatch) fixDetails.push(`Prevents: ${preventMatch[1].trim()}`);
        }
        if (fullMsgLower.includes('remove')) {
          const removeMatch = commit.message.match(/remove\s+([^,\.:]+)/i);
          if (removeMatch) fixDetails.push(`Removes: ${removeMatch[1].trim()}`);
        }
        if (fullMsgLower.includes('handle')) {
          const handleMatch = commit.message.match(/handle\s+([^,\.:]+)/i);
          if (handleMatch) fixDetails.push(`Handles: ${handleMatch[1].trim()}`);
        }
        if (fullMsgLower.includes('fix')) {
          const fixMatch = commit.message.match(/fix\s+([^,\.:]+)/i);
          if (fixMatch && !fullMsgLower.includes('fix:')) fixDetails.push(`Fixes: ${fixMatch[1].trim()}`);
        }
        
        newCommitsContext += `- **🔧 FIX:** This commit fixes issues - MUST generate test cases that verify:\n`;
        if (fixDetails.length > 0) {
          fixDetails.forEach(detail => {
            newCommitsContext += `  - ✅ ${detail} - Test that this fix actually works\n`;
          });
        } else {
          newCommitsContext += `  - ✅ Test that the fix mentioned in the commit message actually works\n`;
          newCommitsContext += `  - ✅ Verify no regressions in related functionality\n`;
        }
      }
      
      if (msgLower.includes('remove') || msgLower.includes('delete')) {
        newCommitsContext += `- **⚠️ REMOVAL:** This commit removes functionality - VERIFY it's actually removed/not present\n`;
      }
      if (msgLower.includes('ui') || msgLower.includes('visible') || msgLower.includes('navigation') || msgLower.includes('component') || msgLower.includes('toast') || msgLower.includes('notification') || msgLower.includes('filter') || msgLower.includes('flow')) {
        newCommitsContext += `- **👤 USER-FACING:** This affects user-visible behavior - HIGH PRIORITY for testing\n`;
      }
      
      // Show key code changes (full diff if not too long, otherwise preview)
      // Prioritize showing changes relevant to the commit message
      let commitDiff = commit.diff;
      
      if (commitDiff && commitDiff.trim().length > 0) {
        // Try to find relevant parts of the diff based on commit message keywords
        const msgKeywords = commit.message.toLowerCase().split(/\s+/).filter(w => w.length > 4);
        let relevantDiff = commitDiff;
        
        // If diff is very long, try to extract relevant sections
        if (commitDiff.length > 2000) {
          const lines = commitDiff.split('\n');
          const relevantLines = [];
          let foundRelevant = false;
          
          // Look for lines that might match commit message keywords
          lines.forEach((line, idx) => {
            const lineLower = line.toLowerCase();
            const matchesKeyword = msgKeywords.some(keyword => lineLower.includes(keyword));
            if (matchesKeyword || (!foundRelevant && idx < 100)) {
              relevantLines.push(line);
              if (matchesKeyword) foundRelevant = true;
            } else if (foundRelevant && idx < 150) {
              // Include some context after finding relevant lines
              relevantLines.push(line);
            }
          });
          
          if (relevantLines.length > 50) {
            relevantDiff = relevantLines.slice(0, 100).join('\n') + `\n... [${commitDiff.length - relevantLines.join('\n').length} more chars in full PR diff]`;
          }
        }
        
        const maxDiffLength = 2000;
        const finalDiff = relevantDiff.length > maxDiffLength 
          ? relevantDiff.substring(0, maxDiffLength) + `\n... [${relevantDiff.length - maxDiffLength} more chars in full PR diff]`
          : relevantDiff;
        
        newCommitsContext += `- **Code Changes:**\n\`\`\`diff\n${finalDiff}\n\`\`\`\n`;
      }
      newCommitsContext += `\n`;
    });
    
    newCommitsContext += `---\n\n## 🎯 COMPREHENSIVE ANALYSIS REQUIREMENTS:\n\n`;
    newCommitsContext += `**You MUST analyze the ENTIRE PR considering ALL commits above, not just individual commits.**\n\n`;
    
    newCommitsContext += `### 1. Understanding the Full Change Set:\n`;
    newCommitsContext += `- Review the FULL PR diff below (represents the FINAL state after ALL commits)\n`;
    newCommitsContext += `- Understand how each commit builds upon previous ones\n`;
    newCommitsContext += `- Identify the EVOLUTION of changes (what was added, then modified, then fixed, then removed)\n`;
    newCommitsContext += `- Note what was REMOVED - verify it's actually gone (test that removed features don't appear)\n`;
    newCommitsContext += `- Note what was ADDED - verify it's present and working (test that new features appear and function)\n`;
    newCommitsContext += `\n`;
    
    newCommitsContext += `### 2. Test Case Generation Requirements (CRITICAL - Follow Exactly):\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**A. CODE ANALYSIS BEFORE TEST GENERATION (CRITICAL - DO THIS FIRST):**\n`;
    newCommitsContext += `Before writing ANY test cases, you MUST:\n`;
    newCommitsContext += `1. **Analyze the CODE DIFF deeply** to extract exact details:\n`;
    newCommitsContext += `   - Extract exact UI element names (buttons, filters, badges, toasts) as they appear in code\n`;
    newCommitsContext += `   - Extract exact function names, variable names, component names\n`;
    newCommitsContext += `   - Extract exact strings/messages used (toast text, button labels, error messages) - copy them exactly\n`;
    newCommitsContext += `   - Understand the exact flow/logic: what triggers what, when, and how\n`;
    newCommitsContext += `   - Identify state variables and how they change (filter state, selection state, shared status)\n`;
    newCommitsContext += `   - Identify conditional logic: when things appear/disappear, when filters switch, when toasts show\n`;
    newCommitsContext += `   - Extract visual indicators: badge names, colors, icons, borders, highlights as specified in code\n`;
    newCommitsContext += `2. **USE EXACT CODE DETAILS** in test cases - reference actual element names, messages, functions from the code\n`;
    newCommitsContext += `3. **MAP THE FLOW** by analyzing code: user action → function call → state change → UI update → notification\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**B. FIX-SPECIFIC TEST GENERATION (HIGHEST PRIORITY):**\n`;
    newCommitsContext += `For EACH DISTINCT fix mentioned in commit messages, generate a SEPARATE test case that:\n`;
    newCommitsContext += `- **Tests the specific fix directly** (e.g., if fix says "prevent flicker", test that flicker doesn't occur in that exact scenario)\n`;
    newCommitsContext += `- **Uses exact details from code** (exact button names, filter names, toast messages as they appear in code)\n`;
    newCommitsContext += `- **Includes extremely specific expected behaviors** extracted from code:\n`;
    newCommitsContext += `  - Exact UI states: "Filter 'Draft' is active", "Thought X is selected", "Badge 'Shared' visible"\n`;
    newCommitsContext += `  - Exact toast messages: Full text exactly as in code (e.g., "Marked as shared! ✔ LinkedIn")\n`;
    newCommitsContext += `  - Exact visual indicators: Badge names, colors, icons exactly as in code\n`;
    newCommitsContext += `  - Exact state transitions: "Filter switches from 'Draft' to 'All'", "Selection changes from X to Y"\n`;
    newCommitsContext += `  - What should NOT happen: "UI should NOT flicker", "Thought should NOT disappear", etc.\n`;
    newCommitsContext += `- **Covers the exact scenario where the fix was needed** (e.g., if fix was for "Mark as Shared" flow, test that specific flow with exact details)\n`;
    newCommitsContext += `- **Verifies edge cases related to the fix** (e.g., rapid actions, concurrent operations, boundary conditions)\n`;
    newCommitsContext += `- **ONE TEST CASE PER FIX**: Each distinct fix gets its own dedicated test case\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**C. TEST CASE SPECIFICITY REQUIREMENTS (USE EXACT CODE DETAILS):**\n`;
    newCommitsContext += `Each test case MUST include - extract all details from the CODE DIFF:\n`;
    newCommitsContext += `- **Setup/Initial State**: \n`;
    newCommitsContext += `  - Exact filter active (use exact filter name from code: "Draft", "Shared", "All", etc.)\n`;
    newCommitsContext += `  - Exact selection state (which item is selected, identifier from code)\n`;
    newCommitsContext += `  - Exact data state (item properties, shared status, platforms - as they appear in code)\n`;
    newCommitsContext += `  - Exact UI state (what badges/indicators are visible - use exact badge names from code)\n`;
    newCommitsContext += `- **Action**: \n`;
    newCommitsContext += `  - Exact button/link names as they appear in code (e.g., "Mark as Shared", "Mark as Draft")\n`;
    newCommitsContext += `  - Exact selection actions using terminology from code\n`;
    newCommitsContext += `- **Expected Result**: EXTREMELY DETAILED expected behaviors using EXACT details from code:\n`;
    newCommitsContext += `  - **Exact UI states** (use exact names from code):\n`;
    newCommitsContext += `    - Filter state: "Filter switches from 'Draft' to 'All'" (exact filter names from code)\n`;
    newCommitsContext += `    - Visibility: "Thought remains visible in the list" (specify which list/view)\n`;
    newCommitsContext += `    - Selection: "Thought remains selected" or "Another thought auto-selects" (exact behavior from code)\n`;
    newCommitsContext += `  - **Exact toast messages** (copy exactly from code):\n`;
    newCommitsContext += `    - Full text: "Toast notification appears with message: '[exact text from code]'"\n`;
    newCommitsContext += `    - Color/style: "Green toast notification" (if specified in code)\n`;
    newCommitsContext += `    - Icon: "Checkmark icon (✔)" (if specified in code)\n`;
    newCommitsContext += `    - Additional text: Include all text that appears in the toast (exact copy from code)\n`;
    newCommitsContext += `  - **Exact visual indicators** (use exact names from code):\n`;
    newCommitsContext += `    - Badges: "Badge 'Shared' appears" (exact badge name/label from code)\n`;
    newCommitsContext += `    - Highlights: "Thought highlighted with ring/border" (exact style if specified)\n`;
    newCommitsContext += `    - State indicators: Exact visual states as defined in code\n`;
    newCommitsContext += `  - **Exact state transitions** (be specific about from→to):\n`;
    newCommitsContext += `    - "Filter transitions from '[exact name]' to '[exact name]'"\n`;
    newCommitsContext += `    - "Thought shared status changes from [state A] to [state B]"\n`;
    newCommitsContext += `    - "Selection state changes from [item X] to [item Y]"\n`;
    newCommitsContext += `  - **Exact behaviors** (be specific):\n`;
    newCommitsContext += `    - "No UI flicker occurs during the action"\n`;
    newCommitsContext += `    - "Smooth transition without page reload"\n`;
    newCommitsContext += `    - "Thought scrolls into view if it moves position" (if applicable)\n`;
    newCommitsContext += `    - Toast auto-dismissal timing (if specified in code)\n`;
    newCommitsContext += `  - **What should NOT happen** (be explicit):\n`;
    newCommitsContext += `    - "UI should NOT flicker"\n`;
    newCommitsContext += `    - "Thought should NOT disappear from view unexpectedly"\n`;
    newCommitsContext += `    - "Filter should NOT switch unless explicitly triggered by the logic"\n`;
    newCommitsContext += `    - "No errors should appear in console"\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**C. COMPREHENSIVE COVERAGE:**\n`;
    newCommitsContext += `- **COVER ALL FIXES**: Generate test cases for EVERY fix mentioned in commit messages\n`;
    newCommitsContext += `- **COVER USER-FACING CHANGES**: Prioritize test cases for features users interact with\n`;
    newCommitsContext += `- **COVER NEW FEATURES**: Test all added functionality thoroughly\n`;
    newCommitsContext += `- **COVER REMOVALS**: Verify removed features are actually gone\n`;
    newCommitsContext += `- **COVER MODIFICATIONS**: Verify changed features still work\n`;
    newCommitsContext += `- **EDGE CASES**: Include important edge cases (multiple states, rapid actions, boundary conditions)\n`;
    newCommitsContext += `- **NEGATIVE TESTS**: Include negative tests (error conditions, invalid states, failure scenarios)\n`;
    newCommitsContext += `- **INTEGRATION**: Test complete user flows and how changes work together\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**D. TEST CASE COUNT AND PRIORITIZATION:**\n`;
    newCommitsContext += `- Generate **5-7 comprehensive test cases** total\n`;
    newCommitsContext += `- Prioritize: Fixes > User-facing changes > Edge cases > Negative tests\n`;
    newCommitsContext += `- Each test case should be detailed and actionable\n`;
    newCommitsContext += `- Focus on HIGH IMPACT scenarios users will encounter\n`;
    newCommitsContext += `\n`;
    
    newCommitsContext += `### 3. Test Priority Guidelines:\n`;
    newCommitsContext += `- **Happy Path (HIGH)**: Core user workflows that must work - include exact expected results\n`;
    newCommitsContext += `- **Critical Path (HIGH)**: Important functionality affecting UX - include specific UI states and behaviors\n`;
    newCommitsContext += `- **Edge Case (MEDIUM-HIGH)**: Important edge cases like rapid actions, multiple states, boundary conditions\n`;
    newCommitsContext += `- **Negative Tests (MEDIUM-HIGH)**: Error conditions, failure scenarios, invalid states\n`;
    newCommitsContext += `- **Regression (HIGH)**: Existing features that might be affected - verify no breakage\n`;
    newCommitsContext += `- **AVOID**: Obscure edge cases users won't encounter, theoretical scenarios\n`;
    newCommitsContext += `\n`;
    
    newCommitsContext += `### 4. What to Test (Specific Focus Areas):\n`;
    if (changesSummary.fixed.length > 0) {
      newCommitsContext += `- 🔧 **HIGHEST PRIORITY**: Test EVERY fix mentioned in commits with specific test cases:\n`;
      changesSummary.fixed.forEach(fixObj => {
        fixObj.fixes.forEach(fix => {
          newCommitsContext += `  - Generate test that verifies: "${fix}" is actually fixed\n`;
        });
      });
      newCommitsContext += `  - Include edge cases and negative tests for each fix\n`;
      newCommitsContext += `\n`;
    }
    if (changesSummary.added.length > 0) {
      newCommitsContext += `- ✅ All NEW features (verify presence, functionality, exact UI states)\n`;
    }
    if (changesSummary.removed.length > 0) {
      newCommitsContext += `- ❌ All REMOVED features (negative tests - verify absence)\n`;
    }
    if (changesSummary.changed.length > 0) {
      newCommitsContext += `- 🔄 All MODIFIED features (verify they work with exact expected behaviors)\n`;
    }
    if (changesSummary.userFacing.length > 0) {
      newCommitsContext += `- 👤 All USER-FACING changes (test with specific UI states, messages, behaviors)\n`;
    }
    newCommitsContext += `- 🔗 Integration flows (complete user journeys across all changes)\n`;
    newCommitsContext += `- ⚠️ Edge cases (rapid actions, concurrent operations, boundary conditions)\n`;
    newCommitsContext += `- ❌ Negative scenarios (error conditions, failure cases, invalid states)\n`;
    newCommitsContext += `\n`;
    
    newCommitsContext += `### 5. What NOT to Test:\n`;
    newCommitsContext += `- ❌ Low-priority edge cases that users won't encounter in normal usage\n`;
    newCommitsContext += `- ❌ Theoretical scenarios not based on actual code changes\n`;
    newCommitsContext += `\n`;
    
    newCommitsContext += `### 6. Final Analysis Approach:\n`;
    newCommitsContext += `- Analyze the FULL PR diff (final state after all commits)\n`;
    newCommitsContext += `- Consider the COMPLETE change journey (all commits together)\n`;
    newCommitsContext += `- **Generate exactly 5-7 comprehensive test cases** (prioritize fixes and user-facing changes)\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**MANDATORY TEST CASE REQUIREMENTS (EXTRACT FROM CODE):**\n`;
    newCommitsContext += `1. **CODE ANALYSIS FIRST**: Analyze CODE DIFF to extract exact UI elements, functions, messages, state variables, flow logic\n`;
    newCommitsContext += `2. **Fix Verification**: For EACH DISTINCT fix in commit messages, generate a SEPARATE test case that directly verifies it works\n`;
    newCommitsContext += `3. **Extremely Specific Expected Results** - MUST use exact details from code:\n`;
    newCommitsContext += `   - **Exact UI states** (use exact names from code):\n`;
    newCommitsContext += `     - Filter: "Filter 'Draft' is active" → "Filter switches to 'All'" (use exact filter names)\n`;
    newCommitsContext += `     - Selection: "Thought X is selected" → "Thought remains selected" (use exact selection logic from code)\n`;
    newCommitsContext += `     - Visibility: "Thought remains visible in '[view name]'" (use exact view/list names)\n`;
    newCommitsContext += `     - Badges: "Badge '[exact badge name]' appears/disappears" (use exact badge names/labels from code)\n`;
    newCommitsContext += `   - **Exact toast messages** (copy exactly from code):\n`;
    newCommitsContext += `     - Full text: "Toast notification appears with message: '[exact text from code]'"\n`;
    newCommitsContext += `     - Include all text: Primary message, secondary message, platform name, etc.\n`;
    newCommitsContext += `     - Style: Color, icon if specified in code (e.g., "Green toast with checkmark icon")\n`;
    newCommitsContext += `   - **Exact visual indicators** (use exact names from code):\n`;
    newCommitsContext += `     - Badges: Exact badge names/labels as they appear in code\n`;
    newCommitsContext += `     - Highlights: Exact highlight styles (ring, border, background color) as specified\n`;
    newCommitsContext += `     - Icons: Exact icon names/symbols as used in code\n`;
    newCommitsContext += `   - **Exact state transitions** (be specific about from→to using exact names):\n`;
    newCommitsContext += `     - "Filter transitions from '[exact name]' to '[exact name]'"\n`;
    newCommitsContext += `     - "Thought shared status changes from [state A] to [state B]"\n`;
    newCommitsContext += `     - "Selection changes from [item X] to [item Y]"\n`;
    newCommitsContext += `   - **Exact behaviors** (be specific):\n`;
    newCommitsContext += `     - "No UI flicker occurs during the action" (verify this for flicker fixes)\n`;
    newCommitsContext += `     - "Smooth transition without page reload"\n`;
    newCommitsContext += `     - "Auto-scrolls into view if needed" (if applicable)\n`;
    newCommitsContext += `   - **What should NOT happen** (be explicit):\n`;
    newCommitsContext += `     - "UI should NOT flicker" (critical for flicker fixes)\n`;
    newCommitsContext += `     - "Thought should NOT disappear from view unexpectedly" (critical for visibility fixes)\n`;
    newCommitsContext += `     - "Filter should NOT switch unless explicitly triggered"\n`;
    newCommitsContext += `     - "No errors in console"\n`;
    newCommitsContext += `4. **Edge Cases**: Include important edge cases (rapid actions, multiple states, concurrent operations, boundary conditions)\n`;
    newCommitsContext += `5. **Negative Tests**: Include negative test cases (error conditions, failure scenarios, invalid states, things that should NOT happen)\n`;
    newCommitsContext += `6. **Complete Flows**: Test full user journeys from start to finish using exact flow from code\n`;
    newCommitsContext += `7. **One Test Case Per Fix**: Each distinct fix should get its own dedicated test case\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `**Test Case Format:**\n`;
    newCommitsContext += `- **Scenario**: Clear, descriptive name (e.g., "Mark as Shared from Draft Filter", "Rapid Toggle Mark/Unmark")\n`;
    newCommitsContext += `- **Steps**: Detailed numbered steps with:\n`;
    newCommitsContext += `  - Setup: Initial state (filter selected, thought selected, data state)\n`;
    newCommitsContext += `  - Action: Specific user actions (click "Mark as Shared", select platform, etc.)\n`;
    newCommitsContext += `- **Expected Result**: Comprehensive list of exact expected behaviors (use the examples above as format)\n`;
    newCommitsContext += `- **Priority**: Based on impact (Critical Path/Happy Path/Edge Case/Negative Test/Regression)\n`;
    newCommitsContext += `\n`;
    newCommitsContext += `- Focus on USER-FACING and HIGH-IMPACT scenarios\n`;
    newCommitsContext += `- Base test cases on actual code changes and commit messages, not assumptions\n`;
    newCommitsContext += `- Never use generic descriptions like "works correctly" - be specific about UI states, messages, behaviors\n`;
    newCommitsContext += `\n`;
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
      newCommits: newCommits.length > 0 ? newCommits : undefined
    });
    if (aiInsights && aiInsights.success) {
      console.log('✅ FirstQA Ovi AI analysis completed successfully');
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
  
  // Add header mentioning new commits if any
  if (newCommits.length > 0) {
    const isUpdate = lastAnalyzedSHA !== null;
    acknowledgmentComment += `## 🔄 ${isUpdate ? 'Analysis Update - New Commits Detected' : 'Complete PR Analysis'}\n\n`;
    
    if (isUpdate) {
      acknowledgmentComment += `✅ **${newCommits.length} new commit(s)** added since last review:\n\n`;
    } else {
      acknowledgmentComment += `✅ Analyzing **${newCommits.length} commit(s)** in this PR:\n\n`;
    }
    
    // Show commits in reverse chronological order (newest first)
    newCommits.forEach((commit, index) => {
      const commitMessage = commit.message.split('\n')[0];
      acknowledgmentComment += `${index + 1}. \`${commit.sha.substring(0, 7)}\` - ${commitMessage}\n`;
    });
    acknowledgmentComment += `\n---\n\n`;
  }
  
  // Add AI insights to the comment if they were generated successfully
  if (aiInsights && aiInsights.success) {
    // Debug logging to see what we're getting
    console.log('🔍 AI Insights Debug:');
    console.log('AI Insights success:', aiInsights.success);
    console.log('AI Insights data type:', typeof aiInsights.data);
    console.log('AI Insights data length:', aiInsights.data ? aiInsights.data.length : 'undefined');
    console.log('AI Insights data preview:', aiInsights.data ? JSON.stringify(aiInsights.data).substring(0, 200) + '...' : 'undefined');
    // Use the same hybrid formatting as the automatic PR analysis
    acknowledgmentComment += formatHybridAnalysisForComment(aiInsights);
  } else if (aiInsights && !aiInsights.success) {
    acknowledgmentComment += `
*Note: Ovi QA Agent insights could not be generated for this PR (${aiInsights.error}), but manual testing will proceed as normal.*
    `;
  }
  const commentResult = await postComment(repository.full_name, issue.number, acknowledgmentComment);
  console.log(`✅ Acknowledgment comment ${commentResult.simulated ? 'would be' : 'was'} posted`);
  // Add "Reviewed by Ovi" label after AI analysis is complete
  const labelResult = await addOviReviewedLabel(repository.full_name, issue.number);
  console.log(`✅ "Reviewed by Ovi" label ${labelResult.simulated ? 'would be' : 'was'} added`);
  
  // AUTOMATED TESTING: Check if we should run automated tests
  console.log('\n' + '='.repeat(60));
  console.log('🚀 AUTOMATED TESTING SECTION REACHED!');
  console.log('='.repeat(60) + '\n');
  
  try {
    const { shouldRunAutomatedTests, executeAutomatedTests } = require('../services/automatedTestOrchestrator');
    
    // Fetch PR details to get the SHA
    const [owner, repo] = repository.full_name.split('/');
    console.log(`🔍 Fetching PR details for automated testing: ${owner}/${repo}#${issue.number}`);
    
    let prDetails = null;
    try {
      const prUrl = `https://api.github.com/repos/${repository.full_name}/pulls/${issue.number}`;
      const prResponse = await axios.get(prUrl, {
        headers: {
          'Authorization': `token ${process.env.GITHUB_TOKEN || ''}`,
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'FirstQA'
        }
      });
      prDetails = prResponse.data;
      console.log(`✅ Fetched PR SHA: ${prDetails.head.sha}`);
    } catch (fetchError) {
      console.error(`❌ Error fetching PR details:`, fetchError.message);
    }
    
    if (!prDetails) {
      console.log('⚠️  Could not fetch PR details, skipping automated tests');
      // Continue without automated tests
    } else {
      // Build a minimal PR object for shouldRunAutomatedTests
      const prObject = {
        number: issue.number,
        labels: issue.labels || [],
        head: { sha: prDetails.head.sha }
      };
      
      // Debug: Log what we're checking
      console.log('🔍 Checking if automated tests should run:');
      console.log(`   - TEST_AUTOMATION_ENABLED: ${process.env.TEST_AUTOMATION_ENABLED}`);
      console.log(`   - TEST_AUTOMATION_BASE_URL: ${process.env.TEST_AUTOMATION_BASE_URL}`);
      console.log(`   - aiInsights.success: ${aiInsights?.success}`);
      console.log(`   - aiInsights.data type: ${typeof aiInsights?.data}`);
      console.log(`   - testRecipe exists: ${!!aiInsights?.data?.testRecipe}`);
      console.log(`   - testRecipe length: ${aiInsights?.data?.testRecipe?.length || 0}`);
      
      if (shouldRunAutomatedTests(prObject, aiInsights)) {
        console.log('🤖 Automated testing enabled - executing tests...');
        
        // Execute automated tests asynchronously (don't wait for completion)
        executeAutomatedTests({
          owner,
          repo,
          prNumber: issue.number,
          sha: prDetails.head.sha,
          testRecipe: aiInsights?.data?.testRecipe || [],
          baseUrl: process.env.TEST_AUTOMATION_BASE_URL,
          installationId: repository.installation?.id || null
        }).catch(error => {
          console.error('❌ Automated test execution failed:', error.message);
        });
        
        console.log('✅ Automated tests triggered (running in background)');
      } else {
        console.log('⏭️  Automated testing not triggered (conditions not met)');
        console.log('   Check the logs above to see which condition failed');
      }
    }
  } catch (error) {
    console.error('❌ Error checking automated testing:', error.message);
  }
  
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
  const commentResult = await postComment(repository.full_name, issue.number, acknowledgmentComment);
  console.log(`✅ Acknowledgment comment ${commentResult.simulated ? 'would be' : 'was'} posted`);
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
/**
 * Format hybrid analysis for GitHub comment (shared by /qa and automatic PR analysis)
 */
function formatHybridAnalysisForComment(aiInsights) {
  const aiData = aiInsights.data;

  // Check if we have the new AI prompt format
  if (typeof aiData === 'string' && (
    aiData.includes('📊 Release Pulse') ||
    aiData.includes('🎯 QA Analysis - by Ovi (the AI QA)')
  )) {
    console.log('🔍 Detected new AI prompt format');
    console.log('Contains Release Pulse:', aiData.includes('📊 Release Pulse'));
    console.log('Full AI Response:', aiData);
    
    // New AI prompt format - just add FirstQA branding around it
    // Clean up any potential formatting issues that GitHub might not like
    const cleanedData = aiData
      .replace(/\n{3,}/g, '\n\n')  // Remove excessive blank lines
      .replace(/\t/g, '\n')    // Convert tabs to newlines for better GitHub compatibility
      .trim();                  // Remove extra whitespace
    
    const finalComment = `${cleanedData}

---

*🤖 **With Quality By Ovi** - AI-powered QA analysis by FirstQA*

💡 Need a human tester to help? [FirstQA.dev](https://firstqa.dev) - Professional QA testing for your releases.`;
    
    // Debug the final comment that will be posted
    console.log('🔍 Final Comment Debug:');
    console.log('Final comment length:', finalComment.length);
    console.log('Final comment preview:', finalComment.substring(0, 500) + '...');
    console.log('Final comment end:', finalComment.substring(finalComment.length - 200));
    
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

💡 Need a human tester to help? [FirstQA.dev](https://firstqa.dev) - Professional QA testing for your releases.*`;
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
  const analysisResult = await formatAndPostDetailedAnalysis(repository.full_name, pr.number, aiInsights);
  
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
    // Handle pull_request event - NO automatic analysis on PR open
    // Analysis is triggered ONLY via /qa comment command
    if (eventType === 'pull_request' && payload.action === 'opened') {
      const { repository, pull_request: pr } = payload;
      console.log(`📋 PR #${pr?.number} opened on ${repository?.full_name} - waiting for /qa command to trigger analysis`);
      return { success: true, message: 'PR opened - use /qa command to trigger analysis' };
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
      if (sender.type === 'Bot' || sender.login.includes('bot') || comment.body.includes('🤖 Ovi QA Assistant')) {
        console.log(`Skipping bot comment from ${sender.login}`);
        return { success: true, message: 'Skipped bot comment' };
      }
      console.log(`Comment body: ${comment.body}`);
      // Check for /qa command (manual QA re-run)
      if (comment.body.trim().startsWith('/qa')) {
        console.log('🧪 /qa command detected!');
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
  formatShortAnalysisForComment
};