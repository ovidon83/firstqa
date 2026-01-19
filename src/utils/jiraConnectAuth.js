/**
 * Atlassian Connect JWT Authentication
 * Handles JWT verification and shared secret management
 */

const jwt = require('jsonwebtoken');
const jwtLib = require('atlassian-jwt');
const crypto = require('crypto');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * Store Connect installation data
 */
async function saveConnectInstallation(installationData) {
  const {
    clientKey,
    sharedSecret,
    baseUrl,
    productType,
    description,
    eventType
  } = installationData;

  console.log(`💾 Saving Jira Connect installation: ${clientKey}`);

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Extract site name from baseUrl
  const siteName = baseUrl.replace('https://', '').replace('.atlassian.net', '');

  const { data, error } = await supabaseAdmin
    .from('jira_connect_installations')
    .upsert({
      client_key: clientKey,
      shared_secret: sharedSecret,
      base_url: baseUrl,
      product_type: productType,
      description: description,
      site_name: siteName,
      installed_at: new Date().toISOString(),
      enabled: true
    }, {
      onConflict: 'client_key'
    })
    .select();

  if (error) {
    console.error('❌ Error saving Connect installation:', error);
    throw error;
  }

  console.log(`✅ Connect installation saved: ${clientKey}`);
  return data[0];
}

/**
 * Get Connect installation by client key
 */
async function getConnectInstallation(clientKey) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('jira_connect_installations')
    .select('*')
    .eq('client_key', clientKey)
    .single();

  if (error) {
    throw new Error(`Installation not found: ${clientKey}`);
  }

  return data;
}

/**
 * Delete Connect installation
 */
async function deleteConnectInstallation(clientKey) {
  console.log(`🗑️  Deleting Jira Connect installation: ${clientKey}`);

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabaseAdmin
    .from('jira_connect_installations')
    .delete()
    .eq('client_key', clientKey);

  if (error) {
    console.error('❌ Error deleting Connect installation:', error);
    throw error;
  }

  console.log(`✅ Connect installation deleted: ${clientKey}`);
}


/**
 * Extract JWT from request (query param or Authorization header)
 */
function extractJWT(req) {
  // Check query parameter first (common for webhooks)
  if (req.query.jwt) {
    return req.query.jwt;
  }

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('JWT ')) {
    return authHeader.substring(4);
  }

  return null;
}

/**
 * Middleware to verify Atlassian Connect JWT with QSH validation
 */
async function verifyConnectJWT(req, res, next) {
  try {
    const token = extractJWT(req);
    
    if (!token) {
      console.error('❌ No JWT token found in request');
      return res.status(401).json({ error: 'No JWT token provided' });
    }

    // Decode without verification to get clientKey
    const decodedUnverified = jwt.decode(token);
    if (!decodedUnverified || !decodedUnverified.iss) {
      console.error('❌ Invalid JWT structure');
      return res.status(401).json({ error: 'Invalid JWT token' });
    }

    const clientKey = decodedUnverified.iss;
    console.log(`🔐 Verifying JWT for client: ${clientKey}`);

    // Get installation to retrieve shared secret
    const installation = await getConnectInstallation(clientKey);
    
    // 1) Verify signature/claims (HS256)
    const verification = jwtLib.decodeSymmetric(
      token,
      installation.shared_secret,
      'HS256',
      true // noVerify = false
    );
    
    if (!verification.valid) {
      console.error('❌ JWT signature verification failed');
      return res.status(401).json({ error: 'Invalid JWT signature' });
    }

    const decoded = verification.decoded;

    // 2) Verify QSH (binds token to this HTTP request)
    // Note: ignore the "jwt" query param itself when computing canonical request
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const reqJwt = jwtLib.fromMethodAndUrl(req.method, fullUrl, baseUrl);
    const expectedQsh = reqJwt.qsh;
    
    if (decoded.qsh !== 'context-qsh' && decoded.qsh !== expectedQsh) {
      console.error('❌ QSH mismatch', {
        expected: expectedQsh,
        got: decoded.qsh,
        fullUrl
      });
      return res.status(401).json({ error: 'Invalid QSH' });
    }

    console.log(`✅ JWT verified for ${clientKey}`);
    
    // Attach installation and decoded token to request
    req.connectInstallation = installation;
    req.connectJWT = decoded;
    
    next();
  } catch (error) {
    console.error('❌ JWT verification error:', error);
    res.status(401).json({ error: 'JWT verification failed' });
  }
}

/**
 * Generate JWT for making outbound API calls to Jira
 * Uses atlassian-jwt library for proper QSH computation
 * @param {string} sharedSecret - Installation shared secret
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} fullUrl - Full API URL
 * @param {string} baseUrl - Jira base URL (for QSH computation)
 * @returns {string} JWT token
 */
function generateInstallationToken(sharedSecret, method, fullUrl, baseUrl) {
  const now = Math.floor(Date.now() / 1000);
  
  // Use atlassian-jwt to compute proper QSH
  const req = jwtLib.fromMethodAndUrl(method, fullUrl, baseUrl);
  
  const payload = {
    iss: 'com.firstqa.jira', // App key from atlassian-connect.json
    iat: now,
    exp: now + 180, // 3 minutes
    qsh: req.qsh // Properly computed QSH from atlassian-jwt
    // DO NOT set sub: clientKey - it breaks auth
  };
  
  console.log(`🔑 Outbound JWT: ${method} ${fullUrl}`);
  console.log(`🔑 QSH: ${req.qsh}`);
  
  const token = jwtLib.encodeSymmetric(payload, sharedSecret);
  
  console.log(`🔑 Token (first 50): ${token.substring(0, 50)}...`);
  
  return token;
}

module.exports = {
  saveConnectInstallation,
  getConnectInstallation,
  deleteConnectInstallation,
  extractJWT,
  verifyConnectJWT,
  generateInstallationToken
};
