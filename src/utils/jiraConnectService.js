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
 * Intelligently splits strings and removes existing numbering to avoid duplication
 */
function asSteps(val) {
  if (Array.isArray(val)) {
    return val.map(asString).filter(Boolean).map(cleanStepNumber);
  }
  if (typeof val === 'string') {
    // Split by newlines, numbered lists (1. or 1) ), or sentence boundaries
    let steps = [];
    
    // First try splitting by newlines (most common)
    const lines = val.split('\n').map(s => s.trim()).filter(Boolean);
    
    if (lines.length > 1) {
      // Multiple lines - use as steps
      steps = lines;
    } else {
      // Single line - try splitting by numbered patterns or sentences
      const numbered = val.split(/(?=\d+[\).\s]+)/).map(s => s.trim()).filter(Boolean);
      if (numbered.length > 1) {
        steps = numbered;
      } else {
        // Try splitting by sentence boundaries (. followed by capital letter or end)
        const sentences = val.split(/\.\s+(?=[A-Z])/).map(s => s.trim()).filter(Boolean);
        steps = sentences.length > 1 ? sentences : [val];
      }
    }
    
    // Clean up numbering from each step
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
 * Remove leading numbers/bullets from step text (e.g., "1. " or "- ")
 */
function cleanStepNumber(step) {
  if (typeof step !== 'string') return asString(step);
  // Remove patterns like "1. ", "1) ", "- ", "• ", etc.
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
 * Format comprehensive AI analysis as Jira comment (robust, never throws)
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
          // Fallback to Happy Path for unknown priorities
          priorityGroups['Happy Path'].push(test);
        }
      });
      
      // Output tests in priority order
      let testNum = 1;
      ['Happy Path', 'Critical Path', 'Edge Case', 'Regression'].forEach(priority => {
        const tests = priorityGroups[priority];
        if (tests.length > 0) {
          comment += `[${priority}]\n`;
          
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
    // Fallback to minimal comment
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
