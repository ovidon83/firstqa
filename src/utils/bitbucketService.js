/**
 * Bitbucket Service for webhook processing
 * Implements functionality for handling /qa commands on Bitbucket PRs
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Ensure data directory exists (same as GitHub service)
const homeDir = process.env.HOME || process.env.USERPROFILE;
let dataDir = process.env.DATA_DIR || path.join(homeDir, '.firstqa', 'data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    console.log(`Created data directory at ${dataDir}`);
  } catch (error) {
    console.error(`Failed to create data directory at ${dataDir}:`, error.message);
    dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
      console.log(`Created fallback data directory at ${dataDir}`);
    }
  }
}

// Path to test requests storage (shared with GitHub)
const TEST_REQUESTS_PATH = path.join(dataDir, 'test-requests.json');
const DATA_RETENTION_DAYS = process.env.DATA_RETENTION_DAYS ? parseInt(process.env.DATA_RETENTION_DAYS) : 14;

// Bitbucket API base URL
const BITBUCKET_API_BASE = 'https://api.bitbucket.org/2.0';

const bitbucketAppAuth = require('./bitbucketAppAuth');

/**
 * Extract workspace from repository string
 */
function extractWorkspace(repository) {
  const parts = repository.split('/');
  return parts[0];
}

/**
 * Make authenticated request to Bitbucket API using OAuth token
 */
