/**
 * Atlassian Connect JWT Authentication
 * Handles JWT verification and shared secret management
 */

const jwt = require('jsonwebtoken');
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
 * Verify JWT token from Atlassian Connect request
 */
function verifyJWT(token, sharedSecret) {
  try {
    const decoded = jwt.verify(token, sharedSecret, {
      algorithms: ['HS256']
    });
    return { valid: true, decoded };
  } catch (error) {
    console.error('❌ JWT verification failed:', error.message);
    return { valid: false, error: error.message };
  }
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
 * Middleware to verify Atlassian Connect JWT
 */
async function verifyConnectJWT(req, res, next) {
  try {
    const token = extractJWT(req);
    
    if (!token) {
      console.error('❌ No JWT token found in request');
      return res.status(401).json({ error: 'No JWT token provided' });
    }

    // Decode without verification to get clientKey
    const decoded = jwt.decode(token);
    if (!decoded || !decoded.iss) {
      console.error('❌ Invalid JWT structure');
      return res.status(401).json({ error: 'Invalid JWT token' });
    }

    const clientKey = decoded.iss;
    console.log(`🔐 Verifying JWT for client: ${clientKey}`);

    // Get installation to retrieve shared secret
    console.log(`🔍 Looking up installation in database for client_key: ${clientKey}`);
    const installation = await getConnectInstallation(clientKey);
    console.log(`✅ Found installation:`, {
      client_key: installation.client_key,
      base_url: installation.base_url,
      site_name: installation.site_name,
      has_shared_secret: !!installation.shared_secret
    });
    
    // Verify JWT with shared secret
    const verification = verifyJWT(token, installation.shared_secret);
    
    if (!verification.valid) {
      console.error('❌ JWT verification failed:', verification.error);
      return res.status(401).json({ error: 'Invalid JWT signature' });
    }

    console.log(`✅ JWT verified for ${clientKey}`);
    
    // Attach installation and decoded token to request
    req.connectInstallation = installation;
    req.connectJWT = verification.decoded;
    
    next();
  } catch (error) {
    console.error('❌ JWT verification error:', error);
    res.status(401).json({ error: 'JWT verification failed' });
  }
}

/**
 * Compute QSH (Query String Hash) for JWT
 * This is required for authenticating API calls in Atlassian Connect
 */
function computeQSH(method, url) {
  const crypto = require('crypto');
  
  try {
    // Parse URL properly to extract path and query
    const urlObj = new URL(url);
    const path = urlObj.pathname; // Just the path, e.g., /rest/api/3/issue/DEV-2
    const query = urlObj.search.substring(1); // Remove the leading '?'
    
    console.log(`🔐 QSH input - Method: ${method}, Path: ${path}, Query: ${query}`);
    
    // Canonicalize query string (sort parameters)
    let canonicalQuery = '';
    if (query) {
      const params = query.split('&').sort();
      canonicalQuery = params.join('&');
    }
    
    // Create canonical request: METHOD&path&canonicalQuery
    const canonicalRequest = `${method.toUpperCase()}&${path}&${canonicalQuery}`;
    
    console.log(`🔐 QSH canonical string: ${canonicalRequest}`);
    
    // Compute SHA-256 hash
    const hash = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');
    
    console.log(`🔐 QSH hash: ${hash}`);
    
    return hash;
  } catch (error) {
    console.error('❌ QSH computation error:', error);
    throw error;
  }
}

/**
 * Generate installation token for making API calls to Jira
 * Computes proper QSH hash for outbound API calls
 */
function generateInstallationToken(clientKey, sharedSecret, method, fullUrl) {
  const now = Math.floor(Date.now() / 1000);
  
  // Compute QSH for the specific API call
  const qsh = method && fullUrl ? computeQSH(method, fullUrl) : 'context-qsh';
  
  const payload = {
    iss: 'com.firstqa.jira', // Must match the key in atlassian-connect.json
    iat: now,
    exp: now + 180, // 3 minutes
    qsh: qsh
  };
  
  console.log(`🔑 Generating JWT for ${method} ${fullUrl}`);
  console.log(`🔑 Payload:`, payload);
  console.log(`🔑 Using shared secret (first 10 chars): ${sharedSecret.substring(0, 10)}...`);
  
  const token = jwt.sign(payload, sharedSecret, { algorithm: 'HS256' });
  
  console.log(`🔑 Generated JWT token: ${token.substring(0, 50)}...`);
  
  return token;
}

module.exports = {
  saveConnectInstallation,
  getConnectInstallation,
  deleteConnectInstallation,
  verifyJWT,
  extractJWT,
  verifyConnectJWT,
  generateInstallationToken,
  computeQSH
};
