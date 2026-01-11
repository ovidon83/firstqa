/**
 * Authentication Routes
 * Handles user signup, login, logout, and OAuth flows
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const { Octokit } = require('@octokit/rest');
const githubAppAuth = require('../utils/githubAppAuth');

/**
 * Auto-sync GitHub App installations for the logged-in user
 * This runs in the background after login to link any existing installations
 */
async function autoSyncGitHubInstallations(userId, userEmail) {
  console.log(`🔄 [AUTO-SYNC] Starting for user ${userEmail} (ID: ${userId})`);
  
  try {
    console.log(`🔄 [AUTO-SYNC] Step 1: Check Supabase configured`);
    if (!isSupabaseConfigured()) {
      console.log('⏭️  [AUTO-SYNC] Skipping: Supabase not configured');
      return;
    }
    console.log(`✅ [AUTO-SYNC] Supabase is configured`);

    console.log(`🔄 [AUTO-SYNC] Step 2: Get GitHub App JWT`);
    const jwt = githubAppAuth.getGitHubAppJWT();
    if (!jwt) {
      console.log('⏭️  [AUTO-SYNC] Skipping: GitHub App not configured');
      return;
    }
    console.log(`✅ [AUTO-SYNC] GitHub App JWT obtained`);

    console.log(`🔄 [AUTO-SYNC] Step 3: List GitHub App installations`);
    const appOctokit = new Octokit({ auth: jwt });
    const { data: installations } = await appOctokit.apps.listInstallations();
    console.log(`✅ [AUTO-SYNC] Found ${installations.length} installation(s)`);
    
    if (installations.length > 0) {
      console.log(`📋 [AUTO-SYNC] Installation IDs:`, installations.map(i => `${i.id} (${i.account.login})`).join(', '));
    }

    if (installations.length === 0) {
      console.log(`⏭️  [AUTO-SYNC] No GitHub App installations found for ${userEmail}`);
      return;
    }

    console.log(`🔍 [AUTO-SYNC] Processing ${installations.length} installation(s) for ${userEmail}`);

    let synced = 0;

    for (const installation of installations) {
      try {
        console.log(`🔄 [AUTO-SYNC] Checking installation ${installation.id} (${installation.account.login})`);
        
        // Check if this installation is already linked to ANY user
        // Use .limit(1) instead of .single() to handle potential duplicates
        const { data: existingIntegrations, error: fetchError } = await supabaseAdmin
          .from('integrations')
          .select('id, user_id')
          .eq('provider', 'github')
          .eq('account_id', installation.id.toString())
          .limit(1);
        
        if (fetchError) {
          console.error(`❌ [AUTO-SYNC] Error fetching integration:`, fetchError);
          continue;
        }

        if (existingIntegrations && existingIntegrations.length > 0) {
          const existingIntegration = existingIntegrations[0];
          // If it's already linked to THIS user, skip
          if (existingIntegration.user_id === userId) {
            console.log(`✅ [AUTO-SYNC] Installation ${installation.id} already linked to ${userEmail}`);
            continue;
          }
          // If it's linked to a DIFFERENT user, skip (don't steal installations)
          console.log(`⏭️  [AUTO-SYNC] Installation ${installation.id} already linked to another user`);
          continue;
        }

        // Not linked to anyone - link it to this user without verification
        // (simpler approach - just link all unlinked installations)
        console.log(`🔗 [AUTO-SYNC] Linking installation ${installation.id} to ${userEmail}...`);
        
        const { data, error } = await supabaseAdmin
          .from('integrations')
          .insert({
            user_id: userId,
            provider: 'github',
            access_token: '', // GitHub App uses JWT/installation tokens
            account_id: installation.id.toString(),
            account_name: installation.account.login,
            account_avatar: installation.account.avatar_url,
            scopes: installation.permissions ? Object.keys(installation.permissions) : []
          })
          .select();

        if (error) {
          console.error(`❌ [AUTO-SYNC] Error linking installation ${installation.id}:`, error);
        } else {
          console.log(`✅ [AUTO-SYNC] Linked installation ${installation.id} (${installation.account.login}) to ${userEmail}`);
          synced++;
        }
      } catch (error) {
        console.error(`❌ [AUTO-SYNC] Error processing installation ${installation.id}:`, error);
      }
    }

    console.log(`📊 [AUTO-SYNC] Summary: Synced ${synced} of ${installations.length} installation(s) for ${userEmail}`);
    
    if (synced > 0) {
      console.log(`🎉 [AUTO-SYNC] Successfully synced ${synced} GitHub installation(s) for ${userEmail}`);
    } else {
      console.log(`ℹ️  [AUTO-SYNC] No new GitHub installations to sync for ${userEmail}`);
    }
  } catch (error) {
    console.error('❌ [AUTO-SYNC] Fatal error:', error);
    console.error('❌ [AUTO-SYNC] Stack trace:', error.stack);
    // Don't throw - this is a background operation
  }
}

