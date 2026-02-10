/**
 * Linear Connect Service
 * Handles webhook processing and GraphQL API calls for Linear
 */

const axios = require('axios');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

// Linear GraphQL API endpoint
const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Deduplication: prevent duplicate analyses when Linear sends multiple webhooks for same comment
const recentlyProcessed = new Map();
const DEDUPE_TTL_MS = 120000; // 2 minutes

function markProcessed(issueId, commentId) {
  const key = `${issueId}:${commentId}`;
  recentlyProcessed.set(key, Date.now());
  // Clean old entries
  const now = Date.now();
  for (const [k, t] of recentlyProcessed.entries()) {
    if (now - t > DEDUPE_TTL_MS) recentlyProcessed.delete(k);
  }
}

function wasRecentlyProcessed(issueId, commentId) {
  const key = `${issueId}:${commentId}`;
  const t = recentlyProcessed.get(key);
  if (!t) return false;
  if (Date.now() - t > DEDUPE_TTL_MS) {
    recentlyProcessed.delete(key);
    return false;
  }
  return true;
}

/**
 * Verify Linear API key and get organization info
 */
async function verifyLinearApiKey(apiKey) {
  const query = `
    query {
      organization {
        id
        name
        urlKey
      }
      viewer {
        id
        name
        email
      }
    }
  `;

  // Normalize API key: remove Bearer prefix if present
  const token = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      { query },
      {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = String(token).slice(0, 6);
      console.error(`❌ Linear API verification failed (status: ${response.status || 'N/A'}, token: ${tokenPreview}...):`, response.data.errors);
      return null;
    }

    const org = response.data.data?.organization;
    const viewer = response.data.data?.viewer;

    if (!org || !org.id) {
      return null;
    }

    return {
      id: org.id,
      name: org.name,
      urlKey: org.urlKey,
      viewer: viewer ? { id: viewer.id, name: viewer.name, email: viewer.email } : null
    };
  } catch (error) {
    const tokenPreview = String(token).slice(0, 6);
    const status = error.response?.status || 'N/A';
    const graphqlErrors = error.response?.data?.errors || [];
    console.error(`❌ Failed to verify Linear API key (status: ${status}, token: ${tokenPreview}...):`, graphqlErrors.length > 0 ? graphqlErrors : error.message);
    return null;
  }
}

/**
 * Get Linear organization info (for use with stored API key)
 */
async function getLinearOrganization(apiKey) {
  return verifyLinearApiKey(apiKey);
}

/**
 * Process webhook from Linear
 */
