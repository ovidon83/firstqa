const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// Email configuration
let emailTransporter;
try {
  emailTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_FROM || 'hello@firstqa.dev',
      pass: process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD
    }
  });
  console.log('✅ Email transporter initialized for mass email feature');
} catch (error) {
  console.error('⚠️ Error initializing email transporter for mass email feature:', error.message);
}

// GET /email - Render email form
router.get('/', (req, res) => {
  res.render('email-form', { 
    title: 'Send Mass Email',
    success: req.query.success,
    error: req.query.error
  });
});

// POST /contact - Handle contact form submissions
router.post('/contact', async (req, res) => {
  const { name, email, subject, message, service } = req.body;
  
  if (!name || !email || !subject || !message) {
    return res.redirect('/contact?error=All required fields must be filled');
  }
  
  try {
      // Send contact form email to hello@firstqa.dev
  const mailOptions = {
    from: process.env.SMTP_USER || 'noreply@firstqa.dev',
    to: 'hello@firstqa.dev',
      subject: `[FirstQA Contact] ${subject}`,
      replyTo: email,
      html: `
        <h1>New Contact Form Submission</h1>
        <p>Someone has submitted a contact form on FirstQA.</p>
        
        <h2>Contact Details:</h2>
        <ul>
          <li><strong>Name:</strong> ${name}</li>
          <li><strong>Email:</strong> ${email}</li>
          <li><strong>Subject:</strong> ${subject}</li>
          <li><strong>Service Interest:</strong> ${service || 'Not specified'}</li>
        </ul>
        
        <h2>Message:</h2>
        <p>${message.replace(/\n/g, '<br>')}</p>
        
        <p><strong>Reply to:</strong> <a href="mailto:${email}">${email}</a></p>
        
        <p>Thank you for using FirstQA!</p>
      `,
      text: `
New Contact Form Submission

Someone has submitted a contact form on FirstQA.

Contact Details:
- Name: ${name}
- Email: ${email}
- Subject: ${subject}
- Service Interest: ${service || 'Not specified'}

Message:
${message}

Reply to: ${email}

Thank you for using FirstQA!
      `
    };
    
    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Contact form email sent with message ID: ${info.messageId}`);
    
    res.redirect('/contact?success=Your message has been sent successfully! We\'ll get back to you soon.');
  } catch (error) {
    console.error('Failed to send contact form email:', error);
    res.redirect(`/contact?error=${encodeURIComponent('Failed to send message. Please try again.')}`);
  }
});

// POST /email - Send email
router.post('/', async (req, res) => {
  const { recipients, subject, message } = req.body;
  
  if (!recipients || !subject || !message) {
    return res.redirect('/email?error=All fields are required');
  }
  
  try {
    // Split recipients by commas, semicolons, or newlines and trim whitespace
    const recipientList = recipients
      .split(/[,;\n]/)
      .map(email => email.trim())
      .filter(email => email.length > 0);
    
    if (recipientList.length === 0) {
      return res.redirect('/email?error=No valid recipients found');
    }
    
    // Validate email format (basic validation)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipientList.filter(email => !emailRegex.test(email));
    
    if (invalidEmails.length > 0) {
      return res.redirect(`/email?error=Invalid email formats: ${invalidEmails.join(', ')}`);
    }

    // Convert plain text to HTML with proper line breaks
    const htmlContent = message
      .replace(/\n/g, '<br>')
      .replace(/\r/g, '')
      .replace(/<br><br>/g, '</p><p>')
      .replace(/^(.+)(?!<br>)/, '<p>$1</p>')
      .replace(/<br>$/, '');
    
    // Send email
    const mailOptions = {
      from: 'hello@firstqa.dev',
      to: recipientList.join(','),
      subject: subject,
      replyTo: 'hello@firstqa.dev',
      html: htmlContent,
      text: message // Keep original plain text version
    };
    
    const info = await emailTransporter.sendMail(mailOptions);
    console.log(`✅ Mass email sent with message ID: ${info.messageId}`);
    
    res.redirect('/email?success=Email sent successfully to ' + recipientList.length + ' recipients');
  } catch (error) {
    console.error('Failed to send mass email:', error);
    res.redirect(`/email?error=${encodeURIComponent(error.message)}`);
  }
});

module.exports = router; 