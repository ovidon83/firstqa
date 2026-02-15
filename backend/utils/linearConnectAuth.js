/**
 * Linear Connect Authentication
 * Handles API key management and webhook verification
 */

const crypto = require('crypto');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

/**
 * Store Linear installation data
 */
async function saveLinearInstallation(installationData) {
  const {
    apiKey,
    organizationId,
    organizationName,
    teamId,
    webhookSecret
  } = installationData;

  console.log(`💾 Saving Linear installation: ${organizationId}`);

  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  // Normalize API key: remove Bearer prefix if present before saving
  const normalizedApiKey = String(apiKey || '').replace(/^Bearer\s+/i, '').trim();

  // Save Linear installation
  const { data, error } = await supabaseAdmin
    .from('linear_connect_installations')
    .upsert({
      api_key: normalizedApiKey,
      organization_id: organizationId,
      organization_name: organizationName,
      team_id: teamId || null,
      webhook_secret: webhookSecret || null,
      installed_at: new Date().toISOString(),
      enabled: true
    }, {
      onConflict: 'organization_id'
    })
    .select();

  if (error) {
    console.error('❌ Error saving Linear installation:', error);
    throw error;
  }

  console.log(`✅ Linear installation saved: ${organizationId}`);
  return data[0];
}

/**
 * Get Linear installation by organization ID
 */
async function getLinearInstallation(organizationId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('linear_connect_installations')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('enabled', true)
    .single();

  if (error) {
    throw new Error(`Linear installation not found: ${organizationId}`);
  }

  return data;
}

/**
 * Get Linear installation by API key (for webhook verification)
 */
async function getLinearInstallationByApiKey(apiKey) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { data, error } = await supabaseAdmin
    .from('linear_connect_installations')
    .select('*')
    .eq('api_key', apiKey)
    .eq('enabled', true)
    .single();

  if (error) {
    throw new Error('Linear installation not found for API key');
  }

  return data;
}

/**
 * Delete Linear installation
 */
async function deleteLinearInstallation(organizationId) {
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase not configured');
  }

  const { error } = await supabaseAdmin
    .from('linear_connect_installations')
    .update({ enabled: false })
    .eq('organization_id', organizationId);

  if (error) {
    console.error('❌ Error deleting Linear installation:', error);
    throw error;
  }

  console.log(`✅ Linear installation disabled: ${organizationId}`);
}

/**
 * Verify Linear webhook signature
 * Linear signs the exact raw request body - must use rawBody, not JSON.stringify(payload)
 * @param {Buffer|string} rawBody - Raw request body (Buffer or string)
 * @param {string} signature - Linear-Signature header value (hex)
 * @param {string} secret - Webhook signing secret
 */
function verifyWebhookSignature(rawBody, signature, secret) {
  if (!secret) {
    console.warn('⚠️ No webhook secret configured, skipping signature verification');
    return true; // Allow if no secret configured (for development)
  }

  if (!rawBody || !signature) {
    console.error('❌ Missing rawBody or signature for verification');
    return false;
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(Buffer.isBuffer(rawBody) ? rawBody : String(rawBody));
  const expectedSignature = hmac.digest('hex');

  // Linear uses hex-encoded HMAC-SHA256
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );

  if (!isValid) {
    console.error('❌ Invalid webhook signature');
  }

  return isValid;
}

/**
 * Middleware to verify Linear webhook and attach installation
 */
async function verifyLinearWebhook(req, res, next) {
  try {
    // Log early so we see incoming requests even when verification fails
    console.log('🔔 Linear webhook POST received');

    // Linear uses 'linear-signature' header (case-insensitive, but check both)
    const signature = req.headers['linear-signature'] || req.headers['x-linear-signature'] || req.headers['Linear-Signature'];
    // Linear puts organizationId at top level of payload
    const organizationId = req.body?.organizationId || req.body?.data?.organization?.id;

    if (!organizationId) {
      console.error('❌ Missing organization ID in webhook');
      return res.status(400).json({ error: 'Missing organization ID' });
    }

    // Get installation
    const installation = await getLinearInstallation(organizationId);

    // Verify signature if secret is configured - MUST use raw body (Linear signs exact bytes)
    if (signature && installation.webhook_secret) {
      const rawBody = req.rawBody;
      if (!rawBody) {
        console.error('❌ Raw body not available for signature verification');
        return res.status(401).json({ error: 'Webhook verification failed' });
      }
      const isValid = verifyWebhookSignature(rawBody, signature, installation.webhook_secret);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    // Attach installation to request
    req.linearInstallation = installation;

    next();
  } catch (error) {
    console.error('❌ Webhook verification error:', error);
    return res.status(401).json({ error: 'Webhook verification failed' });
  }
}

module.exports = {
  saveLinearInstallation,
  getLinearInstallation,
  getLinearInstallationByApiKey,
  deleteLinearInstallation,
  verifyWebhookSignature,
  verifyLinearWebhook
};
