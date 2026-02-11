/**
 * Jira API Service
 * Handles Jira API interactions: webhooks, ticket fetching, comment posting
 */

const axios = require('axios');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * Get Jira integration for a user
 */
async function getJiraIntegration(userId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data: integration, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'jira')
    .single();

  if (error) {
    throw new Error(`Failed to fetch Jira integration: ${error.message}`);
  }

  return integration;
}

/**
 * Get Jira integration by site ID (cloud ID)
 */
async function getJiraIntegrationBySiteId(siteId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data: integration, error } = await supabaseAdmin
    .from('integrations')
    .select('*')
    .eq('provider', 'jira')
    .eq('account_id', siteId)
    .limit(1);

  if (error || !integration || integration.length === 0) {
    throw new Error(`No Jira integration found for site ${siteId}`);
  }

  return integration[0];
}

/**
 * Refresh Jira access token if expired
 */
async function refreshAccessToken(integration) {
  const now = new Date();
  const expiresAt = new Date(integration.token_expires_at);

  // If token expires in less than 5 minutes, refresh it
  if (expiresAt - now < 5 * 60 * 1000) {
    console.log('🔄 Refreshing Jira access token...');
    
    const response = await axios.post('https://auth.atlassian.com/oauth/token', {
      grant_type: 'refresh_token',
      client_id: process.env.JIRA_CLIENT_ID,
      client_secret: process.env.JIRA_CLIENT_SECRET,
      refresh_token: integration.refresh_token
    }, {
      headers: { 'Content-Type': 'application/json' }
    });

    const { access_token, refresh_token, expires_in } = response.data;

    // Update in database
    await supabaseAdmin
      .from('integrations')
      .update({
        access_token: access_token,
        refresh_token: refresh_token,
        token_expires_at: new Date(Date.now() + expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', integration.id);

    console.log('✅ Jira access token refreshed');
    
    return access_token;
  }

  return integration.access_token;
}

/**
 * Create a webhook in Jira when user connects
 */
async function createWebhook(siteId, accessToken) {
  const webhookUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/jira/webhook`;
  
  console.log(`🔗 Creating Jira webhook for site ${siteId}...`);
  console.log(`   Webhook URL: ${webhookUrl}`);

  try {
    // Use the legacy webhook endpoint (v1) which works with OAuth
    const response = await axios.post(
      `https://api.atlassian.com/ex/jira/${siteId}/rest/webhooks/1.0/webhook`,
      {
        name: 'FirstQA',
        url: webhookUrl,
        events: ['jira:issue_updated'],
        filters: {
          'issue-related-events-section': 'comment_created'
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log(`✅ Jira webhook created successfully`);
    return response.data;
  } catch (error) {
    console.error('❌ Webhook creation failed:', error.response?.status, error.response?.data);
    
    // Try alternative: user-level webhook using v3 API
    try {
      console.log('🔄 Trying alternative webhook creation method...');
      const altResponse = await axios.put(
        `https://api.atlassian.com/ex/jira/${siteId}/rest/api/3/webhook`,
        {
          webhooks: [{
            name: 'FirstQA',
            url: webhookUrl,
            events: ['comment_created']
          }]
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`✅ Jira webhook created via alternative method`);
      return altResponse.data;
    } catch (altError) {
      console.error('❌ Alternative method also failed:', altError.response?.status, altError.response?.data);
      return null;
    }
  }
}

/**
 * Fetch remote links for a Jira issue (e.g. GitHub PR URLs)
 */
async function fetchRemoteLinks(siteId, issueKey, accessToken) {
  try {
    const response = await axios.get(
      `https://api.atlassian.com/ex/jira/${siteId}/rest/api/3/issue/${issueKey}/remotelink`,
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      }
    );
    const links = response.data || [];
    return links.map(l => l.object?.url).filter(Boolean);
  } catch (e) {
    console.warn('Could not fetch Jira remote links:', e.message);
    return [];
  }
}

/**
 * Fetch ticket details from Jira
 */
async function fetchTicketDetails(siteId, issueKey, accessToken) {
  console.log(`🔍 Fetching Jira ticket: ${issueKey}`);

  const response = await axios.get(
    `https://api.atlassian.com/ex/jira/${siteId}/rest/api/3/issue/${issueKey}`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      },
      params: {
        expand: 'renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations,comments'
      }
    }
  );

  const issue = response.data;

  // Fetch remote links (GitHub PRs, etc.) for repo extraction
  const remoteLinkUrls = await fetchRemoteLinks(siteId, issueKey, accessToken);

  // Extract relevant data
  return {
    key: issue.key,
    id: issue.id,
    summary: issue.fields.summary,
    description: issue.renderedFields?.description || issue.fields.description || '',
    type: issue.fields.issuetype?.name || 'Task',
    priority: issue.fields.priority?.name || 'Medium',
    status: issue.fields.status?.name || 'Unknown',
    assignee: issue.fields.assignee?.displayName || 'Unassigned',
    reporter: issue.fields.reporter?.displayName || 'Unknown',
    labels: issue.fields.labels || [],
    comments: issue.fields.comment?.comments?.map(c => ({
      author: c.author.displayName,
      body: c.body,
      created: c.created
    })) || [],
    remoteLinkUrls,
    url: `${issue.self.replace('/rest/api/3/issue/' + issue.key, '')}/browse/${issue.key}`
  };
}

/**
 * Post a comment to a Jira ticket
 */
async function postComment(siteId, issueKey, commentBody, accessToken) {
  console.log(`💬 Posting comment to Jira ticket: ${issueKey}`);

  try {
    const response = await axios.post(
      `https://api.atlassian.com/ex/jira/${siteId}/rest/api/3/issue/${issueKey}/comment`,
      {
        body: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: commentBody
                }
              ]
            }
          ]
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      }
    );

    console.log(`✅ Comment posted to ${issueKey}`);
    return response.data;
  } catch (error) {
    console.error('❌ Failed to post comment:', error.response?.data || error.message);
    throw error;
  }
}