async function bitbucketRequest(method, endpoint, workspaceSlug, data = null) {
  try {
    // Get authenticated config for this workspace
    const authConfig = await bitbucketAppAuth.getAuthenticatedConfig(workspaceSlug);
    
    const url = `${BITBUCKET_API_BASE}${endpoint}`;
    const config = {
      method,
      url,
      ...authConfig
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    // If 401, try refreshing token
    if (error.response?.status === 401) {
      console.log(`⚠️ Token expired for ${workspaceSlug}, attempting refresh...`);
      try {
        await bitbucketAppAuth.getAccessToken(workspaceSlug, true); // Force refresh
        const authConfig = await bitbucketAppAuth.getAuthenticatedConfig(workspaceSlug);
        const url = `${BITBUCKET_API_BASE}${endpoint}`;
        const config = { method, url, ...authConfig };
        if (data) config.data = data;
        const response = await axios(config);
        return response.data;
      } catch (refreshError) {
        console.error(`Failed to refresh token for ${workspaceSlug}:`, refreshError.message);
        throw error;
      }
    }
    console.error(`Bitbucket API error (${method} ${endpoint}):`, error.response?.status, error.response?.statusText, error.message);
    throw error;
  }
}

/**
 * Load test requests from storage (shared with GitHub)
 */
function loadTestRequests() {
  try {
    if (!fs.existsSync(TEST_REQUESTS_PATH)) {
      return [];
    }
    const data = fs.readFileSync(TEST_REQUESTS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading test requests:', error.message);
    return [];
  }
}

/**
 * Save test requests to storage
 */
function saveTestRequests(testRequests) {
  try {
    // Filter out old requests (older than retention period)
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DATA_RETENTION_DAYS);
    const filteredRequests = testRequests.filter(req => {
      const requestDate = new Date(req.requestedAt);
      return requestDate >= cutoffDate;
    });

    fs.writeFileSync(TEST_REQUESTS_PATH, JSON.stringify(filteredRequests, null, 2));
    console.log(`Saved ${filteredRequests.length} test requests (removed ${testRequests.length - filteredRequests.length} old requests)`);
  } catch (error) {
    console.error('Error saving test requests:', error.message);
  }
}

/**
 * Get the last analyzed commit SHA for a PR
 */
function getLastAnalyzedCommitSHA(repository, prId) {
  try {
    const testRequests = loadTestRequests();
    const prRequests = testRequests
      .filter(req => req.repository === repository && req.prNumber === prId)
      .filter(req => req.lastAnalyzedCommitSHA)
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
    
    if (prRequests.length > 0) {
      return prRequests[0].lastAnalyzedCommitSHA;
    }
    return null;
  } catch (error) {
    console.error(`Error getting last analyzed commit SHA for ${repository}#${prId}:`, error.message);
    return null;
  }
}

/**
 * Fetch PR description from Bitbucket
 */
async function fetchPRDescription(workspace, repoSlug, prId) {
  try {
    const pr = await bitbucketRequest('GET', `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}`, workspace);
    return pr.description || 'No description provided';
  } catch (error) {
    console.error(`Failed to fetch PR description for ${workspace}/${repoSlug}#${prId}:`, error.message);
    return `Error fetching PR description: ${error.message}`;
  }
}

/**
 * Fetch PR diff from Bitbucket
 */
async function fetchPRDiff(workspace, repoSlug, prId) {
  try {
    const diff = await bitbucketRequest('GET', `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/diff`, workspace);
    // Bitbucket returns diff as plain text
    return diff || 'No code changes detected';
  } catch (error) {
    console.error(`Failed to fetch PR diff for ${workspace}/${repoSlug}#${prId}:`, error.message);
    return 'Error fetching PR diff';
  }
}

/**
 * Fetch commits for a PR
 */
async function fetchPRCommits(workspace, repoSlug, prId) {
  try {
    const commits = await bitbucketRequest('GET', `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/commits`, workspace);
    return commits.values || [];
  } catch (error) {
    console.error(`Failed to fetch PR commits for ${workspace}/${repoSlug}#${prId}:`, error.message);
    return [];
  }
}

/**
 * Fetch commit details
 */
async function fetchCommitDetails(workspace, repoSlug, commitHash) {
  try {
    const commit = await bitbucketRequest('GET', `/repositories/${workspace}/${repoSlug}/commit/${commitHash}`, workspace);
    const diff = await bitbucketRequest('GET', `/repositories/${workspace}/${repoSlug}/diff/${commitHash}`, workspace);
    
    return {
      sha: commitHash,
      message: commit.message || '',
      author: commit.author?.raw || 'Unknown',
      date: commit.date || '',
      diff: diff || ''
    };
  } catch (error) {
    console.error(`Failed to fetch commit details for ${commitHash}:`, error.message);
    return {
      sha: commitHash,
      message: 'Error fetching commit',
      author: 'Unknown',
      date: '',
      diff: ''
    };
  }
}

/**
 * Post comment on Bitbucket PR
 */
async function postComment(workspace, repoSlug, prId, body) {
  try {
    console.log(`📝 Posting comment to ${workspace}/${repoSlug}#${prId}`);
    console.log(`📝 Comment length: ${body.length} chars`);
    
    // Bitbucket API expects just content.raw (no markup field)
    const comment = await bitbucketRequest('POST', `/repositories/${workspace}/${repoSlug}/pullrequests/${prId}/comments`, workspace, {
      content: {
        raw: body
      }
    });
    console.log(`✅ Comment posted successfully, id: ${comment.id}`);
    return { success: true, commentId: comment.id };
  } catch (error) {
    console.error(`❌ Failed to post comment:`, error.message);
    if (error.response?.data) {
      console.error(`❌ Bitbucket error details:`, JSON.stringify(error.response.data));
    }
    return { success: false, error: error.message };
  }
}

/**
 * Call AI analysis endpoint (same as GitHub)
 */
async function callTestRecipeEndpoint(data) {
  try {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const response = await axios.post(`${baseUrl}/generate-test-recipe`, data, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 60000
    });
    if (response.data && response.data.success) {
      return response.data;
    }
    throw new Error(response.data?.error || 'AI analysis failed');
  } catch (error) {
    console.error('❌ Error calling AI endpoint:', error.message);
    const { generateQAInsights } = require('../../ai/openaiClient');
    try {
      return await generateQAInsights(data);
    } catch (fallbackError) {
      console.error('❌ Fallback also failed:', fallbackError.message);
      return {
        success: true,
        data: { error: 'Analysis failed', message: fallbackError.message }
      };
    }
  }
}

/**
 * Format and post analysis to PR
 */
