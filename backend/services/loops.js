/**
 * Loops.so integration
 * Handles contact creation and event triggering for email sequences.
 *
 * Sequences to build in the Loops dashboard:
 *   earlyAccessSignup    → waitlist welcome + nurture (4-5 emails over 4 weeks)
 *   launchPartnerApplied → "application received" confirmation + await review
 *   launchPartnerApproved → onboarding sequence (trigger manually when you approve)
 *   trialEndingSoon      → day 13 upgrade prompt (trigger from a cron job)
 *
 * Loops API docs: https://loops.so/docs/api-reference
 */

const LOOPS_API_BASE = 'https://app.loops.so/api/v1';

function isConfigured() {
  return !!process.env.LOOPS_API_KEY;
}

async function request(path, body) {
  if (!isConfigured()) {
    console.log(`[Loops] API key not set — skipping ${path}`);
    return null;
  }

  const res = await fetch(`${LOOPS_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.LOOPS_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`[Loops] ${path} failed (${res.status}):`, data);
  }
  return data;
}

/**
 * Create or update a contact in Loops.
 * Merges properties if contact already exists.
 */
async function upsertContact({ email, firstName, lastName, userGroup, ...props }) {
  return request('/contacts/create', {
    email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    userGroup: userGroup || undefined,
    ...props
  });
}

/**
 * Send an event to Loops, which triggers any loops listening for that event.
 * Properties are available as merge tags in emails.
 */
async function sendEvent(email, eventName, properties = {}) {
  return request('/events/send', {
    email,
    eventName,
    eventProperties: properties
  });
}

/**
 * Add someone to the early access waitlist.
 * Triggers the waitlist welcome + nurture sequence in Loops.
 */
async function addToWaitlist(email) {
  try {
    await upsertContact({ email, userGroup: 'waitlist', source: 'early_access_modal' });
    await sendEvent(email, 'earlyAccessSignup', { source: 'landing_page' });
    console.log(`[Loops] Waitlist signup queued: ${email}`);
  } catch (err) {
    console.error('[Loops] addToWaitlist error:', err.message);
  }
}

/**
 * Add a Launch Partner applicant to Loops.
 * Triggers the application-received sequence.
 * qualified = true means they passed the form's auto-scoring.
 */
async function addLaunchPartnerApplicant({ email, firstName, companyName, role, qualified, qualificationStatus }) {
  try {
    await upsertContact({
      email,
      firstName: firstName || undefined,
      userGroup: 'launch_partner_applicant',
      companyName: companyName || undefined,
      role: role || undefined,
      lpQualified: qualified,
      lpStatus: qualificationStatus
    });

    const eventName = qualified ? 'launchPartnerApplied' : 'launchPartnerDisqualified';
    await sendEvent(email, eventName, {
      companyName: companyName || '',
      qualified
    });
    console.log(`[Loops] Launch Partner applicant queued: ${email} (${qualificationStatus})`);
  } catch (err) {
    console.error('[Loops] addLaunchPartnerApplicant error:', err.message);
  }
}

/**
 * Trigger the approved onboarding sequence for a Launch Partner.
 * Call this manually (or from an admin route) when you approve someone.
 */
async function approveLaunchPartner(email, { companyName, firstName } = {}) {
  try {
    await upsertContact({
      email,
      userGroup: 'launch_partner',
      lpStatus: 'approved',
      companyName: companyName || undefined,
      firstName: firstName || undefined
    });
    await sendEvent(email, 'launchPartnerApproved', { companyName: companyName || '' });
    console.log(`[Loops] Launch Partner approved sequence triggered: ${email}`);
  } catch (err) {
    console.error('[Loops] approveLaunchPartner error:', err.message);
  }
}

module.exports = { isConfigured, addToWaitlist, addLaunchPartnerApplicant, approveLaunchPartner, upsertContact, sendEvent };