const { formatAnalysisComment } = require('./ticketAnalysisFormatter');

/**
 * Process Jira webhook event
 */
async function processWebhookEvent(event) {
  try {
    const payload = event.body;
    
    console.log('📣 Processing Jira webhook event');
    console.log('Webhook keys:', Object.keys(payload));

    // Jira webhook structure: { webhookEvent, issue, comment, user }
    const webhookEvent = payload.webhookEvent;
    const issue = payload.issue;
    const comment = payload.comment;
    const user = payload.user || payload.comment?.author;

    console.log(`Event type: ${webhookEvent}`);

    // Only handle comment_created events
    if (webhookEvent !== 'comment_created') {
      console.log(`Skipping non-comment event: ${webhookEvent}`);
      return { success: true, message: 'Skipped non-comment event' };
    }

    if (!issue || !comment) {
      console.error('Missing issue or comment in payload');
      return { success: false, message: 'Missing issue or comment' };
    }

    console.log(`Issue: ${issue.key}`);
    console.log(`Comment by: ${user?.displayName || user?.name}`);
    console.log(`Comment body: ${comment.body}`);

    // Extract plain text from Jira's ADF (Atlassian Document Format)
    let commentText = '';
    if (typeof comment.body === 'string') {
      commentText = comment.body;
    } else if (comment.body?.content) {
      // Parse ADF format
      commentText = extractTextFromADF(comment.body);
    }

    console.log(`Extracted comment text: ${commentText}`);

    // Check for /qa command
    if (!commentText.trim().startsWith('/qa')) {
      console.log('Skipping comment without /qa command');
      return { success: true, message: 'Skipped non-/qa comment' };
    }

    console.log('🧪 /qa command detected in Jira!');

    // Get site ID from issue self URL
    // Example: https://api.atlassian.com/ex/jira/{cloudId}/rest/api/3/issue/...
    const siteId = issue.self?.match(/\/ex\/jira\/([^\/]+)\//)?.[1];
    if (!siteId) {
      console.error('Could not extract site ID from issue URL:', issue.self);
      return { success: false, message: 'Could not determine Jira site' };
    }

    console.log(`Site ID: ${siteId}`);

    // Get integration for this Jira site
    const integration = await getJiraIntegrationBySiteId(siteId);
    const accessToken = await refreshAccessToken(integration);

    // Fetch full ticket details
    const ticketDetails = await fetchTicketDetails(siteId, issue.key, accessToken);

    const runAnalysisAndPost = async () => {
      const { generateTicketInsights } = require('../../ai/openaiClient');
      const aiInsights = await generateTicketInsights({
        ticketId: ticketDetails.key,
        title: ticketDetails.summary,
        description: ticketDetails.description,
        comments: ticketDetails.comments,
        labels: ticketDetails.labels,
        platform: 'jira',
        priority: ticketDetails.priority,
        type: ticketDetails.type
      });
      if (!aiInsights || !aiInsights.success) {
        console.error('❌ AI analysis failed:', aiInsights?.error);
        return;
      }
      const analysisComment = formatAnalysisComment(aiInsights.data);
      await postComment(siteId, issue.key, analysisComment, accessToken);
      if (isSupabaseConfigured()) {
        await saveAnalysisToDatabase({
          userId: integration.user_id,
          integrationId: integration.id,
          provider: 'jira',
          issueKey: ticketDetails.key,
          issueTitle: ticketDetails.summary,
          issueUrl: ticketDetails.url,
          analysisResult: aiInsights.data
        });
      }
      console.log('🎉 Jira ticket analysis complete!');
    };

    // If user has no product knowledge: post "building knowledge" message, index repos, then run analysis
    if (integration?.user_id && process.env.ENABLE_KNOWLEDGE_SYNC === 'true') {
      const { userHasAnyProductKnowledge, indexAllUserRepos, extractReposFromTicketContent } = require('../services/knowledgeBase/firstTimeIndexTrigger');
      const hasKnowledge = await userHasAnyProductKnowledge(integration.user_id);
      if (!hasKnowledge) {
        const commentTexts = (ticketDetails.comments || []).map(c =>
          typeof c.body === 'string' ? c.body : (c.body?.content ? extractTextFromADF(c.body) : '')
        );
        const prioritizedRepos = extractReposFromTicketContent(
          ticketDetails.description,
          commentTexts,
          ticketDetails.remoteLinkUrls || []
        );
        const buildingMsg = '🔨 **Building product knowledge** from your repositories. Analysis will be posted once indexing completes.';
        await postComment(siteId, issue.key, buildingMsg, accessToken);
        indexAllUserRepos(integration.user_id, {
          prioritizedRepos,
          onAllComplete: () => runAnalysisAndPost().catch(e => console.warn('Deferred Jira analysis failed:', e.message))
        });
        return { success: true, message: 'Indexing started, analysis will follow', issueKey: issue.key };
      }
    }

    // User has knowledge or no userId: run analysis immediately
    await runAnalysisAndPost();

    return {
      success: true,
      message: 'Analysis posted',
      issueKey: issue.key
    };

  } catch (error) {
    console.error('❌ Jira webhook processing error:', error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Extract plain text from Jira's ADF (Atlassian Document Format)
 */
function extractTextFromADF(adf) {
  if (!adf || !adf.content) return '';
  
  let text = '';
  
  function traverse(node) {
    if (node.type === 'text') {
      text += node.text;
    }
    if (node.content) {
      node.content.forEach(traverse);
    }
  }
  
  adf.content.forEach(traverse);
  return text.trim();
}

/**
 * Save analysis to database
 */
async function saveAnalysisToDatabase(data) {
  const { userId, integrationId, provider, issueKey, issueTitle, issueUrl, analysisResult } = data;
  
  try {
    const { data: savedAnalysis, error } = await supabaseAdmin
      .from('analyses')
      .insert({
        user_id: userId,
        integration_id: integrationId,
        provider: provider,
        repository: issueKey, // Store issue key in repository field
        pr_number: 0, // Not a PR, use 0
        pr_title: issueTitle,
        pr_url: issueUrl,
        analysis_type: 'full',
        status: 'completed',
        result: analysisResult,
        completed_at: new Date().toISOString()
      })
      .select();

    if (error) {
      console.error('❌ Error saving analysis to database:', error);
      throw error;
    }

    console.log(`✅ Analysis saved to database for user ${userId}`);

    // Increment user's analyses count
    await supabaseAdmin.rpc('increment_user_analyses_count', { user_id_param: userId });

    return savedAnalysis;
  } catch (error) {
    console.error('❌ Failed to save analysis:', error);
    throw error;
  }
}

module.exports = {
  getJiraIntegration,
  getJiraIntegrationBySiteId,
  refreshAccessToken,
  createWebhook,
  fetchTicketDetails,
  postComment,
  formatAnalysisComment,
  processWebhookEvent,
  saveAnalysisToDatabase
};
