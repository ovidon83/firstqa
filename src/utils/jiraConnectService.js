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

    console.log(`Issue: ${issue.key}`);
    console.log(`Comment by: ${comment.author?.displayName}`);
    console.log(`Comment body:`, JSON.stringify(comment.body, null, 2));

    // Extract text from comment
    const commentText = extractTextFromComment(comment);
    console.log(`Extracted text: "${commentText}"`);

    // Check for /qa command
    if (!commentText.trim().toLowerCase().startsWith('/qa')) {
      console.log('Skipping comment without /qa command');
      return { success: true, message: 'Not a /qa command' };
    }

    console.log('🧪 /qa command detected!');

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

    // Post analysis as comment
    const analysisComment = formatAnalysisComment(aiInsights.data);
    await postComment(issue.key, analysisComment, installation);

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

  // Build full API URL with query params
  const apiPath = `/rest/api/3/issue/${issueKey}`;
  const queryParams = 'expand=renderedFields,names,schema,operations,editmeta,changelog,versionedRepresentations,comments';
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

  // Defensive validation
  if (!response.data || !response.data.fields) {
    console.error('❌ Unexpected Jira issue payload:', {
      status: response.status,
      contentType: response.headers['content-type'],
      url: fullUrl,
      dataPreview: JSON.stringify(response.data).substring(0, 500)
    });
    throw new Error('Unexpected Jira issue payload: missing fields');
  }

  const issue = response.data;
  
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
      body: extractTextFromComment(c),
      created: c.created
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
    const response = await axios.post(
      fullUrl,
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

/**
 * Format AI analysis as comment
 */
function formatAnalysisComment(analysis) {
  let comment = '🤖 **FirstQA Analysis**\n\n';
  
  if (analysis.smartQuestions && analysis.smartQuestions.length > 0) {
    comment += '**Key Questions:**\n';
    analysis.smartQuestions.forEach((q, i) => {
      comment += `${i + 1}. ${q}\n`;
    });
    comment += '\n';
  }

  if (analysis.riskAreas && analysis.riskAreas.length > 0) {
    comment += '**Risk Areas:**\n';
    analysis.riskAreas.forEach((risk, i) => {
      comment += `${i + 1}. ${risk}\n`;
    });
    comment += '\n';
  }

  if (analysis.testRecipe && analysis.testRecipe.length > 0) {
    comment += '**Test Scenarios:**\n';
    analysis.testRecipe.forEach((test, i) => {
      comment += `\n**${i + 1}. ${test.name}**\n`;
      comment += `Priority: ${test.priority || 'Medium'}\n`;
      if (test.steps) {
        comment += 'Steps:\n';
        test.steps.forEach((step, j) => {
          comment += `  ${j + 1}. ${step}\n`;
        });
      }
      if (test.expectedResult) {
        comment += `Expected: ${test.expectedResult}\n`;
      }
    });
    comment += '\n';
  }

  if (analysis.readyForDevelopmentScore !== undefined) {
    const score = analysis.readyForDevelopmentScore;
    const emoji = score >= 80 ? '✅' : score >= 60 ? '⚠️' : '❌';
    comment += `\n${emoji} **Ready for Development: ${score}%**\n`;
  }

  comment += '\n---\n_Generated by FirstQA - AI-powered QA analysis_';

  return comment;
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
        integration_id: installationId,
        provider: provider,
        repository: issueKey,
        pr_number: 0,
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

    console.log(`✅ Analysis saved to database`);
    return savedAnalysis;
  } catch (error) {
    console.error('❌ Failed to save analysis:', error);
    // Don't throw - analysis was successful even if DB save failed
  }
}

module.exports = {
  processConnectWebhook,
  fetchTicketDetails,
  postComment,
  formatAnalysisComment
};
