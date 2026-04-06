/**
 * Linear Connect Service
 * Handles webhook processing and GraphQL API calls for Linear
 */

const axios = require('axios');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const { generateAnalysisId, feedbackFooter } = require('./feedbackHelper');

// Linear GraphQL API endpoint
const LINEAR_API_URL = 'https://api.linear.app/graphql';

// Linear expects: OAuth tokens (lin_oa*) as "Bearer <token>"; Personal API keys (lin_api_*) as raw key
function getLinearAuthHeader(apiKey) {
  const raw = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();
  if (!raw) return '';
  if (raw.startsWith('lin_oa')) return `Bearer ${raw}`;
  return raw;
}

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

  const authHeader = getLinearAuthHeader(apiKey);

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      { query },
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = String(apiKey || '').slice(0, 6);
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
    const tokenPreview = String(apiKey || '').slice(0, 6);
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

    // Early check: ignore bot/AI comments (prevent infinite loop)
    // Use botActor from webhook payload - Linear sets this for AI/agent comments
    // Avoid matching human emails like user+firstqa_client1@gmail.com
    const authorName = comment.user?.name || comment.user?.email || 'unknown';
    const isBotActor = commentData.botActor != null;
    const isBotName = authorName && !authorName.includes('@') &&
      (authorName === 'FirstQA' || authorName === 'Ovi' || /^oviai-by-firstqa$/i.test(authorName));
    const isBot = isBotActor || !!isBotName;

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


    const { getUserIdFromLinearOrg, userHasAnyProductKnowledge, indexAllUserRepos, extractReposFromTicketContent } = require('../services/knowledgeBase/firstTimeIndexTrigger');
    const orgId = installation.organization_id;
    const userId = await getUserIdFromLinearOrg(orgId);

    // Fetch full issue details
    const issueDetails = await fetchIssueDetails(issueId, installation);

    // Defensive check
    if (!issueDetails || !issueDetails.title) {
      console.error('❌ Failed to fetch valid issue details');
      return { success: false, message: 'Failed to fetch issue details' };
    }

    const runAnalysisAndPost = async () => {
      let designContext = null;
      let discussionContext = null;

      const attachmentUrls = issueDetails.attachmentUrls || [];
      if (attachmentUrls.length > 0) {
        try {
          const { isFigmaUrl, extractFigmaFileKeys, fetchFigmaContext, formatFigmaContextForPrompt } = require('./figmaService');
          const figmaUrls = attachmentUrls.filter(isFigmaUrl);
          if (figmaUrls.length > 0 && process.env.FIGMA_ACCESS_TOKEN) {
            const fileKeys = extractFigmaFileKeys(figmaUrls);
            const figmaResults = [];
            for (const fk of fileKeys.slice(0, 3)) {
              const ctx = await fetchFigmaContext(fk.fileKey, fk.nodeId, process.env.FIGMA_ACCESS_TOKEN);
              if (ctx) figmaResults.push(ctx);
            }
            designContext = formatFigmaContextForPrompt(figmaResults);
            if (designContext) console.log(`🎨 Figma context fetched from ${figmaResults.length} file(s)`);
          }
        } catch (figmaErr) {
          console.warn('Figma context fetch failed:', figmaErr.message);
        }

        try {
          const { isSlackUrl, extractSlackThreadInfo, fetchSlackThread, formatSlackContextForPrompt } = require('./slackService');
          const slackUrls = attachmentUrls.filter(isSlackUrl);
          if (slackUrls.length > 0 && process.env.SLACK_BOT_TOKEN) {
            const threads = extractSlackThreadInfo(slackUrls);
            const slackMessages = [];
            for (const t of threads.slice(0, 3)) {
              const msgs = await fetchSlackThread(t.channelId, t.threadTs, process.env.SLACK_BOT_TOKEN);
              if (msgs) slackMessages.push(...msgs);
            }
            discussionContext = formatSlackContextForPrompt(slackMessages);
            if (discussionContext) console.log(`💬 Slack context fetched from ${threads.length} thread(s)`);
          }
        } catch (slackErr) {
          console.warn('Slack context fetch failed:', slackErr.message);
        }
      }

      const { generateTicketInsights } = require('../ai/openaiClient');
      const aiInsights = await generateTicketInsights({
        ticketId: issueDetails.identifier,
        title: issueDetails.title,
        description: issueDetails.description,
        comments: issueDetails.comments,
        labels: issueDetails.labels,
        platform: 'linear',
        priority: issueDetails.priority,
        type: issueDetails.type,
        designContext,
        discussionContext
      });
      if (!aiInsights || !aiInsights.success) {
        console.error('❌ AI analysis failed');
        return;
      }
      const linearAnalysisId = generateAnalysisId();
      let analysisComment = formatAnalysisComment(aiInsights.data);
      analysisComment = `**QA analysis ready.**\n\n${analysisComment}`;
      analysisComment += feedbackFooter(linearAnalysisId);
      await postComment(issueId, analysisComment, installation);
      if (isSupabaseConfigured()) {
        await saveAnalysisToDatabase({
          analysisId: linearAnalysisId,
          installationId: installation.id,
          provider: 'linear',
          issueKey: issueDetails.identifier,
          issueTitle: issueDetails.title,
          issueUrl: issueDetails.url,
          analysisResult: aiInsights.data,
          userId
        });
      }
      console.log('🎉 Linear issue analysis complete!');
    };

    // If user has no product knowledge: post "building knowledge" message, index repos, then run analysis
    if (userId && process.env.ENABLE_KNOWLEDGE_SYNC === 'true') {
      const hasKnowledge = await userHasAnyProductKnowledge(userId);
      if (!hasKnowledge) {
        const prioritizedRepos = extractReposFromTicketContent(
          issueDetails.description,
          (issueDetails.comments || []).map(c => c.body || c.text || ''),
          issueDetails.attachmentUrls || []
        );
        await postComment(issueId, '🔨 **Building product knowledge** from your repositories. Analysis will be posted once indexing completes.', installation);
        indexAllUserRepos(userId, {
          prioritizedRepos,
          onAllComplete: () => runAnalysisAndPost().catch(e => console.warn('Deferred Linear analysis failed:', e.message))
        });
        return { success: true, message: 'Indexing started, analysis will follow', issueId };
      }
    }

    // User has knowledge or no userId: run analysis immediately
    await runAnalysisAndPost();

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

  const authHeader = getLinearAuthHeader(installation.api_key);

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      {
        query,
        variables: { id: commentId }
      },
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = String(installation.api_key || '').slice(0, 6);
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
    const tokenPreview = String(installation.api_key || '').slice(0, 6);
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
        attachments {
          nodes {
            url
            title
            sourceType
          }
        }
        team {
          key
        }
        url
      }
    }
  `;

  const authHeader = getLinearAuthHeader(installation.api_key);

  try {
    const response = await axios.post(
      LINEAR_API_URL,
      {
        query,
        variables: { id: issueId }
      },
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = String(installation.api_key || '').slice(0, 6);
      console.error(`❌ GraphQL errors (status: ${response.status || 'N/A'}, token: ${tokenPreview}...):`, response.data.errors);
      throw new Error('GraphQL query failed');
    }

    const issue = response.data.data.issue;

    if (!issue) {
      throw new Error('Issue not found');
    }

    const attachmentUrls = (issue.attachments?.nodes || []).map(a => asString(a?.url || '')).filter(Boolean);
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
      attachmentUrls,
      url: issue.url
    };
  } catch (error) {
    const tokenPreview = String(installation.api_key || '').slice(0, 6);
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

  const authHeader = getLinearAuthHeader(installation.api_key);

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
          'Authorization': authHeader,
          'Content-Type': 'application/json'
        }
      }
    );

    if (response.data.errors) {
      const tokenPreview = String(installation.api_key || '').slice(0, 6);
      console.error(`❌ GraphQL errors (status: ${response.status || 'N/A'}, token: ${tokenPreview}...):`, response.data.errors);
      throw new Error('Failed to create comment');
    }

    console.log(`✅ Comment posted to ${issueId}`);
    return response.data.data.commentCreate.comment;
  } catch (error) {
    const tokenPreview = String(installation.api_key || '').slice(0, 6);
    const status = error.response?.status || 'N/A';
    const graphqlErrors = error.response?.data?.errors || [];
    console.error(`❌ Failed to post comment (status: ${status}, token: ${tokenPreview}...):`, graphqlErrors.length > 0 ? graphqlErrors : error.message);
    throw error;
  }
}

const { formatAnalysisComment } = require('./ticketAnalysisFormatter');

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
 * Save analysis to database
 */
async function saveAnalysisToDatabase(data) {
  const { installationId, provider, issueKey, issueTitle, issueUrl, analysisResult, userId, analysisId } = data;
  
  try {
    const insertRow = {
      user_id: userId || null,
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
    };
    if (analysisId) insertRow.id = analysisId;

    const { data: savedAnalysis, error } = await supabaseAdmin
      .from('analyses')
      .insert(insertRow)
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
