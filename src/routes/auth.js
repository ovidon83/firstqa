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
  try {
    if (!isSupabaseConfigured()) {
      console.log('⏭️  Skipping GitHub sync: Supabase not configured');
      return;
    }

    const jwt = githubAppAuth.getGitHubAppJWT();
    if (!jwt) {
      console.log('⏭️  Skipping GitHub sync: GitHub App not configured');
      return;
    }

    const appOctokit = new Octokit({ auth: jwt });
    const { data: installations } = await appOctokit.apps.listInstallations();

    if (installations.length === 0) {
      console.log(`⏭️  No GitHub App installations found to sync for ${userEmail}`);
      return;
    }

    console.log(`🔍 Auto-syncing ${installations.length} GitHub App installation(s) for ${userEmail}`);

    let synced = 0;

    for (const installation of installations) {
      try {
        // Check if this installation is already linked to ANY user
        const { data: existingIntegration } = await supabaseAdmin
          .from('integrations')
          .select('id, user_id')
          .eq('provider', 'github')
          .eq('account_id', installation.id.toString())
          .single();

        if (existingIntegration) {
          // If it's already linked to THIS user, skip
          if (existingIntegration.user_id === userId) {
            console.log(`✅ Installation ${installation.id} already linked to ${userEmail}`);
            continue;
          }
          // If it's linked to a DIFFERENT user, skip (don't steal installations)
          console.log(`⏭️  Installation ${installation.id} already linked to another user`);
          continue;
        }

        // Not linked to anyone - let's check if we should link it to this user
        // We'll use GitHub API to check if user has access to this installation
        try {
          const installationOctokit = new Octokit({
            auth: await githubAppAuth.getInstallationToken(installation.id)
          });
          
          // Try to get installation details to verify access
          const { data: installDetails } = await installationOctokit.apps.getInstallation({
            installation_id: installation.id
          });
          
          // Link this installation to the user
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
            console.error(`❌ Error linking installation ${installation.id}:`, error);
          } else {
            console.log(`✅ Linked GitHub installation ${installation.id} (${installation.account.login}) to ${userEmail}`);
            synced++;
          }
        } catch (installError) {
          console.log(`⏭️  Couldn't verify access to installation ${installation.id}, skipping`);
        }
      } catch (error) {
        console.error(`❌ Error processing installation ${installation.id}:`, error);
      }
    }

    if (synced > 0) {
      console.log(`🎉 Auto-synced ${synced} GitHub installation(s) for ${userEmail}`);
    } else {
      console.log(`ℹ️  No new GitHub installations to sync for ${userEmail}`);
    }
  } catch (error) {
    console.error('❌ Error in auto-sync GitHub installations:', error);
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
    return res.redirect('/login?error=' + encodeURIComponent('Please log in first'));
  }

  try {
    const userId = req.session.user.id;
    const userEmail = req.session.user.email;

    console.log(`🔄 Manual GitHub sync requested by ${userEmail}`);
    
    // Run the sync function
    await autoSyncGitHubInstallations(userId, userEmail);
    
    return res.redirect('/dashboard?success=' + encodeURIComponent('GitHub installations synced successfully!'));
  } catch (error) {
    console.error('Manual GitHub sync error:', error);
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