// ===========================================
// EMAIL/PASSWORD AUTH
// ===========================================

/**
 * POST /auth/signup - Handle email/password signup
 */
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!isSupabaseConfigured()) {
      console.error('Supabase not configured');
      return res.redirect('/signup?error=' + encodeURIComponent('Authentication service unavailable'));
    }

    if (!email || !password) {
      return res.redirect('/signup?error=' + encodeURIComponent('Email and password are required'));
    }

    if (password.length < 8) {
      return res.redirect('/signup?error=' + encodeURIComponent('Password must be at least 8 characters'));
    }

    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name
        }
      }
    });

    if (error) {
      console.error('Signup error:', error.message);
      return res.redirect('/signup?error=' + encodeURIComponent(error.message));
    }

    // Check if email confirmation is required
    if (data.user && !data.session) {
      // Email confirmation required
      return res.redirect('/login?success=' + encodeURIComponent('Check your email to confirm your account'));
    }

    // If session exists, user is logged in immediately
    if (data.session) {
      req.session.user = {
        id: data.user.id,
        email: data.user.email,
        name: data.user.user_metadata?.full_name || name
      };
      req.session.accessToken = data.session.access_token;
      req.session.refreshToken = data.session.refresh_token;
      
      // Auto-sync GitHub App installations in the background
      autoSyncGitHubInstallations(data.user.id, data.user.email).catch(err => {
        console.error('Background sync error:', err);
      });
      
      return res.redirect('/dashboard');
    }

    res.redirect('/login?success=' + encodeURIComponent('Account created! Please log in.'));
  } catch (error) {
    console.error('Signup error:', error);
    res.redirect('/signup?error=' + encodeURIComponent('An error occurred during signup'));
  }
});

/**
 * POST /auth/login - Handle email/password login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!isSupabaseConfigured()) {
      console.error('Supabase not configured');
      return res.redirect('/login?error=' + encodeURIComponent('Authentication service unavailable'));
    }

    if (!email || !password) {
      return res.redirect('/login?error=' + encodeURIComponent('Email and password are required'));
    }

    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      console.error('Login error:', error.message);
      return res.redirect('/login?error=' + encodeURIComponent(error.message));
    }

    // Store user in session
    req.session.user = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.email.split('@')[0],
      avatarUrl: data.user.user_metadata?.avatar_url
    };
    req.session.accessToken = data.session.access_token;
    req.session.refreshToken = data.session.refresh_token;

    console.log(`✅ User logged in: ${data.user.email}`);
    
    // Auto-sync GitHub App installations in the background
    autoSyncGitHubInstallations(data.user.id, data.user.email).catch(err => {
      console.error('Background sync error:', err);
    });
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.redirect('/login?error=' + encodeURIComponent('An error occurred during login'));
  }
});

// ===========================================
// GITHUB OAUTH
// ===========================================

/**
 * GET /auth/github - Initiate GitHub OAuth flow
 */