async function processLinearWebhook(payload, installation) {
  try {
    console.log('📣 Processing Linear webhook');

    // Linear webhook payload structure can vary
    // Handle both direct payload and nested data structure
    let type, action, data;
    
    if (payload.type && payload.action && payload.data) {
      // Direct structure
      type = payload.type;
      action = payload.action;
      data = payload.data;
    } else if (payload.data?.type && payload.data?.action && payload.data?.data) {
      // Nested structure
      type = payload.data.type;
      action = payload.data.action;
      data = payload.data.data;
    } else {
      console.log('Unknown webhook payload structure:', Object.keys(payload));
      return { success: true, message: 'Unknown payload structure' };
    }

    // Only handle comment creation events
    const event = `${type}.${action}`;
    const isCommentCreate = 
      (type.toLowerCase().includes('comment') && action === 'create') ||
      event === 'Comment.create' ||
      event === 'IssueComment.create';
    
    if (!isCommentCreate) {
      console.log(`Skipping event: ${event}`);
      return { success: true, message: 'Event ignored' };
    }

    console.log(`✓ Comment create event detected: ${event}`);

    const commentData = data;
    console.log('Comment data keys:', Object.keys(commentData || {}));
    
    const commentId = commentData.id;
    const issueId =
      commentData.issueId ||
      commentData.issue?.id ||
      commentData.issue ||
      commentData.parent?.id;

    console.log(`Resolved issueId: ${issueId} (from commentId: ${commentId})`);

    if (!commentId || !issueId) {
      console.log('❌ Missing commentId or issueId in webhook payload');
      return { success: false, message: 'Invalid webhook payload' };
    }

    // Fetch full comment via GraphQL to get complete body
    const comment = await fetchLinearComment(commentId, installation);
    
    if (!comment) {
      console.error('❌ Failed to fetch comment from Linear API');
      return { success: false, message: 'Failed to fetch comment' };
    }

    // Early check: ignore bot comments (prevent infinite loop)
    const authorName = comment.user?.name || '';
    const isBot = authorName.includes('FirstQA') || authorName.includes('firstqa');
    
    console.log(`📩 Webhook: ${event} | Issue: ${issueId} | Author: ${authorName}${isBot ? ' [BOT]' : ''}`);
    
    if (isBot) {
      console.log('✓ Ignored bot comment (prevent loop)');
      return { success: true, message: 'Ignored bot comment' };
    }

    // Check for /qa command in fetched comment body
    const commentBody = extractTextFromComment(comment);
    if (!commentBody.includes('/qa')) {
      console.log('✓ No /qa command, skipping');
      return { success: true, message: 'Not a /qa command' };
    }

    console.log('🧪 /qa command detected! Processing analysis...');
    console.log(`✅ Event: ${event}, IssueId: ${issueId}, /qa detected`);
    console.log(`📝 Comment preview: "${commentBody.substring(0, 100)}..."`);

    // Dedupe: Linear may send duplicate webhooks for the same comment
    if (wasRecentlyProcessed(issueId, commentId)) {
      console.log('✓ Duplicate webhook ignored (recently processed)');
      return { success: true, message: 'Duplicate webhook ignored' };
    }
    markProcessed(issueId, commentId);

    // Fetch full issue details
    const issueDetails = await fetchIssueDetails(issueId, installation);

    // Defensive check
    if (!issueDetails || !issueDetails.title) {
      console.error('❌ Failed to fetch valid issue details');
      return { success: false, message: 'Failed to fetch issue details' };
    }

    // Generate AI analysis
    const { generateTicketInsights } = require('../../ai/openaiClient');
    const aiInsights = await generateTicketInsights({
      ticketId: issueDetails.identifier,
      title: issueDetails.title,
      description: issueDetails.description,
      comments: issueDetails.comments,
      labels: issueDetails.labels,
      platform: 'linear',
      priority: issueDetails.priority,
      type: issueDetails.type
    });

    if (!aiInsights || !aiInsights.success) {
      console.error('❌ AI analysis failed');
      return { success: false, message: 'AI analysis failed' };
    }

    console.log('✅ AI analysis completed');

    // Post analysis as comment
    const analysisComment = formatAnalysisComment(aiInsights.data);
    await postComment(issueId, analysisComment, installation);

    // Save analysis to database
    if (isSupabaseConfigured()) {
      await saveAnalysisToDatabase({
        installationId: installation.id,
        provider: 'linear',
        issueKey: issueDetails.identifier,
        issueTitle: issueDetails.title,
        issueUrl: issueDetails.url,
        analysisResult: aiInsights.data
      });
    }

    console.log('🎉 Linear issue analysis complete!');

    return {
      success: true,
      message: 'Analysis posted',
      issueId: issueId
    };

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Fetch Linear comment by ID using GraphQL
 */
async function fetchLinearComment(commentId, installation) {
  console.log(`🔍 Fetching Linear comment: ${commentId}`);

  const query = `
    query GetComment($id: String!) {
      comment(id: $id) {
        id
        body
        user {
          id
          name
          email
        }
        createdAt
        issue {
          id
        }
      }
    }
  `;

  // Normalize API key: remove Bearer prefix if present
  const token = String(installation.api_key || '').replace(/^Bearer\s+/i, '').trim();

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      {
        query,
        variables: { id: commentId }
      },
      {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = String(token).slice(0, 6);
      console.error(`❌ GraphQL errors (status: ${response.status || 'N/A'}, token: ${tokenPreview}...):`, response.data.errors);
      return null;
    }

    const comment = response.data.data?.comment;

    if (!comment) {
      console.error('❌ Comment not found');
      return null;
    }

    return comment;
  } catch (error) {
    const tokenPreview = String(token).slice(0, 6);
    const status = error.response?.status || 'N/A';
    const graphqlErrors = error.response?.data?.errors || [];
    console.error(`❌ Failed to fetch comment (status: ${status}, token: ${tokenPreview}...):`, graphqlErrors.length > 0 ? graphqlErrors : error.message);
    return null;
  }
}

/**
 * Extract plain text from Linear comment body
 * Linear comments can be in markdown format
 */
function extractTextFromComment(comment) {
  if (typeof comment.body === 'string') {
    return comment.body;
  }
  
  if (comment.bodyData && typeof comment.bodyData === 'string') {
    return comment.bodyData;
  }
  
  return '';
}

/**
 * Fetch issue details from Linear using GraphQL
 */
async function fetchIssueDetails(issueId, installation) {
  console.log(`🔍 Fetching Linear issue: ${issueId}`);

  const query = `
    query GetIssue($id: String!) {
      issue(id: $id) {
        id
        identifier
        title
        description
        priority
        state {
          name
        }
        assignee {
          name
        }
        creator {
          name
        }
        labels {
          nodes {
            name
          }
        }
        comments {
          nodes {
            id
            body
            user {
              name
            }
            createdAt
          }
        }
        team {
          key
        }
        url
      }
    }
  `;

  // Normalize API key: remove Bearer prefix if present
  const token = String(installation.api_key || '').replace(/^Bearer\s+/i, '').trim();

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      {
        query,
        variables: { id: issueId }
      },
      {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = token.substring(0, 6);
      console.error(`❌ GraphQL errors (status: ${response.status || 'N/A'}, token: ${tokenPreview}...):`, response.data.errors);
      throw new Error('GraphQL query failed');
    }

    const issue = response.data.data.issue;

    if (!issue) {
      throw new Error('Issue not found');
    }

    return {
      id: issue.id,
      identifier: issue.identifier,
      title: asString(issue.title),
      description: asString(issue.description || ''),
      type: 'Story', // Linear uses different type system, default to Story
      priority: asString(issue.priority || 'medium'),
      status: asString(issue.state?.name || 'Unknown'),
      assignee: asString(issue.assignee?.name || 'Unassigned'),
      reporter: asString(issue.creator?.name || 'Unknown'),
      labels: issue.labels?.nodes?.map(l => l.name) || [],
      comments: issue.comments?.nodes?.map(c => ({
        author: asString(c.user?.name || 'Unknown'),
        body: asString(c.body),
        created: asString(c.createdAt || '')
      })) || [],
      url: issue.url
    };
  } catch (error) {
    const tokenPreview = token.substring(0, 6);
    const status = error.response?.status || 'N/A';
    const graphqlErrors = error.response?.data?.errors || [];
    console.error(`❌ Failed to fetch issue (status: ${status}, token: ${tokenPreview}...):`, graphqlErrors.length > 0 ? graphqlErrors : error.message);
    throw error;
  }
}

