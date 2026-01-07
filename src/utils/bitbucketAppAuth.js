/**
 * Bitbucket OAuth Authentication Module
 * Handles OAuth 2.0 flow and token management for Bitbucket integrations
 */
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ensure data directory exists
const homeDir = process.env.HOME || process.env.USERPROFILE;
let dataDir = process.env.DATA_DIR || path.join(homeDir, '.firstqa', 'data');
if (!fs.existsSync(dataDir)) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir);
    }
  }
}

const INSTALLATIONS_PATH = path.join(dataDir, 'bitbucket-installations.json');

// Token cache
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 50 * 60 * 1000; // 50 minutes

/**
 * Load installations from storage
 */
function loadInstallations() {
  try {
    if (!fs.existsSync(INSTALLATIONS_PATH)) {
      return [];
    }
    const data = fs.readFileSync(INSTALLATIONS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading Bitbucket installations:', error.message);
    return [];
  }
}

/**
 * Save installations to storage
 */
function saveInstallations(installations) {
  try {
    fs.writeFileSync(INSTALLATIONS_PATH, JSON.stringify(installations, null, 2));
  } catch (error) {
    console.error('Error saving Bitbucket installations:', error.message);
  }
}

/**
 * Get installation for a workspace
 */
function getInstallation(workspaceSlug) {
  const installations = loadInstallations();
  return installations.find(inst => inst.workspace === workspaceSlug);
}

/**
 * Save or update installation
 */
function saveInstallation(installation) {
  const installations = loadInstallations();
  const existingIndex = installations.findIndex(inst => inst.workspace === installation.workspace);
  
  if (existingIndex >= 0) {
    installations[existingIndex] = installation;
  } else {
    installations.push(installation);
  }
  
  saveInstallations(installations);
  
  // Clear cache for this workspace
  tokenCache.delete(installation.workspace);
}

/**
 * Generate OAuth authorization URL
 */
function getAuthorizationUrl(state) {
  const clientId = process.env.BITBUCKET_CLIENT_ID;
  const callbackUrl = process.env.BITBUCKET_CALLBACK_URL || 'https://firstqa.dev/api/auth/bitbucket/callback';
  
  if (!clientId) {
    console.error('BITBUCKET_CLIENT_ID is not set in environment variables');
    throw new Error('BITBUCKET_CLIENT_ID not configured - please set it in your .env file');
  }

  if (!callbackUrl) {
    console.error('BITBUCKET_CALLBACK_URL is not set');
    throw new Error('BITBUCKET_CALLBACK_URL not configured');
  }

  const scopes = ['repository', 'pullrequest', 'webhook'];
  const scopeParam = scopes.join(' ');
  
  const finalState = state || crypto.randomBytes(16).toString('hex');
  
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: 'code',
    scope: scopeParam,
    state: finalState
  });

  const authUrl = `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`;
  console.log(`Generated OAuth URL with client_id: ${clientId.substring(0, 10)}... and callback: ${callbackUrl}`);
  
  return authUrl;
}

/**
 * Exchange authorization code for access token
 */
async function exchangeCodeForToken(code) {
  try {
    const clientId = process.env.BITBUCKET_CLIENT_ID;
    const clientSecret = process.env.BITBUCKET_CLIENT_SECRET;
    const callbackUrl = process.env.BITBUCKET_CALLBACK_URL || 'https://firstqa.dev/api/auth/bitbucket/callback';

    if (!clientId || !clientSecret) {
      throw new Error('Bitbucket OAuth credentials not configured');
    }

    const response = await axios.post('https://bitbucket.org/site/oauth2/access_token', 
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: callbackUrl
      }),
      {
        auth: {
          username: clientId,
          password: clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error exchanging code for token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get current user info from Bitbucket
 */
async function getCurrentUser(accessToken) {
  try {
    const response = await axios.get('https://api.bitbucket.org/2.0/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`
      }
    });
    return response.data;
  } catch (error) {
    console.error('Error getting current user:', error.message);
    return null;
  }
}

/**
 * Refresh access token if it has expired
 */
async function refreshToken(refreshToken) {
  try {
    const clientId = process.env.BITBUCKET_CLIENT_ID;
    const clientSecret = process.env.BITBUCKET_CLIENT_SECRET;

    const response = await axios.post('https://bitbucket.org/site/oauth2/access_token',
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      }),
      {
        auth: {
          username: clientId,
          password: clientSecret
        },
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );

    return response.data;
  } catch (error) {
    console.error('Error refreshing token:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get valid access token for a workspace
 */
async function getAccessToken(workspaceSlug, forceRefresh = false) {
  try {
    // Check cache first
    const cached = tokenCache.get(workspaceSlug);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.token;
    }

    // Load installation
    const installation = getInstallation(workspaceSlug);
    if (!installation || !installation.accessToken) {
      console.error(`No installation found for workspace: ${workspaceSlug}`);
      return null;
    }

    // Check if token needs refresh (Bitbucket tokens typically don't expire, but check anyway)
    // If we have a refresh token and access token is expired, refresh it
    if (installation.refreshToken && installation.expiresAt && installation.expiresAt < Date.now()) {
      console.log(`Refreshing token for workspace: ${workspaceSlug}`);
      try {
        const tokenData = await refreshToken(installation.refreshToken);
        
        // Update installation with new tokens
        installation.accessToken = tokenData.access_token;
        installation.refreshToken = tokenData.refresh_token || installation.refreshToken;
        installation.expiresAt = tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null;
        saveInstallation(installation);
        
        // Cache new token
        tokenCache.set(workspaceSlug, {
          token: tokenData.access_token,
          expiresAt: installation.expiresAt || Date.now() + TOKEN_CACHE_TTL
        });
        
        return tokenData.access_token;
      } catch (refreshError) {
        console.error(`Failed to refresh token for ${workspaceSlug}:`, refreshError.message);
        // Continue with existing token, might still work
      }
    }

    // Use existing token
    const expiresAt = installation.expiresAt || Date.now() + TOKEN_CACHE_TTL;
    tokenCache.set(workspaceSlug, {
      token: installation.accessToken,
      expiresAt
    });

    return installation.accessToken;
  } catch (error) {
    console.error(`Error getting access token for ${workspaceSlug}:`, error.message);
    return null;
  }
}

/**
 * Create authenticated axios config for Bitbucket API
 */
async function getAuthenticatedConfig(workspaceSlug) {
  const token = await getAccessToken(workspaceSlug);
  if (!token) {
    throw new Error(`No valid token for workspace: ${workspaceSlug}`);
  }

  return {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
}

/**
 * Remove installation (uninstall)
 */
function removeInstallation(workspaceSlug) {
  const installations = loadInstallations();
  const filtered = installations.filter(inst => inst.workspace !== workspaceSlug);
  saveInstallations(filtered);
  tokenCache.delete(workspaceSlug);
}

module.exports = {
  getAuthorizationUrl,
  exchangeCodeForToken,
  getCurrentUser,
  getAccessToken,
  getAuthenticatedConfig,
  getInstallation,
  saveInstallation,
  removeInstallation,
  loadInstallations
};

