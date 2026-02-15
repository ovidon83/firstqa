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
    const { generateTicketInsights } = require('../ai/openaiClient');
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

    // Build rich ADF comment for Jira (headings, bullets, table)
    let adfDoc = buildJiraAdfFromAnalysis(aiInsights.data);
    if (ticketDetails.assigneeAccountId) {
      adfDoc.content.unshift({
        type: 'paragraph',
        content: [
          { type: 'mention', attrs: { id: ticketDetails.assigneeAccountId } },
          { type: 'text', text: ' — QA analysis ready.' }
        ]
      });
    }
    await postComment(issue.key, adfDoc, installation);

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
    assigneeAccountId: issue.fields?.assignee?.accountId || null,
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
 * Accepts either a plain text string or a full ADF doc object.
 */
async function postComment(issueKey, body, installation) {
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
    let adfBody;

    if (body && typeof body === 'object' && body.type === 'doc') {
      // Already an ADF document
      adfBody = body;
    } else {
      // Convert plain text (one paragraph per line) to simple ADF
      const text = String(body || '');
      const lines = text.split('\n');
      const adfContent = lines.map(line => ({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: line || ' ' // Empty string breaks ADF, use space
          }
        ]
      }));
      adfBody = {
        type: 'doc',
        version: 1,
        content: adfContent
      };
    }

    const response = await axios.post(
      fullUrl,
      { body: adfBody },
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

const { normalizeAnalysis } = require('./ticketAnalysisFormatter');

/**
 * Build a rich Jira ADF document from normalized analysis
 * (sections + table) for a clean Jira-native layout.
 */
function buildJiraAdfFromAnalysis(analysis) {
  const a = normalizeAnalysis(analysis);

  const content = [];

  // Pulse
  content.push({
    type: 'heading',
    attrs: { level: 3 },
    content: [{ type: 'text', text: '🫀 Pulse' }]
  });

  if (a.readinessScore != null) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Readiness score: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: `${a.readinessScore}/5` }
      ]
    });
  }

  if (a.affectedAreas.length > 0) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Affected Areas: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: a.affectedAreas.join(' · ') }
      ]
    });
  }

  if (a.highestRisk) {
    content.push({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Highest risk: ', marks: [{ type: 'strong' }] },
        { type: 'text', text: a.highestRisk }
      ]
    });
  }

  // Divider
  content.push({ type: 'rule' });

  // Recommendations
  if (a.recommendations.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '📋 Recommendations' }]
    });

    content.push({
      type: 'bulletList',
      content: a.recommendations.map(rec => ({
        type: 'listItem',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: rec }]
          }
        ]
      }))
    });

    content.push({ type: 'rule' });
  }

  // Test Recipe table
  if (a.testRecipe.length > 0) {
    content.push({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '🧪 Test Recipe' }]
    });

    const headerRow = {
      type: 'tableRow',
      content: ['Name', 'Steps', 'Priority', 'Automation Level'].map(text => ({
        type: 'tableHeader',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text }]
          }
        ]
      }))
    };

    const priorityEmoji = { Smoke: '🔴', 'Critical Path': '🟡', Regression: '🟢' };

    const bodyRows = a.testRecipe.map(t => {
      const scenarioDisplay = String(t.scenario || '').replace(/\n/g, ' → ');
      const prioEmoji = priorityEmoji[t.priority] || '🟡';
      const priorityText = `${prioEmoji} ${t.priority}`;

      const cells = [
        t.name,
        scenarioDisplay,
        priorityText,
        t.automationLevel || ''
      ].map(text => ({
        type: 'tableCell',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: text || '' }]
          }
        ]
      }));

      return {
        type: 'tableRow',
        content: cells
      };
    });

    content.push({
      type: 'table',
      content: [headerRow, ...bodyRows]
    });
  }

  // Footer
  content.push({ type: 'rule' });
  content.push({
    type: 'paragraph',
    content: [
      { type: 'text', text: '🤖 QA Analysis by ' },
      { type: 'text', text: 'Ovi (the AI QA)', marks: [{ type: 'strong' }] }
    ]
  });

  return {
    type: 'doc',
    version: 1,
    content
  };
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
  postComment
};