/**
 * Post comment to Linear issue using GraphQL
 */
async function postComment(issueId, commentBody, installation) {
  console.log(`💬 Posting comment to Linear issue: ${issueId}`);

  const mutation = `
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
        comment {
          id
          body
        }
      }
    }
  `;

  // Normalize API key: remove Bearer prefix if present
  const token = String(installation.api_key || '').replace(/^Bearer\s+/i, '').trim();

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      {
        query: mutation,
        variables: {
          input: {
            issueId: issueId,
            body: commentBody
          }
        }
      },
      {
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = token.substring(0, 6);
      console.error(`❌ GraphQL errors (status: ${response.status || 'N/A'}, token: ${tokenPreview}...):`, response.data.errors);
      throw new Error('Failed to create comment');
    }

    console.log(`✅ Comment posted to ${issueId}`);
    return response.data.data.commentCreate.comment;
  } catch (error) {
    const tokenPreview = token.substring(0, 6);
    const status = error.response?.status || 'N/A';
    const graphqlErrors = error.response?.data?.errors || [];
    console.error(`❌ Failed to post comment (status: ${status}, token: ${tokenPreview}...):`, graphqlErrors.length > 0 ? graphqlErrors : error.message);
    throw error;
  }
}

/**
 * Helper: Safely convert any value to string
 */