async function formatAndPostDetailedAnalysis(workspace, repoSlug, prId, aiInsights) {
  try {
    if (!aiInsights || !aiInsights.success) {
      const errorMsg = aiInsights?.error || 'Analysis failed';
      await postComment(workspace, repoSlug, prId, `❌ **Analysis Error**\n\n${errorMsg}`);
      return { success: false, error: errorMsg };
    }

    const analysis = aiInsights.data;
    
    // If the AI returned markdown directly (string), post it as-is
    if (typeof analysis === 'string') {
      console.log('📝 Posting AI markdown response directly');
      return await postComment(workspace, repoSlug, prId, analysis);
    }

    // Otherwise, format the structured response
    let commentBody = '# 🎯 QA Analysis - by Ovi (the AI QA)\n\n';

    // Add Release Pulse if available
    if (analysis.releasePulse) {
      commentBody += '## 🧪 Release Pulse\n\n';
      commentBody += `**Release Confidence:** ${analysis.releasePulse.confidence || 'N/A'}\n`;
      commentBody += `**Change Impact:** ${analysis.releasePulse.impact || 'N/A'}\n`;
      commentBody += `**Release Decision:** ${analysis.releasePulse.decision || 'N/A'}\n\n`;
    }

    // Add test recipe
    if (analysis.testRecipe) {
      commentBody += '## 🧪 Test Recipe\n\n';
      if (analysis.testRecipe.length) {
        analysis.testRecipe.forEach((test, idx) => {
          commentBody += `### ${idx + 1}. ${test.scenario || 'Test Scenario'}\n`;
          commentBody += `**Steps:** ${test.steps || 'N/A'}\n`;
          commentBody += `**Expected Result:** ${test.expectedResult || 'N/A'}\n`;
          commentBody += `**Priority:** ${test.priority || 'N/A'}\n\n`;
        });
      }
    }

    // Add code review
    if (analysis.codeReview && analysis.codeReview.length) {
      commentBody += '## 🔍 Code Review\n\n';
      analysis.codeReview.forEach(item => {
        commentBody += `- ${item}\n`;
      });
      commentBody += '\n';
    }

    // Add risks
    if (analysis.risks && analysis.risks.length) {
      commentBody += '## ⚠️ Risks\n\n';
      analysis.risks.forEach(risk => {
        commentBody += `- ${risk}\n`;
      });
      commentBody += '\n';
    }

    // Add bugs
    if (analysis.bugs && analysis.bugs.length) {
      commentBody += '## 🐛 Bugs\n\n';
      analysis.bugs.forEach(bug => {
        commentBody += `- ${bug}\n`;
      });
      commentBody += '\n';
    }

    commentBody += '---\n\n*With Quality By Ovi - AI-powered QA analysis by FirstQA*';

    return await postComment(workspace, repoSlug, prId, commentBody);
  } catch (error) {
    console.error('Error formatting and posting analysis:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Handle test request (/qa command)
 */
async function handleTestRequest(workspace, repoSlug, prId, comment, sender) {
  try {
    console.log(`🧪 Processing /qa request for ${workspace}/${repoSlug}#${prId}`);

    // Get PR details
    const prDescription = await fetchPRDescription(workspace, repoSlug, prId);
    const prDiff = await fetchPRDiff(workspace, repoSlug, prId);
    
    // Get commits
    const commits = await fetchPRCommits(workspace, repoSlug, prId);
    const lastAnalyzedSHA = getLastAnalyzedCommitSHA(`${workspace}/${repoSlug}`, prId);
    
    // Fetch commit details if needed
    let newCommits = [];
    if (commits.length > 0) {
      newCommits = await Promise.all(
        commits
          .filter(c => !lastAnalyzedSHA || c.hash !== lastAnalyzedSHA)
          .map(c => fetchCommitDetails(workspace, repoSlug, c.hash))
      );
    }

    // Call AI analysis
    const aiInsights = await callTestRecipeEndpoint({
      repo: `${workspace}/${repoSlug}`,
      pr_number: prId,
      title: `PR #${prId}`,
      body: prDescription,
      diff: prDiff,
      newCommits: newCommits
    });

    // Post analysis
    const result = await formatAndPostDetailedAnalysis(workspace, repoSlug, prId, aiInsights);

    // Save test request
    const testRequests = loadTestRequests();
    testRequests.push({
      id: `bitbucket-${Date.now()}`,
      repository: `${workspace}/${repoSlug}`,
      prNumber: prId,
      requestedBy: sender.display_name || sender.username,
      requestedAt: new Date().toISOString(),
      status: 'completed',
      prDescription,
      comment: comment.content?.raw || comment.body,
      lastAnalyzedCommitSHA: commits.length > 0 ? commits[commits.length - 1].hash : null,
      newCommitsAnalyzed: newCommits.length,
      platform: 'bitbucket'
    });
    saveTestRequests(testRequests);

    return result;
  } catch (error) {
    console.error('Error handling test request:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Process Bitbucket webhook event
 */
async function processWebhookEvent(event) {
  try {
    const eventType = event.headers['x-event-key'] || event.body?.event || 'unknown';
    const payload = event.body;
    
    console.log('📣 Processing Bitbucket webhook event:', eventType);

    // Handle PR comment created
    if (eventType === 'pullrequest:comment_created') {
      const { pullrequest, comment, actor } = payload;
      if (!pullrequest || !comment || !actor) {
        return { success: false, message: 'Missing required properties in payload' };
      }

      // Skip bot comments
      if (actor.type === 'app' || comment.content?.raw?.includes('🤖 Ovi QA Assistant')) {
        console.log('Skipping bot comment');
        return { success: true, message: 'Skipped bot comment' };
      }

      const commentBody = comment.content?.raw || comment.body || '';
      
      // Check for /qa command
      if (commentBody.trim().startsWith('/qa')) {
        console.log('🧪 /qa command detected!');
        
        // Debug: Log payload structure to understand Bitbucket's format
        console.log('📦 Payload keys:', Object.keys(payload));
        console.log('📦 PR destination repo:', JSON.stringify(pullrequest.destination?.repository, null, 2));
        if (payload.repository) {
          console.log('📦 Repository from payload:', JSON.stringify(payload.repository, null, 2));
        }
        
        // Extract workspace - try multiple paths (Bitbucket payload varies)
        const workspace = pullrequest.destination?.repository?.workspace?.slug ||
                         pullrequest.source?.repository?.workspace?.slug ||
                         payload.repository?.workspace?.slug ||
                         pullrequest.destination?.repository?.owner?.username ||
                         pullrequest.destination?.repository?.owner?.nickname ||
                         payload.repository?.owner?.username ||
                         payload.repository?.owner?.nickname ||
                         // Try extracting from full_name (format: "workspace/repo")
                         pullrequest.destination?.repository?.full_name?.split('/')[0] ||
                         payload.repository?.full_name?.split('/')[0];
        
        if (!workspace) {
          console.error('Could not determine workspace from webhook payload');
          console.error('Available paths tried - all undefined');
          return { success: false, message: 'Workspace not found in webhook payload' };
        }
        
        console.log(`✅ Found workspace: ${workspace}`);
        
        // Extract repo slug - try multiple paths
        const repoSlug = pullrequest.destination?.repository?.slug ||
                        pullrequest.source?.repository?.slug ||
                        payload.repository?.slug ||
                        pullrequest.destination?.repository?.name;
        const prId = pullrequest.id;
        
        console.log(`📋 Processing PR #${prId} in ${workspace}/${repoSlug}`);
        
        // Verify installation exists
        const installation = bitbucketAppAuth.getInstallation(workspace);
        if (!installation) {
          console.error(`No Bitbucket installation found for workspace: ${workspace}`);
          return { 
            success: false, 
            message: `FirstQA is not installed for this workspace. Please install at: ${process.env.BASE_URL || 'https://firstqa.dev'}/bitbucket/install` 
          };
        }
        
        return await handleTestRequest(workspace, repoSlug, prId, comment, actor);
      }
    }

    // Handle PR opened
    if (eventType === 'pullrequest:created') {
      console.log('🚀 New PR opened');
      // Could add auto-analysis here if needed
      return { success: true, message: 'PR opened event received' };
    }

    return { 
      success: true,
      message: `Event type ${eventType} received but not processed`
    };
  } catch (error) {
    console.error('❌ Error processing webhook event:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  processWebhookEvent,
  handleTestRequest,
  fetchPRDescription,
  fetchPRDiff,
  postComment
};

