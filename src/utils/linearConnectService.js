/**
 * Linear Connect Service
 * Handles webhook processing and GraphQL API calls for Linear
 */

const axios = require('axios');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

// Linear GraphQL API endpoint
const LINEAR_API_URL = 'https://api.linear.app/graphql';

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
 * Normalize AI analysis to safe structure (comprehensive format)
 * Reuses the same format as Jira
 */
function normalizeAnalysis(analysis) {
  const normalized = {
    // Questions & Risks (merged from qaQuestions and keyRisks)
    qaQuestions: asStringArray(analysis.qaQuestions || analysis.smartQuestions || []),
    keyRisks: asStringArray(analysis.keyRisks || analysis.riskAreas || []),
    
    // Ready for Dev
    initialReadinessScore: analysis.initialReadinessScore || analysis.readyForDevScoreNow,
    readyForDevelopmentScore: analysis.readyForDevelopmentScore || analysis.readyForDevScoreAfter,
    needsQA: asString(analysis.readyForDevPulse?.needsQA || 'Recommended'),
    needsQAReason: asString(analysis.readyForDevPulse?.needsQAReason || ''),
    
    // Improvements
    improvementsNeeded: asStringArray(analysis.improvementsNeeded || []),
    
    // Test Recipe
    testRecipe: [],
    
    // Score Breakdown
    scoreBreakdown: analysis.scoreBreakdown || null,
    
    // Tip & Missing Info
    tip: asString(analysis.tip || ''),
    missingInfo: asStringArray(analysis.missingInfo || [])
  };

  // Normalize test recipe
  let rawRecipe = analysis.testRecipe;
  if (!Array.isArray(rawRecipe)) {
    if (typeof rawRecipe === 'string') {
      rawRecipe = [{
        name: 'Test Scenario',
        steps: rawRecipe
      }];
    } else if (rawRecipe && typeof rawRecipe === 'object') {
      rawRecipe = [rawRecipe];
    } else {
      rawRecipe = [];
    }
  }

  normalized.testRecipe = rawRecipe.map((test, i) => ({
    name: asString(test.name || test.title || test.scenario || `Scenario ${i + 1}`),
    priority: asString(test.priority || test.severity || 'Medium'),
    steps: asSteps(test.steps || test.step || test.instructions),
    expectedResult: asString(test.expectedResult || test.expected || test.assertion || ''),
    automation: asString(test.automation || ''),
    reason: asString(test.reason || '')
  }));

  // Validate scores
  if (typeof normalized.readyForDevelopmentScore !== 'number') {
    const parsed = parseInt(asString(normalized.readyForDevelopmentScore), 10);
    normalized.readyForDevelopmentScore = !isNaN(parsed) ? parsed : undefined;
  }
  
  if (typeof normalized.initialReadinessScore !== 'number') {
    const parsed = parseInt(asString(normalized.initialReadinessScore), 10);
    normalized.initialReadinessScore = !isNaN(parsed) ? parsed : undefined;
  }

  return normalized;
}

/**
 * Format comprehensive AI analysis as Linear comment (markdown format)
 * Reuses the same comprehensive format as Jira
 */
