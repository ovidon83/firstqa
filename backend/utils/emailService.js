/**
 * Email Service for FirstQA
 * Handles sending email notifications
 */
const nodemailer = require('nodemailer');

// Create reusable transporter
let transporter;

/**
 * Initialize the email service
 */
function initialize() {
  // Create a transporter with the provided email settings
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
  
  console.log('Email service initialized');
}

/**
 * Send a test request notification email
 */
async function sendTestRequestEmail(testRequest) {
  // Initialize the service if needed
  if (!transporter) {
    initialize();
  }

  const adminEmail = process.env.EMAIL_TO || 'hello@firstqa.dev';
  
  try {
    // Create email content
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
      to: adminEmail,
      subject: `[FirstQA] New Test Request: ${testRequest.owner}/${testRequest.repo} #${testRequest.prNumber}`,
      html: `
        <h1>New Test Request</h1>
        <p>A new test has been requested for a pull request.</p>
        
        <h2>Details:</h2>
        <ul>
          <li><strong>Repository:</strong> ${testRequest.owner}/${testRequest.repo}</li>
          <li><strong>PR Number:</strong> #${testRequest.prNumber}</li>
          <li><strong>PR Title:</strong> ${testRequest.prTitle}</li>
          <li><strong>Requested At:</strong> ${new Date(testRequest.requestedAt).toLocaleString()}</li>
          <li><strong>Requested By:</strong> ${testRequest.requestedBy || 'Unknown'}</li>
          <li><strong>Status:</strong> ${testRequest.status}</li>
        </ul>
        
        <p>
          <a href="${testRequest.prUrl}" style="background-color: #0366d6; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">
            View Pull Request
          </a>
          &nbsp;
          <a href="${process.env.APP_URL || 'http://localhost:3000'}/admin/login" style="background-color: #28a745; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">
            Go to Admin Dashboard
          </a>
        </p>
        
        <p>Thank you for using FirstQA's Ovi AI!</p>
      `,
      text: `
New Test Request

A new test has been requested for a pull request.

Details:
- Repository: ${testRequest.owner}/${testRequest.repo}
- PR Number: #${testRequest.prNumber}
- PR Title: ${testRequest.prTitle}
- Requested At: ${new Date(testRequest.requestedAt).toLocaleString()}
- Requested By: ${testRequest.requestedBy || 'Unknown'}
- Status: ${testRequest.status}

View Pull Request: ${testRequest.prUrl}
Go to Admin Dashboard: ${process.env.APP_URL || 'http://localhost:3000'}/admin/login

Thank you for using FirstQA's Ovi AI!
      `
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Don't fail the whole flow if email sending fails
    return false;
  }
}

/**
 * Send a test update notification email
 */
async function sendTestUpdateEmail(testRequest) {
  // Initialize the service if needed
  if (!transporter) {
    initialize();
  }

  const adminEmail = process.env.EMAIL_TO || 'hello@firstqa.dev';
  
  try {
    // Create email content
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
      to: adminEmail,
      subject: `[FirstQA] Test Update: ${testRequest.prNumber} (${testRequest.status})`,
      html: `
        <h1>Test Request Updated</h1>
        <p>A test request has been updated.</p>
        
        <h2>Details:</h2>
        <ul>
          <li><strong>Repository:</strong> ${testRequest.owner}/${testRequest.repo}</li>
          <li><strong>PR Number:</strong> #${testRequest.prNumber}</li>
          <li><strong>PR Title:</strong> ${testRequest.prTitle}</li>
          <li><strong>Status:</strong> <strong style="color: ${getStatusColor(testRequest.status)};">${testRequest.status}</strong></li>
        </ul>
        
        <p>
          <a href="${testRequest.prUrl}" style="background-color: #0366d6; color: white; padding: 10px 15px; text-decoration: none; border-radius: 4px; display: inline-block; margin-top: 10px;">
            View Pull Request
          </a>
        </p>
        
        <p>Thank you for using FirstQA's Ovi AI!</p>
      `,
      text: `
Test Request Updated

A test request has been updated.

Details:
- Repository: ${testRequest.owner}/${testRequest.repo}
- PR Number: #${testRequest.prNumber}
- PR Title: ${testRequest.prTitle}
- Status: ${testRequest.status}

View Pull Request: ${testRequest.prUrl}

Thank you for using FirstQA's Ovi AI!
      `
    };

    // Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    
    // Don't fail the whole flow if email sending fails
    return false;
  }
}