router.get('/github', async (req, res) => {
  try {
    if (!isSupabaseConfigured()) {
      console.error('Supabase not configured');
      return res.redirect('/login?error=' + encodeURIComponent('Authentication service unavailable'));
    }

    // Get the OAuth URL from Supabase
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/callback`
      }
    });

    if (error) {
      console.error('GitHub OAuth error:', error.message);
      return res.redirect('/login?error=' + encodeURIComponent('Failed to initiate GitHub login'));
    }

    // Redirect to GitHub
    res.redirect(data.url);
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect('/login?error=' + encodeURIComponent('An error occurred'));
  }
});

/**
 * GET /auth/callback - Handle OAuth callback
 */
router.get('/callback', async (req, res) => {
  try {
    console.log('🔄 OAuth callback received');
    console.log('Query params:', req.query);
    
    const { code, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error('OAuth callback error:', oauthError, error_description);
      return res.redirect('/login?error=' + encodeURIComponent(error_description || oauthError));
    }

    if (!code) {
      console.error('No code in callback. Query:', req.query);
      return res.redirect('/login?error=' + encodeURIComponent('No authorization code received'));
    }

    console.log('📝 Exchanging code for session...');
    // Exchange code for session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      console.error('Token exchange error:', error.message);
      return res.redirect('/login?error=' + encodeURIComponent(error.message));
    }

    // Store user in session
    req.session.user = {
      id: data.user.id,
      email: data.user.email,
      name: data.user.user_metadata?.full_name || data.user.user_metadata?.name || data.user.email?.split('@')[0],
      avatarUrl: data.user.user_metadata?.avatar_url
    };
    req.session.accessToken = data.session.access_token;
    req.session.refreshToken = data.session.refresh_token;

    console.log(`✅ User logged in via GitHub: ${data.user.email}`);
    
    // Auto-sync GitHub App installations in the background
    autoSyncGitHubInstallations(data.user.id, data.user.email).catch(err => {
      console.error('Background sync error:', err);
    });
    
    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/login?error=' + encodeURIComponent('Authentication failed'));
  }
});

// ===========================================
// MANUAL GITHUB SYNC (for immediate testing/fixing)
// ===========================================

/**
 * GET /auth/sync-github - Manually trigger GitHub installations sync
 * This is useful for users who installed the app before logging in
 */
router.get('/sync-github', async (req, res) => {
  if (!req.session?.user) {
    console.log('❌ [MANUAL-SYNC] No user in session');
    return res.redirect('/login?error=' + encodeURIComponent('Please log in first'));
  }

  try {
    const userId = req.session.user.id;
    const userEmail = req.session.user.email;

    console.log(`🔄 [MANUAL-SYNC] GitHub sync requested by ${userEmail} (ID: ${userId})`);
    
    // Run the sync function
    await autoSyncGitHubInstallations(userId, userEmail);
    
    console.log(`✅ [MANUAL-SYNC] Sync completed for ${userEmail}`);
    return res.redirect('/dashboard?success=' + encodeURIComponent('GitHub installations synced successfully!'));
  } catch (error) {
    console.error('❌ [MANUAL-SYNC] Fatal error:', error);
    console.error('❌ [MANUAL-SYNC] Stack trace:', error.stack);
    return res.redirect('/dashboard?error=' + encodeURIComponent('Failed to sync GitHub installations'));
  }
});

// ===========================================
// LOGOUT
// ===========================================

/**
 * GET /auth/logout - Log out user
 */
router.get('/logout', async (req, res) => {
  try {
    // Sign out from Supabase if configured
    if (isSupabaseConfigured() && req.session?.accessToken) {
      await supabase.auth.signOut();
    }

    // Destroy session
    req.session.destroy((err) => {
      if (err) {
        console.error('Session destroy error:', err);
      }
      res.redirect('/');
    });
  } catch (error) {
    console.error('Logout error:', error);
    req.session.destroy(() => {
      res.redirect('/');
    });
  }
});

// ===========================================
// PASSWORD RESET
// ===========================================

/**
 * GET /auth/forgot-password - Show forgot password page
 */
router.get('/forgot-password', (req, res) => {
  res.render('auth/forgot-password', {
    error: req.query.error,
    success: req.query.success
  });
});

/**
 * POST /auth/forgot-password - Send password reset email
 */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!isSupabaseConfigured()) {
      return res.redirect('/auth/forgot-password?error=' + encodeURIComponent('Service unavailable'));
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/reset-password`
    });

    if (error) {
      console.error('Password reset error:', error.message);
      return res.redirect('/auth/forgot-password?error=' + encodeURIComponent(error.message));
    }

    res.redirect('/login?success=' + encodeURIComponent('Check your email for password reset instructions'));
  } catch (error) {
    console.error('Password reset error:', error);
    res.redirect('/auth/forgot-password?error=' + encodeURIComponent('An error occurred'));
  }
});

module.exports = router;
