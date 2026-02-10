/**
 * Jira Connect Service
 * Handles webhook processing and API calls for Connect app
 */

const axios = require('axios');
const { generateInstallationToken } = require('./jiraConnectAuth');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * Process webhook from Jira Connect
 */
async function processConnectWebhook(payload, installation) {
  try {
    console.log('📣 Processing Jira Connect webhook');

    const { comment, issue, webhookEvent } = payload;

    if (!comment || !issue) {
      console.log('❌ Missing comment or issue in webhook payload');
      return { success: false, message: 'Invalid webhook payload' };
    }

    // Early check: ignore bot comments (prevent infinite loop)
    const authorName = comment.author?.displayName || '';
    const isBot = authorName.includes('FirstQA') || authorName.includes('firstqa');
    
    console.log(`📩 Webhook: ${webhookEvent} | Issue: ${issue.key} | Author: ${authorName}${isBot ? ' [BOT]' : ''}`);
    
    if (isBot) {
      console.log('✓ Ignored bot comment (prevent loop)');
      return { success: true, message: 'Ignored bot comment' };
    }

    // Extract and check for /qa command
    const commentText = extractTextFromComment(comment);
    const hasQaCommand = commentText.trim().toLowerCase().startsWith('/qa');
    
    if (!hasQaCommand) {
      console.log('✓ No /qa command, skipping');
      return { success: true, message: 'Not a /qa command' };
    }

    console.log('🧪 /qa command detected! Processing analysis...');
    console.log(`📝 Comment preview: "${commentText.substring(0, 100)}..."`);

    // Fetch full ticket details
    const ticketDetails = await fetchTicketDetails(issue.key, installation);

    // Defensive check
    if (!ticketDetails || !ticketDetails.summary) {
      console.error('❌ Failed to fetch valid ticket details');
      return { success: false, message: 'Failed to fetch ticket details' };
    }

    // Generate AI analysis
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
      console.error('❌ AI analysis failed');
      return { success: false, message: 'AI analysis failed' };
    }

    console.log('✅ AI analysis completed');

    // Post analysis as comment (Jira does NOT render Markdown, so strip Markdown-only markers)
    let analysisComment = formatAnalysisComment(aiInsights.data);
    // Remove Markdown headings (###) and horizontal rules (---) that Jira shows as plain text
    analysisComment = analysisComment
      .replace(/^###\s+/gm, '')  // strip leading heading markers
      .replace(/^---$/gm, '')    // strip lines that are just ---
      .replace(/\n{3,}/g, '\n\n'); // collapse excessive blank lines

    await postComment(issue.key, analysisComment.trim(), installation);

    // Save analysis to database (link to installation, not user)
    if (isSupabaseConfigured()) {
      await saveAnalysisToDatabase({
        installationId: installation.id,
        provider: 'jira',
        issueKey: ticketDetails.key,
        issueTitle: ticketDetails.summary,
        issueUrl: ticketDetails.url,
        analysisResult: aiInsights.data
      });
    }

    console.log('🎉 Jira ticket analysis complete!');

    return {
      success: true,
      message: 'Analysis posted',
      issueKey: issue.key
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
 * Extract plain text from Jira comment body
 */
function extractTextFromComment(comment) {
  // Handle ADF format (Atlassian Document Format)
  if (comment.body && typeof comment.body === 'object' && comment.body.content) {
    return extractTextFromADF(comment.body);
  }
  
  // Handle plain text
  if (typeof comment.body === 'string') {
    return comment.body;
  }
  
  return '';
}

/**
 * Extract text from ADF
 */
function extractTextFromADF(adf) {
  let text = '';
  
  function traverse(node) {
    if (node.type === 'text') {
      text += node.text;
    }
    if (node.content) {
      node.content.forEach(traverse);
    }
  }
  
  if (adf.content) {
    adf.content.forEach(traverse);
  }
  
  return text.trim();
}

/**
 * Fetch ticket details from Jira
 */
async function fetchTicketDetails(issueKey, installation) {
  console.log(`🔍 Fetching Jira ticket: ${issueKey}`);
  console.log(`📦 Installation data:`, {
    client_key: installation.client_key,
    base_url: installation.base_url,
    has_shared_secret: !!installation.shared_secret,
    secret_length: installation.shared_secret?.length
  });

  // Build full API URL with explicit field requests
  const apiPath = `/rest/api/3/issue/${issueKey}`;
  const fields = encodeURIComponent('summary,description,comment,labels,priority,issuetype,status,assignee,reporter');
  const expand = encodeURIComponent('renderedFields,comments');
  const queryParams = `fields=${fields}&expand=${expand}`;
  const fullUrl = `${installation.base_url}${apiPath}?${queryParams}`;

  console.log(`📍 Full API URL: ${fullUrl}`);

  // Generate JWT token with proper QSH using atlassian-jwt
  const token = generateInstallationToken(
    installation.shared_secret,
    'GET',
    fullUrl
  );

  const response = await axios.get(
    fullUrl,
    {
      headers: {
        'Authorization': `JWT ${token}`,
        'Accept': 'application/json'
      }
    }
  );

  const issue = response.data;

  // Defensive validation - try multiple fallbacks for summary
  const summary = issue.fields?.summary || issue.renderedFields?.summary || issue.summary;
  
  if (!summary) {
    console.error('❌ Unexpected Jira issue payload:', {
      status: response.status,
      contentType: response.headers['content-type'],
      url: fullUrl,
      topLevelKeys: Object.keys(issue || {}),
      fieldsKeys: Object.keys(issue?.fields || {}),
      dataPreview: JSON.stringify(response.data).substring(0, 800)
    });
    throw new Error('Unexpected Jira issue payload: missing summary');
  }
  
  return {
    key: issue.key,
    id: issue.id,
    summary: asString(summary),
    description: asString(issue.renderedFields?.description || issue.fields?.description || ''),
    type: asString(issue.fields?.issuetype?.name || 'Task'),
    priority: asString(issue.fields?.priority?.name || 'Medium'),
    status: asString(issue.fields?.status?.name || 'Unknown'),
    assignee: asString(issue.fields?.assignee?.displayName || 'Unassigned'),
    reporter: asString(issue.fields?.reporter?.displayName || 'Unknown'),
    labels: issue.fields?.labels || [],
    comments: issue.fields?.comment?.comments?.map(c => ({
      author: asString(c.author?.displayName || 'Unknown'),
      body: asString(extractTextFromComment(c)),
      created: asString(c.created || '')
    })) || [],
    url: `${installation.base_url}/browse/${issue.key}`
  };
}

/**
 * Post comment to Jira ticket
 */
async function postComment(issueKey, commentBody, installation) {
  console.log(`💬 Posting comment to Jira ticket: ${issueKey}`);

  // Build full API URL
  const apiPath = `/rest/api/3/issue/${issueKey}/comment`;
  const fullUrl = `${installation.base_url}${apiPath}`;

  console.log(`📍 POST URL: ${fullUrl}`);

  // Generate JWT token with proper QSH using atlassian-jwt
  const token = generateInstallationToken(
    installation.shared_secret,
    'POST',
    fullUrl
  );

  try {
    // Convert commentBody to proper ADF format (one paragraph per line)
    const lines = commentBody.split('\n');
    const adfContent = lines.map(line => ({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: line || ' ' // Empty string breaks ADF, use space
        }
      ]
    }));

    const response = await axios.post(
      fullUrl,
      {
        body: {
          type: 'doc',
          version: 1,
          content: adfContent
        }
      },
      {
        headers: {
          'Authorization': `JWT ${token}`,
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
 * Save analysis to database
 */
async function saveAnalysisToDatabase(data) {
  const { installationId, provider, issueKey, issueTitle, issueUrl, analysisResult } = data;
  
  try {
    const { data: savedAnalysis, error } = await supabaseAdmin
      .from('analyses')
      .insert({
        user_id: null, // Connect apps are not user-specific
        integration_id: null, // Jira Connect installations not in integrations table
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
          jira_installation_id: installationId, // Store reference in metadata
          issue_key: issueKey
        }
      })
      .select();

    if (error) {
      console.error('❌ Error saving analysis to database:', error);
      console.error('❌ Error details:', {
        code: error.code,
        message: error.message,
        hint: error.hint
      });
      // Don't throw - analysis was successful even if DB save failed
      return null;
    }

    console.log(`✅ Analysis saved to database (ID: ${savedAnalysis[0]?.id})`);
    return savedAnalysis;
  } catch (error) {
    console.error('❌ Failed to save analysis:', error);
    // Don't throw - analysis was successful even if DB save failed
    return null;
  }
}

module.exports = {
  processConnectWebhook,
  fetchTicketDetails,
  postComment,
  formatAnalysisComment
};