/**
 * Get color based on status for email styling
 */
function getStatusColor(status) {
  switch (status) {
    case 'Pending': return '#f0ad4e';
    case 'In Progress': return '#5bc0de';
    case 'Complete-PASS': return '#5cb85c';
    case 'Complete-FAIL': return '#d9534f';
    default: return '#333';
  }
}

/**
 * Send admin notification for new Launch Partner (discovery interview) submission
 */
async function sendDiscoveryInterviewAdminEmail(data) {
  if (!transporter) initialize();

  const adminEmail = process.env.DISCOVERY_ADMIN_EMAIL || 'ovi@firstqa.dev';
  const priorityLabel = (data.qualification_status || 'medium').replace('_', ' ');
  const subject = `New Launch Partner Application - ${priorityLabel.charAt(0).toUpperCase() + priorityLabel.slice(1)} Priority`;

  const html = `
    <h2>New Launch Partner Application</h2>
    <p><strong>Qualification:</strong> ${data.qualification_status}</p>
    ${data.disqualification_reason ? `<p><strong>Disqualification reason:</strong> ${data.disqualification_reason}</p>` : ''}
    <hr>
    <h3>Responses</h3>
    <ul>
      <li><strong>QA process:</strong> ${data.qa_process || '—'} ${data.qa_process_other ? `(${data.qa_process_other})` : ''}</li>
      <li><strong>Bug fix %:</strong> ${data.bug_fix_percentage || '—'}</li>
      <li><strong>Solution interest:</strong> ${data.solution_interest || '—'}</li>
      <li><strong>Commitment:</strong> ${data.commitment_level || '—'}</li>
      <li><strong>Company:</strong> ${data.company_name || '—'}</li>
      <li><strong>Role:</strong> ${data.role || '—'}</li>
      <li><strong>Team size:</strong> ${data.team_size || '—'}</li>
      <li><strong>Tech stack:</strong> ${data.tech_stack || '—'}</li>
      <li><strong>Start timeline:</strong> ${data.start_timeline || '—'}</li>
      <li><strong>Email:</strong> ${data.email || '—'}</li>
      <li><strong>LinkedIn:</strong> ${data.linkedin_url || '—'}</li>
      <li><strong>Meeting tool:</strong> ${data.meeting_tool || '—'}</li>
      <li><strong>Notes:</strong> ${data.additional_notes || '—'}</li>
    </ul>
    <p><em>Submitted at ${new Date(data.submitted_at).toLocaleString()}</em></p>
  `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
      to: adminEmail,
      subject,
      html,
      text: html.replace(/<[^>]*>/g, '')
    });
    console.log(`Discovery interview admin email sent to ${adminEmail}`);
    return true;
  } catch (err) {
    console.error('Error sending discovery interview admin email:', err);
    return false;
  }
}

/**
 * Send confirmation email to applicant after discovery interview submission
 */
async function sendDiscoveryInterviewConfirmationEmail(to, qualified) {
  if (!transporter) initialize();

  const subject = qualified
    ? "We received your Launch Partner application"
    : "Thanks for your interest in FirstQA";

  const html = qualified
    ? `
      <p>Thanks for applying to become a FirstQA Launch Partner.</p>
      <p>We'll review your application and get back to you within 2 business days.</p>
      <p>Questions? Reply to this email or contact ovi@firstqa.dev.</p>
      <p>— The FirstQA team</p>
    `
    : `
      <p>Thanks for your interest in FirstQA.</p>
      <p>Based on your responses, we might not be the perfect fit right now — we'd love to keep you in the loop on product updates.</p>
      <p>Questions? Email ovi@firstqa.dev.</p>
      <p>— The FirstQA team</p>
    `;

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
      to,
      subject,
      html,
      text: html.replace(/<[^>]*>/g, '')
    });
    console.log(`Discovery interview confirmation sent to ${to}`);
    return true;
  } catch (err) {
    console.error('Error sending discovery interview confirmation:', err);
    return false;
  }
}

module.exports = {
  initialize,
  sendTestRequestEmail,
  sendTestUpdateEmail,
  sendDiscoveryInterviewAdminEmail,
  sendDiscoveryInterviewConfirmationEmail
}; 