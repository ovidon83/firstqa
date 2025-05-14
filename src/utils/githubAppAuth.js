/**
 * GitHub App Authentication Module
 * Handles JWT generation and installation token retrieval for GitHub App authentication
 */
const { Octokit } = require('@octokit/rest');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

// Cache for installation tokens to avoid regenerating them too frequently
const tokenCache = new Map();
const TOKEN_CACHE_TTL = 50 * 60 * 1000; // 50 minutes (GitHub tokens expire after 60 minutes)

/**
 * Get a GitHub App JWT for authentication
 */
function getGitHubAppJWT() {
  try {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_PRIVATE_KEY;
    
    if (!appId || !privateKey) {
      console.error('Missing GitHub App credentials (GITHUB_APP_ID or GITHUB_PRIVATE_KEY)');
      return null;
    }
    
    // Create a JWT that expires in 10 minutes
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iat: now,
      exp: now + 600,
      iss: appId
    };
    
    // Sign the JWT with the private key
    const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    return token;
  } catch (error) {
    console.error('Error generating GitHub App JWT:', error.message);
    return null;
  }
}

/**
 * Get an installation token for a specific repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<string|null>} - Installation token or null if not available
 */
async function getInstallationToken(owner, repo) {
  try {
    // Check cache first
    const cacheKey = `${owner}/${repo}`;
    const cachedToken = tokenCache.get(cacheKey);
    
    if (cachedToken && cachedToken.expiresAt > Date.now()) {
      return cachedToken.token;
    }
    
    // Generate a JWT for app authentication
    const jwt = getGitHubAppJWT();
    if (!jwt) {
      return null;
    }
    
    // Create a temporary Octokit instance with the JWT
    const appOctokit = new Octokit({ auth: jwt });
    
    // Get the installation ID for this repository
    const { data: installation } = await appOctokit.apps.getRepoInstallation({
      owner,
      repo
    });
    
    if (!installation || !installation.id) {
      console.error(`No installation found for ${owner}/${repo}`);
      return null;
    }
    
    // Get an installation token
    const { data: tokenData } = await appOctokit.apps.createInstallationAccessToken({
      installation_id: installation.id
    });
    
    if (!tokenData || !tokenData.token) {
      console.error(`Failed to get installation token for ${owner}/${repo}`);
      return null;
    }
    
    // Cache the token
    tokenCache.set(cacheKey, {
      token: tokenData.token,
      expiresAt: Date.now() + TOKEN_CACHE_TTL
    });
    
    return tokenData.token;
  } catch (error) {
    console.error(`Error getting installation token for ${owner}/${repo}:`, error.message);
    return null;
  }
}

/**
 * Create an Octokit instance for a specific repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @returns {Promise<Octokit|null>} - Octokit instance or null if not available
 */
async function getOctokitForRepo(owner, repo) {
  try {
    // Try to get an installation token
    const installationToken = await getInstallationToken(owner, repo);
    
    if (installationToken) {
      return new Octokit({ auth: installationToken });
    }
    
    // Fall back to PAT if available
    if (process.env.GITHUB_TOKEN) {
      console.log(`Using PAT as fallback for ${owner}/${repo}`);
      return new Octokit({ auth: process.env.GITHUB_TOKEN });
    }
    
    console.error(`No authentication available for ${owner}/${repo}`);
    return null;
  } catch (error) {
    console.error(`Error creating Octokit instance for ${owner}/${repo}:`, error.message);
    return null;
  }
}

module.exports = {
  getGitHubAppJWT,
  getInstallationToken,
  getOctokitForRepo
}; 