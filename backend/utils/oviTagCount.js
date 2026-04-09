const { supabaseAdmin } = require('../lib/supabase');

// Offset accounts for analyses that happened before DB tracking started.
// Displayed count = DB row count + BASELINE_OFFSET
// Calibrated so that the counter starts at 187 when DB has 90 rows.
const BASELINE_OFFSET = 97;
const FALLBACK_COUNT = 187;

let cachedCount = null;
let cacheExpiry = 0;
const CACHE_TTL = 60_000;

async function getCount() {
  if (cachedCount !== null && Date.now() < cacheExpiry) {
    return cachedCount;
  }

  if (!supabaseAdmin) {
    return FALLBACK_COUNT;
  }

  try {
    const { count, error } = await supabaseAdmin
      .from('analyses')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    cachedCount = (count || 0) + BASELINE_OFFSET;
    cacheExpiry = Date.now() + CACHE_TTL;
    return cachedCount;
  } catch (err) {
    console.warn('oviTagCount: Supabase query failed', err.message);
    return cachedCount || FALLBACK_COUNT;
  }
}

module.exports = { getCount };
