/**
 * Discovery Interview (Launch Partner) routes
 * GET /discovery-interview - render form
 * POST /discovery-interview - submit and store in Supabase, send emails
 */
const express = require('express');
const router = express.Router();
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const {
  sendDiscoveryInterviewAdminEmail,
  sendDiscoveryInterviewConfirmationEmail
} = require('../utils/emailService');

const TOTAL_STEPS = 6;

/**
 * Compute qualification status and optional reason from form data
 */
function getQualificationStatus(body) {
  const {
    qa_process,
    qa_process_other,
    bug_fix_percentage,
    solution_interest,
    commitment_level
  } = body;

  // Disqualified: not interested or no commitment
  if (solution_interest === 'No, we\'re good with our current process') {
    return { status: 'disqualified', reason: 'Not interested in solution' };
  }
  if (commitment_level === 'No, too much commitment right now') {
    return { status: 'disqualified', reason: 'Cannot commit to feedback' };
  }

  // Low / likely not fit: dedicated QA + low bug %
  const hasDedicatedQA = qa_process === 'We have a dedicated QA person/team';
  if (hasDedicatedQA && bug_fix_percentage === '0-10% (We rarely have bugs)') {
    return { status: 'low', reason: 'Dedicated QA and low bug rate' };
  }

  // High priority: high bug %, game-changing interest, all-in commitment
  const highBugRate = bug_fix_percentage === '25-40%' || bug_fix_percentage === '40%+ (It\'s a constant firefight)';
  const gameChanging = solution_interest === 'Yes, this would be game-changing';
  const allIn = commitment_level === 'Yes, I\'m all in';
  if (highBugRate && gameChanging && allIn) {
    return { status: 'high_priority', reason: null };
  }

  // Medium: solid interest and some commitment
  const maybeInterest = solution_interest === 'Maybe, depends on how well it works';
  const yesOrMaybeCommit = commitment_level === 'Yes, I\'m all in' || commitment_level === 'Maybe, need to discuss with my team first';
  if ((gameChanging || maybeInterest) && yesOrMaybeCommit) {
    return { status: 'medium', reason: null };
  }

  return { status: 'low', reason: null };
}

/**
 * Validate required fields for submission (steps 5 + 6)
 */
function validateSubmission(body) {
  const errors = [];
  if (!body.company_name || !body.company_name.trim()) errors.push('Company name is required');
  if (!body.role || !body.role.trim()) errors.push('Your role is required');
  if (!body.team_size) errors.push('Team size is required');
  if (!body.tech_stack || !body.tech_stack.trim()) errors.push('Tech stack is required');
  if (!body.start_timeline) errors.push('When you could start is required');
  if (!body.email || !body.email.trim()) errors.push('Email is required');
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (body.email && !emailRe.test(body.email)) errors.push('Please enter a valid email');
  if (body.linkedin_url && body.linkedin_url.trim()) {
    try {
      new URL(body.linkedin_url.trim());
    } catch (_) {
      errors.push('LinkedIn URL must be a valid URL');
    }
  }
  if (body.additional_notes && body.additional_notes.length > 500) {
    errors.push('Additional notes must be 500 characters or less');
  }
  return errors;
}

router.get('/discovery-interview', (req, res) => {
  res.render('discovery-interview', {
    title: 'Become a FirstQA Launch Partner',
    totalSteps: TOTAL_STEPS
  });
});

router.post('/discovery-interview', async (req, res) => {
  try {
    const body = req.body || {};
    const validationErrors = validateSubmission(body);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        errors: validationErrors
      });
    }

    const { status: qualification_status, reason: disqualification_reason } = getQualificationStatus(body);

    const row = {
      qa_process: body.qa_process || null,
      qa_process_other: body.qa_process_other || null,
      bug_fix_percentage: body.bug_fix_percentage || null,
      solution_interest: body.solution_interest || null,
      commitment_level: body.commitment_level || null,
      company_name: (body.company_name || '').trim(),
      role: (body.role || '').trim(),
      team_size: body.team_size || null,
      tech_stack: (body.tech_stack || '').trim(),
      start_timeline: body.start_timeline || null,
      email: (body.email || '').trim().toLowerCase(),
      linkedin_url: (body.linkedin_url || '').trim() || null,
      meeting_tool: (body.meeting_tool || '').trim() || null,
      additional_notes: (body.additional_notes || '').trim().slice(0, 500) || null,
      qualification_status,
      disqualification_reason: disqualification_reason || null,
      submitted_at: new Date().toISOString()
    };

    if (isSupabaseConfigured() && supabaseAdmin) {
      const { error } = await supabaseAdmin.from('discovery_interviews').insert(row);
      if (error) {
        console.error('Discovery interview insert error:', error);
        return res.status(500).json({
          success: false,
          errors: ['Could not save your application. Please try again.']
        });
      }
    } else {
      console.warn('Supabase not configured; discovery interview not persisted.');
    }

    await sendDiscoveryInterviewAdminEmail({ ...row, submitted_at: row.submitted_at });
    await sendDiscoveryInterviewConfirmationEmail(row.email, qualification_status !== 'disqualified' && qualification_status !== 'low');

    res.json({
      success: true,
      qualification_status,
      qualified: qualification_status !== 'disqualified' && qualification_status !== 'low'
    });
  } catch (err) {
    console.error('Discovery interview submit error:', err);
    res.status(500).json({
      success: false,
      errors: ['Something went wrong. Please try again.']
    });
  }
});

module.exports = router;
