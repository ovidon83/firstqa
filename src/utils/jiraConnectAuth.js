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

  // Save Connect installation (no integration_id - Jira Connect is system-level)
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
    
    // 1) Verify signature/claims (HS256) using standard jwt library
    let decoded;
    try {
      decoded = jwt.verify(token, installation.shared_secret, {
        algorithms: ['HS256']
      });
    } catch (error) {
      console.error('❌ JWT signature verification failed:', error.message);
      return res.status(401).json({ error: 'Invalid JWT signature' });
    }

    // 2) Verify QSH (binds token to this HTTP request)
    // context-qsh is only for lifecycle endpoints (installed/uninstalled)
    // All webhooks should have computed QSH
    
    const isLifecycleEndpoint = req.originalUrl.includes('/installed') || req.originalUrl.includes('/uninstalled');
    
    if (decoded.qsh === 'context-qsh' && isLifecycleEndpoint) {
      console.log('✅ QSH: context-qsh (lifecycle endpoint)');
    } else if (decoded.qsh === 'context-qsh') {
      console.warn('⚠️  context-qsh on non-lifecycle endpoint - should have computed QSH');
      // Allow for now but log warning
    } else {
      // Validate QSH matches the request
      try {
        const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
        const baseUrl = `${req.protocol}://${req.get('host')}`;
        
        // Build canonical request and compute expected QSH
        const reqJwt = jwtLib.fromMethodAndUrl(req.method, fullUrl, baseUrl);
        const expectedQsh = jwtLib.createQueryStringHash(reqJwt);
        
        if (decoded.qsh !== expectedQsh) {
          console.error('❌ QSH mismatch', {
            method: req.method,
            url: req.originalUrl,
            expected: expectedQsh,
            got: decoded.qsh
          });
          return res.status(401).json({ error: 'Invalid QSH' });
        }
        
        console.log('✅ QSH validated');
      } catch (error) {
        console.error('❌ QSH validation error:', error.message);
        return res.status(401).json({ error: 'QSH validation failed' });
      }
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
 * Generate JWT for making outbound API calls to Jira (Connect app -> Jira REST)
 * Correct QSH generation:
 * - Build Request via fromMethodAndUrl()
 * - Compute qsh via createQueryStringHash(req)
 * - DO NOT set sub unless impersonating a REAL Jira user accountId
 */
function generateInstallationToken(sharedSecret, method, fullUrl) {
  const now = Math.floor(Date.now() / 1000);
  
  console.log(`🔑 Generating token for: ${method} ${fullUrl}`);
  
  // Build the canonical request object
  const req = jwtLib.fromMethodAndUrl(method.toUpperCase(), fullUrl);
  
  // IMPORTANT: qsh is NOT on req.qsh; you must compute it:
  const qsh = jwtLib.createQueryStringHash(req);
  
  console.log(`🔑 fromMethodAndUrl:`, req);
  console.log(`🔑 Computed QSH: ${qsh}`);
  
  const payload = {
    iss: 'com.firstqa.jira',  // your Connect app key
    iat: now,
    exp: now + 180,
    qsh
    // DO NOT set sub unless impersonating a REAL Jira user accountId
  };
  
  console.log(`🔑 Full payload:`, payload);
  
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
