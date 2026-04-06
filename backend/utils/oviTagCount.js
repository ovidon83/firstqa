const { supabaseAdmin } = require('../lib/supabase');

const DEFAULT_COUNT = 182;
let cachedCount = null;
let cacheExpiry = 0;
const CACHE_TTL = 60_000; // 1 minute

async function getCount() {
  if (cachedCount !== null && Date.now() < cacheExpiry) {
    return cachedCount;
  }

  if (!supabaseAdmin) {
    return DEFAULT_COUNT;
  }

  try {
    const { count, error } = await supabaseAdmin
      .from('analyses')
      .select('*', { count: 'exact', head: true });

    if (error) throw error;

    cachedCount = count || DEFAULT_COUNT;
    cacheExpiry = Date.now() + CACHE_TTL;
    return cachedCount;
  } catch (err) {
    console.warn('oviTagCount: Supabase query failed', err.message);
    return cachedCount || DEFAULT_COUNT;
  }
}

module.exports = { getCount };
