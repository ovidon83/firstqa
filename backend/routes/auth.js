/**
 * Authentication Routes
 * Handles user signup, login, logout, and OAuth flows
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * Auto-sync GitHub App installations for the logged-in user
 * This runs in the background after login to link any existing installations
 */
/**
 * Auto-sync GitHub App installations for the logged-in user
 * This runs in the background after login to link any existing installations
 * 
 * ACCOUNT LINKING LOGIC:
 * 1. Find other accounts with the same email and merge their data
 * 2. Link all GitHub App installations to this user
 * 3. Use upsert to handle duplicates gracefully
 */
async function autoSyncGitHubInstallations(userId, userEmail) {
  console.log(`🔄 [AUTO-SYNC] Starting for user ${userEmail} (ID: ${userId})`);
  
  try {
    if (!isSupabaseConfigured()) {
      console.log('⏭️  [AUTO-SYNC] Skipping: Supabase not configured');
      return;
    }

    // STEP 1: Account Linking - Find other accounts with same email
    console.log(`🔗 [ACCOUNT-LINK] Checking for duplicate accounts with email ${userEmail}`);
    const { data: sameEmailUsers, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('email', userEmail);
    
    if (userError) {
      console.error('❌ [ACCOUNT-LINK] Error fetching users:', userError);
    } else if (sameEmailUsers && sameEmailUsers.length > 1) {
      const otherUserIds = sameEmailUsers
        .filter(u => u.id !== userId)
        .map(u => u.id);
      
      console.log(`🔗 [ACCOUNT-LINK] Found ${otherUserIds.length} duplicate account(s) to merge`);
      
      // Transfer integrations and analyses from duplicate accounts
      for (const otherUserId of otherUserIds) {
        console.log(`🔗 [ACCOUNT-LINK] Merging account ${otherUserId} into ${userId}`);
        
        // Get integrations from the other account
        const { data: oldIntegrations } = await supabaseAdmin
          .from('integrations')
          .select('*')
          .eq('user_id', otherUserId);
        
        if (oldIntegrations && oldIntegrations.length > 0) {
          console.log(`🔗 [ACCOUNT-LINK] Found ${oldIntegrations.length} integration(s) to transfer`);
          
          // For each integration, upsert it to the current user
          for (const integration of oldIntegrations) {
            const { error: upsertError } = await supabaseAdmin
              .from('integrations')
              .upsert({
                user_id: userId, // Change to current user
                provider: integration.provider,
                account_id: integration.account_id,
                account_name: integration.account_name,
                account_avatar: integration.account_avatar,
                access_token: integration.access_token,
                refresh_token: integration.refresh_token,
                token_expires_at: integration.token_expires_at,
                scopes: integration.scopes,
                updated_at: new Date().toISOString()
              }, {
                onConflict: 'provider,account_id', // Use unique index
                ignoreDuplicates: false // Update if exists
              });
            
            if (upsertError && upsertError.code !== '23505') {
              console.error(`❌ [ACCOUNT-LINK] Error upserting integration:`, upsertError);
            } else {
              console.log(`✅ [ACCOUNT-LINK] Transferred ${integration.provider} integration ${integration.account_id}`);
            }
          }
          
          // Delete old integrations
          await supabaseAdmin
            .from('integrations')
            .delete()
            .eq('user_id', otherUserId);
        }
        
        // Transfer analyses
        const { error: analysesError } = await supabaseAdmin
          .from('analyses')
          .update({ user_id: userId })
          .eq('user_id', otherUserId);
        
        if (analysesError) {
          console.error(`❌ [ACCOUNT-LINK] Error transferring analyses:`, analysesError);
        } else {
          console.log(`✅ [ACCOUNT-LINK] Transferred analyses from account ${otherUserId}`);
        }
        
        // Note: Don't delete the duplicate user account yet - it's tied to auth.users
        // Just log it for manual cleanup
        console.log(`ℹ️  [ACCOUNT-LINK] Duplicate account ${otherUserId} should be manually deleted from Supabase Auth`);
      }
    } else {
      console.log(`✅ [ACCOUNT-LINK] No duplicate accounts found`);
    }

    // STEP 2: Do NOT sync all GitHub App installations on login.
    // apps.listInstallations() returns ALL installations of the app across the platform,
    // which would incorrectly assign every org's installation to any user who logs in.
    // Users get installations only when they explicitly go through the GitHub App
    // install flow (/github/install-redirect -> install on org -> /github/install-callback).
    console.log(`⏭️  [AUTO-SYNC] Skipping GitHub installations sync on login (user must install app via Connect GitHub)`);
  } catch (error) {
    console.error('❌ [AUTO-SYNC] Fatal error:', error);
    console.error('❌ [AUTO-SYNC] Stack trace:', error.stack);
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

    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    // Create user with Supabase Auth
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: name
        },
        emailRedirectTo: `${baseUrl}/auth/callback`
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
      const redirect = req.body.redirect && String(req.body.redirect).startsWith('/') && !String(req.body.redirect).startsWith('//');
      return res.redirect(redirect ? req.body.redirect : '/dashboard');
    }

    const redirectParam = req.body.redirect ? '&redirect=' + encodeURIComponent(req.body.redirect) : '';
    res.redirect('/login?success=' + encodeURIComponent('Account created! Please log in.') + redirectParam);
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
    const redirect = req.body.redirect && String(req.body.redirect).startsWith('/') && !String(req.body.redirect).startsWith('//');
    res.redirect(redirect ? req.body.redirect : '/dashboard');
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

    // Store redirect for use after OAuth callback
    const redirect = req.query.redirect && String(req.query.redirect).startsWith('/') && !String(req.query.redirect).startsWith('//');
    if (redirect) req.session.authRedirect = req.query.redirect;

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
    // GitHub OAuth: sync installations for this user (they signed up/logged in via GitHub)
    autoSyncGitHubInstallations(data.user.id, data.user.email).catch(err => {
      console.error('Background sync error:', err);
    });
    const savedRedirect = req.session.authRedirect;
    delete req.session.authRedirect;
    const isValidRedirect = savedRedirect && String(savedRedirect).startsWith('/') && !String(savedRedirect).startsWith('//');
    res.redirect(isValidRedirect ? savedRedirect : '/dashboard');
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
