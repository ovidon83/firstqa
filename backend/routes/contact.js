const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

// GET /contact - Render contact page
router.get('/', (req, res) => {
  res.render('contact', { 
            title: 'Contact FirstQA',
    success: req.query.success,
    error: req.query.error
  });
});

// POST /contact - Handle contact form submissions
router.post('/', async (req, res) => {
  const { name, email, subject, message, service } = req.body;
  
  if (!name || !email || !subject || !message) {
    return res.redirect('/contact?error=All required fields must be filled');
  }
  
  try {
    // Create email transporter for contact form
    const contactTransporter = nodemailer.createTransporter({
      service: 'gmail',
      auth: {
        user: process.env.SMTP_USER || process.env.EMAIL_FROM || 'hello@firstqa.dev',
        pass: process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD
      }
    });
    
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
    
    const info = await contactTransporter.sendMail(mailOptions);
    console.log(`✅ Contact form email sent with message ID: ${info.messageId}`);
    
    res.redirect('/contact?success=Your message has been sent successfully! We\'ll get back to you soon.');
  } catch (error) {
    console.error('Failed to send contact form email:', error);
    res.redirect(`/contact?error=${encodeURIComponent('Failed to send message. Please try again.')}`);
  }
});

module.exports = router;
