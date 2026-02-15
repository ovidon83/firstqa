/**
 * Supabase Client Configuration
 * 
 * This module provides configured Supabase clients for:
 * - Public client (for client-side/auth operations)
 * - Admin client (for server-side operations with elevated permissions)
 */

const { createClient } = require('@supabase/supabase-js');

// Environment variables
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

// Validate required environment variables
if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('⚠️ Supabase environment variables not configured');
  console.warn('   Set SUPABASE_URL and SUPABASE_ANON_KEY in your .env file');
}

/**
 * Public Supabase client
 * Use this for client-side operations and user authentication
 * Respects Row Level Security (RLS) policies
 */
const supabase = supabaseUrl && supabaseAnonKey 
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false, // Server-side: don't persist
        detectSessionInUrl: true,
        flowType: 'pkce' // Required for server-side OAuth
      }
    })
  : null;

/**
 * Admin Supabase client
 * Use this for server-side operations that need to bypass RLS
 * NEVER expose this client to the frontend
 */
const supabaseAdmin = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

/**
 * Check if Supabase is properly configured
 * @returns {boolean}
 */
function isSupabaseConfigured() {
  return !!(supabase && supabaseAdmin);
}

/**
 * Test Supabase connection
 * @returns {Promise<{success: boolean, message: string}>}
 */
async function testConnection() {
  if (!isSupabaseConfigured()) {
    return { 
      success: false, 
      message: 'Supabase not configured - missing environment variables' 
    };
  }

  try {
    // Test with a simple query
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('count')
      .limit(1);

    if (error && error.code !== 'PGRST116') {
      // PGRST116 = table doesn't exist yet, which is fine for initial setup
      throw error;
    }

    return { 
      success: true, 
      message: 'Supabase connection successful' 
    };
  } catch (error) {
    return { 
      success: false, 
      message: `Supabase connection failed: ${error.message}` 
    };
  }
}

// Log configuration status on module load
if (isSupabaseConfigured()) {
  console.log('✅ Supabase client initialized');
} else {
  console.warn('⚠️ Supabase client not initialized - check environment variables');
}

module.exports = {
  supabase,
  supabaseAdmin,
  isSupabaseConfigured,
  testConnection
};