function asString(val) {
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (val === null || val === undefined) return '';
  if (typeof val === 'object') {
    try {
      return JSON.stringify(val);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Helper: Convert any value to array of strings
 */
function asStringArray(val) {
  if (Array.isArray(val)) {
    return val.map(asString).filter(Boolean);
  }
  if (typeof val === 'string') {
    return val.split('\n').map(s => s.trim()).filter(Boolean);
  }
  return [];
}

/**
 * Helper: Convert any value to array of step strings
 */
function asSteps(val) {
  if (Array.isArray(val)) {
    return val.map(asString).filter(Boolean).map(cleanStepNumber);
  }
  if (typeof val === 'string') {
    let steps = [];
    const lines = val.split('\n').map(s => s.trim()).filter(Boolean);
    
    if (lines.length > 1) {
      steps = lines;
    } else {
      const numbered = val.split(/(?=\d+[\).\s]+)/).map(s => s.trim()).filter(Boolean);
      if (numbered.length > 1) {
        steps = numbered;
      } else {
        const sentences = val.split(/\.\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
        steps = sentences.length > 1 ? sentences : [val];
      }
    }
    
    return steps.map(cleanStepNumber).filter(Boolean);
  }
  if (val && typeof val === 'object') {
    if (val.steps) return asSteps(val.steps);
    const str = asString(val);
    return str ? [str] : [];
  }
  return [];
}

/**
 * Remove leading numbers/bullets from step text
 */
function cleanStepNumber(step) {
  if (typeof step !== 'string') return asString(step);
  return step.replace(/^[\d]+[\).\s]+|^[-•]\s+/, '').trim();
}

/**
 * Helper: Truncate string to max length
 */
function truncate(str, n = 800) {
  str = asString(str);
  return str.length > n ? str.slice(0, n) + '…' : str;
}

/**
 * Normalize AI analysis to safe structure (senior QA/CTO format)
 */
function normalizeAnalysis(analysis) {
  const recs = asStringArray(analysis.recommendations || analysis.improvementsNeeded || []);
  const normalized = {
    readyForDevScore: analysis.readyForDevScore ?? (analysis.readyForDevelopmentScore ? Math.round(analysis.readyForDevelopmentScore * 2) : undefined),
    readyForDevVerdict: asString(analysis.readyForDevVerdict || analysis.message || ''),
    affectedAreas: asStringArray(analysis.affectedAreas || []),
    toDo: asStringArray(analysis.toDo || []),
    recommendations: recs.slice(0, 5),
    testRecipe: []
  };

  // Fallback: map old formats to recommendations
  if (normalized.recommendations.length === 0) {
    const sources = [
      ...(analysis.toAdd || []).map(x => asString(x.title || x.name || x.description || x)),
      ...(analysis.toClarify || []).map(c => typeof c === 'object' ? asString(c.question) : asString(c)),
      ...(analysis.criticalClarifications || []).map(c => typeof c === 'object' ? asString(c.question) : asString(c)),
      ...(analysis.qaQuestions || []),
      ...(analysis.keyRisks || [])
    ];
    normalized.recommendations = sources.filter(Boolean).slice(0, 5);
  }

  // Fallback: simple toDo when recommendations exist
  if (normalized.toDo.length === 0 && normalized.recommendations.length > 0) {
    normalized.toDo = ['Review the recommendations and update the ticket as needed'];
  }

  // Normalize test recipe - types: E2E, API, UI, Manual. Priority: Smoke, Critical Path, Regression
  let rawRecipe = analysis.testRecipe || [];
  if (!Array.isArray(rawRecipe)) rawRecipe = [rawRecipe].filter(Boolean);
  const allowedTypes = ['E2E', 'API', 'UI', 'Manual'];
  const mapTestType = (val) => {
    const v = String(val || '').trim();
    if (allowedTypes.includes(v)) return v;
    const l = v.toLowerCase();
    if (l.includes('api') || l.includes('integration') || l.includes('unit')) return 'API';
    if (l.includes('ui') || l.includes('visual')) return 'UI';
    if (l.includes('manual')) return 'Manual';
    return 'E2E';
  };
  const mapPriority = (val) => {
    const v = String(val || '').trim().toLowerCase();
    if (v.includes('smoke') || v === 'high') return 'Smoke';
    if (v.includes('critical') || v.includes('medium')) return 'Critical Path';
    if (v.includes('regression') || v === 'low') return 'Regression';
    return 'Critical Path';
  };
  normalized.testRecipe = rawRecipe.map((test) => ({
    testType: mapTestType(test.testType || test.automation),
    scenario: asString(test.scenario || test.name || test.title || ''),
    priority: mapPriority(test.priority),
    blocked: Boolean(test.blocked)
  }));

  // Fallback: ensure Test Recipe is never empty (AI sometimes omits it)
  if (normalized.testRecipe.length === 0) {
    normalized.testRecipe = [
      { testType: 'E2E', scenario: 'Complete happy path flow → success', priority: 'Smoke', blocked: false },
      { testType: 'API', scenario: 'Invalid input → returns appropriate error', priority: 'Critical Path', blocked: false },
      { testType: 'UI', scenario: 'Verify UI state and feedback', priority: 'Critical Path', blocked: false }
    ];
  }

  if (typeof normalized.readyForDevScore !== 'number') {
    const parsed = parseInt(String(normalized.readyForDevScore), 10);
    normalized.readyForDevScore = !isNaN(parsed) ? Math.min(10, Math.max(1, parsed)) : 5;
  }

  return normalized;
}

/**
 * Format AI analysis as Linear comment (senior QA/CTO format)
 */
function formatAnalysisComment(analysis) {
  try {
    const a = normalizeAnalysis(analysis);

    // Pulse
    let comment = '### 🫀 Pulse\n\n';
    comment += `**Ready for Dev:** ${a.readyForDevScore}/10`;
    if (a.readyForDevVerdict) comment += ` — ${truncate(a.readyForDevVerdict, 80)}`;
    comment += '\n\n';
    if (a.affectedAreas.length > 0) {
      comment += `**Affected Areas:** ${a.affectedAreas.map(x => `\`${x}\``).join(' · ')}\n\n`;
    }
    if (a.toDo.length > 0) {
      comment += '**To Do:**\n';
      a.toDo.forEach(item => { comment += `- [ ] ${truncate(item, 200)}\n`; });
      comment += '\n---\n\n';
    }

    // Recommendations
    if (a.recommendations.length > 0) {
      comment += '### 📋 Recommendations\n\n';
      a.recommendations.forEach(r => { comment += `- ${truncate(r, 250)}\n`; });
      comment += '\n---\n\n';
    }

    // Test Recipe
    if (a.testRecipe.length > 0) {
      comment += '### 🧪 Test Recipe\n\n';
      comment += '| Type | Scenario | Priority |\n';
      comment += '|------|----------|----------|\n';
      const priorityEmoji = { Smoke: '🔴', 'Critical Path': '🟡', Regression: '🟢' };
      a.testRecipe.forEach(t => {
        let scenario = truncate(t.scenario, 150);
        if (t.blocked) scenario += ' [BLOCKED: awaiting clarification]';
        const prio = priorityEmoji[t.priority] || '🟡';
        comment += `| **${t.testType}** | ${scenario} | ${prio} ${t.priority} |\n`;
      });
      comment += '\n';
    }

    // Footer
    comment += '---\n\n🤖 QA Analysis by **Ovi (the AI QA)**';

    return comment;
  } catch (error) {
    console.error('❌ Error formatting analysis comment:', error);
    const keys = analysis ? Object.keys(analysis).join(', ') : 'none';
    return `🤖 FirstQA Analysis\n\n(Formatting failed. Raw keys: ${keys})\n\n---\n🤖 QA Analysis by **Ovi (the AI QA)**`;
  }
}

/**
 * Save analysis to database
 */
async function saveAnalysisToDatabase(data) {
  const { installationId, provider, issueKey, issueTitle, issueUrl, analysisResult } = data;
  
  try {
    const { data: savedAnalysis, error } = await supabaseAdmin
      .from('analyses')
      .insert({
        user_id: null,
        integration_id: null,
        provider: provider,
        repository: issueKey,
        pr_number: 0,
        pr_title: issueTitle,
        pr_url: issueUrl,
        analysis_type: 'full',
        status: 'completed',
        result: analysisResult,
        completed_at: new Date().toISOString(),
        metadata: { 
          linear_installation_id: installationId,
          issue_key: issueKey
        }
      })
      .select();

    if (error) {
      console.error('❌ Error saving analysis to database:', error);
      return null;
    }

    console.log(`✅ Analysis saved to database (ID: ${savedAnalysis[0]?.id})`);
    return savedAnalysis;
  } catch (error) {
    console.error('❌ Failed to save analysis:', error);
    return null;
  }
}

module.exports = {
  processLinearWebhook,
  fetchIssueDetails,
  postComment,
  formatAnalysisComment,
  verifyLinearApiKey,
  getLinearOrganization
};
