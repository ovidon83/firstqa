const crypto = require('crypto');

const FEEDBACK_SECRET = process.env.WEBHOOK_SECRET || 'firstqa-feedback-secret';
const BASE_URL = process.env.BASE_URL || 'https://www.firstqa.dev';

function generateAnalysisId() {
  return crypto.randomUUID();
}

function signFeedbackToken(analysisId, vote) {
  return crypto.createHmac('sha256', FEEDBACK_SECRET)
    .update(`${analysisId}:${vote}`)
    .digest('hex')
    .slice(0, 16);
}

function verifyFeedbackToken(analysisId, vote, token) {
  if (!token || token.length !== 16) return false;
  const expected = signFeedbackToken(analysisId, vote);
  try {
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

function feedbackFooter(analysisId) {
  const upToken = signFeedbackToken(analysisId, 'positive');
  const downToken = signFeedbackToken(analysisId, 'negative');
  const upUrl = `${BASE_URL}/feedback/${analysisId}/positive?t=${upToken}`;
  const downUrl = `${BASE_URL}/feedback/${analysisId}/negative?t=${downToken}`;
  return `\n*Was this analysis helpful?* [👍 Yes](${upUrl}) · [👎 No](${downUrl})`;
}

module.exports = { generateAnalysisId, signFeedbackToken, verifyFeedbackToken, feedbackFooter };
