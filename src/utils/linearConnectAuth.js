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

  // Save Linear installation
  const { data, error } = await supabaseAdmin
    .from('linear_connect_installations')
    .upsert({
      api_key: apiKey,
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
 * Linear sends webhooks with a signature in the X-Linear-Signature header
 */
function verifyWebhookSignature(payload, signature, secret) {
  if (!secret) {
    console.warn('⚠️ No webhook secret configured, skipping signature verification');
    return true; // Allow if no secret configured (for development)
  }

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  const expectedSignature = hmac.digest('hex');

  // Linear uses hex-encoded HMAC-SHA256
  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
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
    // Linear uses 'linear-signature' header (case-insensitive, but check both)
    const signature = req.headers['linear-signature'] || req.headers['x-linear-signature'] || req.headers['Linear-Signature'];
    const organizationId = req.body?.data?.organization?.id || req.body?.organizationId;

    if (!organizationId) {
      console.error('❌ Missing organization ID in webhook');
      return res.status(400).json({ error: 'Missing organization ID' });
    }

    // Get installation
    const installation = await getLinearInstallation(organizationId);

    // Verify signature if secret is configured
    if (signature && installation.webhook_secret) {
      const isValid = verifyWebhookSignature(req.body, signature, installation.webhook_secret);
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
