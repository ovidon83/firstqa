/**
 * Slack Service - Fetches discussion context from Slack threads linked in Linear tickets
 * Extracts thread messages for AI analysis context
 */

const SLACK_URL_PATTERN = /([a-z0-9-]+\.)?slack\.com\/archives\/([A-Z0-9]+)\/p(\d+)/;

/**
 * Check if a URL is a Slack thread URL
 */
function isSlackUrl(url) {
  return SLACK_URL_PATTERN.test(url);
}

/**
 * Extract channel ID and thread timestamp from Slack URLs
 */
function extractSlackThreadInfo(urls) {
  const results = [];
  for (const url of urls) {
    const match = url.match(SLACK_URL_PATTERN);
    if (match) {
      const channelId = match[2];
      const rawTs = match[3];
      const threadTs = rawTs.slice(0, 10) + '.' + rawTs.slice(10);
      results.push({ channelId, threadTs, url });
    }
  }
  return results;
}

/**
 * Fetch thread messages from Slack API
 */
async function fetchSlackThread(channelId, threadTs, token) {
  if (!token) return null;

  try {
    const response = await fetch(`https://slack.com/api/conversations.replies?channel=${channelId}&ts=${threadTs}&limit=10`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await response.json();
    if (!data.ok) {
      console.warn(`Slack API error for channel ${channelId}:`, data.error);
      return null;
    }

    return (data.messages || [])
      .filter(m => !m.bot_id && m.text)
      .slice(0, 10)
      .map(m => ({
        user: m.user || 'unknown',
        text: m.text.substring(0, 500),
        ts: m.ts
      }));
  } catch (err) {
    console.error(`Slack fetch failed for ${channelId}:`, err.message);
    return null;
  }
}

/**
 * Format Slack messages as prompt context
 */
function formatSlackContextForPrompt(messages) {
  if (!messages || messages.length === 0) return null;

  const lines = messages.map((m, i) => `${i + 1}. ${m.text}`);
  return `## DISCUSSION CONTEXT (from Slack)\n\n${lines.join('\n')}`;
}

module.exports = {
  isSlackUrl,
  extractSlackThreadInfo,
  fetchSlackThread,
  formatSlackContextForPrompt
};
