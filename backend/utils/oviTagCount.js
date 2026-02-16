/**
 * Persisted count of how many times /qa was used in PRs and tickets (GitHub, Linear, Jira, Bitbucket).
 * Used for the landing page "Times Ovi Tagged" stat. Baseline 182 = historical count before tracking.
 */
const fs = require('fs');
const path = require('path');

const COUNT_FILE = path.join(__dirname, '../../data/ovi-tag-count.json');
const DEFAULT_COUNT = 182;

function ensureDataDir() {
  const dir = path.dirname(COUNT_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readCount() {
  try {
    if (fs.existsSync(COUNT_FILE)) {
      const data = JSON.parse(fs.readFileSync(COUNT_FILE, 'utf8'));
      return typeof data.count === 'number' ? data.count : DEFAULT_COUNT;
    }
  } catch (err) {
    console.warn('oviTagCount: read failed', err.message);
  }
  return DEFAULT_COUNT;
}

/**
 * Get current count (for API). Does not modify.
 */
function getCount() {
  return readCount();
}

/**
 * Increment the count by 1 and persist. Call when a /qa command is accepted and will be processed.
 */
function increment() {
  ensureDataDir();
  const count = readCount() + 1;
  try {
    fs.writeFileSync(
      COUNT_FILE,
      JSON.stringify({ count, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
    return count;
  } catch (err) {
    console.warn('oviTagCount: increment write failed', err.message);
    return readCount();
  }
}

module.exports = { getCount, increment };
