/**
 * Authentication Routes
 * Handles user signup, login, logout, and OAuth flows
 */

const express = require('express');
const router = express.Router();
const { supabase, supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

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
    const { code, error: oauthError, error_description } = req.query;

    if (oauthError) {
      console.error('OAuth callback error:', oauthError, error_description);
      return res.redirect('/login?error=' + encodeURIComponent(error_description || oauthError));
    }

    if (!code) {
      return res.redirect('/login?error=' + encodeURIComponent('No authorization code received'));
    }

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
    res.redirect('/dashboard');
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/login?error=' + encodeURIComponent('Authentication failed'));
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