function formatAnalysisComment(analysis) {
  try {
    const a = normalizeAnalysis(analysis);
    
    let comment = '🤖 FirstQA Analysis\n\n';
    
    // Ready for Development section
    if (a.readyForDevelopmentScore !== undefined) {
      comment += '📊 Ready for Development\n';
      
      // Score progression
      if (a.initialReadinessScore !== undefined) {
        comment += `Score: ${a.initialReadinessScore}/5 → ${a.readyForDevelopmentScore}/5\n`;
      } else {
        comment += `Score: ${a.readyForDevelopmentScore}/5\n`;
      }
      
      // Needs QA
      const qaEmoji = a.needsQA === 'Mandatory' ? '🔴' : a.needsQA === 'Recommended' ? '🟡' : '🟢';
      comment += `${qaEmoji} Needs QA: ${a.needsQA}`;
      if (a.needsQAReason) {
        comment += ` - ${truncate(a.needsQAReason, 200)}`;
      }
      comment += '\n\n';
    }

    // Questions & Risks (merged)
    const hasQuestions = a.qaQuestions.length > 0;
    const hasRisks = a.keyRisks.length > 0;
    
    if (hasQuestions || hasRisks) {
      comment += '❓ Questions & Risks\n';
      
      // Add questions
      a.qaQuestions.forEach((q, i) => {
        comment += `${i + 1}. ${truncate(q, 300)}\n`;
      });
      
      // Add risks (continue numbering)
      const riskStartNum = a.qaQuestions.length + 1;
      a.keyRisks.forEach((risk, i) => {
        comment += `${riskStartNum + i}. ⚠️ ${truncate(risk, 300)}\n`;
      });
      
      comment += '\n';
    }

    // Improvements Needed
    if (a.improvementsNeeded.length > 0) {
      comment += '📝 Improvements Needed\n';
      a.improvementsNeeded.forEach((improvement, i) => {
        comment += `${i + 1}. ${truncate(improvement, 300)}\n`;
      });
      comment += '\n';
    }

    // Test Scenarios (grouped by priority)
    if (a.testRecipe.length > 0) {
      comment += '🧪 Test Scenarios\n\n';
      
      // Group tests by priority
      const priorityGroups = {
        'Happy Path': [],
        'Critical Path': [],
        'Edge Case': [],
        'Regression': []
      };
      
      a.testRecipe.forEach(test => {
        const priority = test.priority;
        if (priorityGroups[priority]) {
          priorityGroups[priority].push(test);
        } else {
          priorityGroups['Happy Path'].push(test);
        }
      });
      
      // Output tests in priority order
      let testNum = 1;
      ['Happy Path', 'Critical Path', 'Edge Case', 'Regression'].forEach(priority => {
        const tests = priorityGroups[priority];
        if (tests.length > 0) {
          comment += `**[${priority}]**\n`;
          
          tests.forEach(test => {
            comment += `${testNum}. ${truncate(test.name, 200)}\n`;
            
            if (test.steps.length > 0) {
              comment += 'Steps:\n';
              test.steps.forEach((step, j) => {
                comment += `  ${j + 1}. ${truncate(step, 400)}\n`;
              });
            }
            
            if (test.expectedResult) {
              comment += `Expected: ${truncate(test.expectedResult, 300)}\n`;
            }
            
            if (test.automation) {
              comment += `Automation: ${test.automation}\n`;
            }
            
            comment += '\n';
            testNum++;
          });
        }
      });
    }

    // Score Breakdown
    if (a.scoreBreakdown) {
      const sb = a.scoreBreakdown;
      comment += '📈 Score Breakdown\n';
      if (sb.clarity !== undefined) comment += `Clarity: ${formatScoreValue(sb.clarity)}\n`;
      if (sb.dependencies !== undefined) comment += `Dependencies: ${formatScoreValue(sb.dependencies)}\n`;
      if (sb.testability !== undefined) comment += `Testability: ${formatScoreValue(sb.testability)}\n`;
      if (sb.riskProfile !== undefined) comment += `Risk Profile: ${formatScoreValue(sb.riskProfile)}\n`;
      if (sb.scopeReadiness !== undefined) comment += `Scope: ${formatScoreValue(sb.scopeReadiness)}\n`;
      comment += '\n';
    }

    // Tip
    if (a.tip) {
      comment += `💡 Tip: ${truncate(a.tip, 300)}\n\n`;
    }

    // Missing Info
    if (a.missingInfo.length > 0) {
      comment += '⚠️ Missing Info\n';
      a.missingInfo.forEach((info, i) => {
        comment += `${i + 1}. ${truncate(info, 200)}\n`;
      });
      comment += '\n';
    }

    comment += '---\nGenerated by FirstQA - AI-powered QA analysis';

    return comment;
  } catch (error) {
    console.error('❌ Error formatting analysis comment:', error);
    const keys = analysis ? Object.keys(analysis).join(', ') : 'none';
    return `🤖 FirstQA Analysis\n\n(Analysis generated, but formatting failed. Raw keys: ${keys})\n\n---\nGenerated by FirstQA`;
  }
}

/**
 * Format score breakdown values (0.0-1.0) as readable strings
 */
function formatScoreValue(value) {
  if (typeof value === 'number') {
    return `${(value * 100).toFixed(0)}%`;
  }
  return asString(value);
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
