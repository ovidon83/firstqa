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

module.exports = {
  initialize,
  sendTestRequestEmail,
  sendTestUpdateEmail
}; 