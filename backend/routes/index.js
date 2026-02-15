/**
 * Main public routes for FirstQA
 */
const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Subscribers file path
const subscribersFile = path.join(__dirname, '../../data/subscribers.json');

// Email configuration
let transporter;
try {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER || process.env.EMAIL_FROM,
      pass: process.env.SMTP_PASSWORD || process.env.EMAIL_APP_PASSWORD
    }
  });
} catch (error) {
  console.error('Error initializing email transporter for contact form:', error.message);
}

// Home/landing page route
router.get('/', (req, res) => {
  // Supabase email confirmation redirects here with ?code= - forward to auth callback
  if (req.query.code && typeof req.query.code === 'string') {
    const params = new URLSearchParams(req.query);
    return res.redirect(`/auth/callback?${params.toString()}`);
  }
  res.render('landing', { title: 'FirstQA - Your First QA Hire for Solo Founders & Startups' });
});

// How it works page
router.get('/how-it-works', (req, res) => {
  res.render('how-it-works', { 
    title: 'How FirstQA Works' 
  });
});

// Pricing page
router.get('/pricing', (req, res) => {
  res.render('pricing', { 
    title: 'FirstQA Pricing' 
  });
});

// Request services page
router.get('/request', (req, res) => {
  res.render('request', {
    title: 'Request Services - FirstQA',
    success: req.query.success
  });
});

// Request services form submission handling
router.post('/request', async (req, res) => {
  try {
    // Extract all form fields
    const formData = req.body;
    
    // Create email content with dynamic form fields
    let emailContent = `<h2>New Service Request Submission</h2>`;
    
    // Contact information
    emailContent += `<h3>Contact Information</h3>`;
    emailContent += `<p><strong>Name:</strong> ${formData.name || 'Not provided'}</p>`;
    emailContent += `<p><strong>Company:</strong> ${formData.company || 'Not provided'}</p>`;
    emailContent += `<p><strong>Email:</strong> ${formData.email || 'Not provided'}</p>`;
    emailContent += `<p><strong>Phone:</strong> ${formData.phone || 'Not provided'}</p>`;
    
    // Services requested
    const services = Array.isArray(formData.services) ? formData.services : [formData.services];
    emailContent += `<h3>Requested Services</h3>`;
    emailContent += `<ul>`;
    services.forEach(service => {
      emailContent += `<li>${service}</li>`;
    });
    emailContent += `</ul>`;
    
    // Service specific details
    if (services.includes('PR Testing')) {
      emailContent += `<h3>PR Testing Details</h3>`;
      emailContent += `<p><strong>GitHub Repository URL:</strong> ${formData.github_repo || 'Not provided'}</p>`;
      emailContent += `<p><strong>Estimated PRs per Month:</strong> ${formData.pr_count || 'Not provided'}</p>`;
      emailContent += `<p><strong>Testing Needs:</strong> ${formData.pr_testing_needs || 'Not provided'}</p>`;
    }
    
    if (services.includes('QA Strategy')) {
      emailContent += `<h3>QA Strategy Details</h3>`;
      emailContent += `<p><strong>Current QA Process:</strong> ${formData.current_process || 'Not provided'}</p>`;
      emailContent += `<p><strong>Strategy Goals:</strong> ${formData.strategy_goals || 'Not provided'}</p>`;
      emailContent += `<p><strong>Team Size:</strong> ${formData.team_size || 'Not provided'}</p>`;
      emailContent += `<p><strong>Product Stage:</strong> ${formData.product_stage || 'Not provided'}</p>`;
    }
    
    if (services.includes('Test Automation')) {
      emailContent += `<h3>Test Automation Details</h3>`;
      emailContent += `<p><strong>Tech Stack:</strong> ${formData.tech_stack || 'Not provided'}</p>`;
      emailContent += `<p><strong>Automation Needs:</strong> ${formData.automation_needs || 'Not provided'}</p>`;
      emailContent += `<p><strong>Existing Automation:</strong> ${formData.existing_automation || 'Not provided'}</p>`;
    }
    
    if (services.includes('Manual QA')) {
      emailContent += `<h3>Manual Testing Details</h3>`;
      const testingTypes = Array.isArray(formData.testing_types) ? formData.testing_types : [formData.testing_types];
      emailContent += `<p><strong>Testing Types:</strong> ${testingTypes.join(', ') || 'Not provided'}</p>`;
      emailContent += `<p><strong>Testing Frequency:</strong> ${formData.testing_frequency || 'Not provided'}</p>`;
      emailContent += `<p><strong>Testing Details:</strong> ${formData.testing_details || 'Not provided'}</p>`;
    }
    
    if (services.includes('QA Team Building')) {
      emailContent += `<h3>QA Team Building Details</h3>`;
      emailContent += `<p><strong>Team Goals:</strong> ${formData.team_goals || 'Not provided'}</p>`;
      emailContent += `<p><strong>Hiring Timeline:</strong> ${formData.hiring_timeline || 'Not provided'}</p>`;
      emailContent += `<p><strong>Team Structure:</strong> ${formData.team_structure || 'Not provided'}</p>`;
    }
    
    // Additional information
    emailContent += `<h3>Additional Information</h3>`;
    emailContent += `<p><strong>Project Details:</strong> ${formData.message || 'Not provided'}</p>`;
    emailContent += `<p><strong>Budget Range:</strong> ${formData.budget || 'Not provided'}</p>`;
    emailContent += `<p><strong>Timeline:</strong> ${formData.timeline || 'Not provided'}</p>`;
    emailContent += `<p><strong>Referral Source:</strong> ${formData.referral || 'Not provided'}</p>`;
    
    // Create plain text version
    const textContent = emailContent.replace(/<[^>]*>/g, '');
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
      to: 'hello@firstqa.dev',
      subject: `[FirstQA Service Request] from ${formData.name}`,
      html: emailContent,
      text: textContent
    };

    // If email service is available, send email
    if (transporter) {
      await transporter.sendMail(mailOptions);
      console.log(`✅ Service request email sent from ${formData.email}`);
    } else {
      console.log(`⚠️ Email service not available, would have sent service request from ${formData.email}`);
    }

    // Redirect with success parameter
    res.redirect('/request?success=true');
  } catch (error) {
    console.error('Error sending service request email:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'There was a problem submitting your request. Please try again later.' 
    });
  }
});

// Contact page
router.get('/contact', (req, res) => {
  res.render('contact', { 
            title: 'Contact FirstQA',
    success: req.query.success
  });
});

// Contact form submission handling
router.post('/contact', async (req, res) => {
  try {
    const { name, email, subject, message, service, subscribe } = req.body;
    
    // Create email content
    const mailOptions = {
      from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
      to: 'hello@firstqa.dev',
      subject: `[FirstQA Contact] ${subject}`,
      html: `
        <h2>New Contact Form Submission</h2>
        <p><strong>Name:</strong> ${name}</p>
        <p><strong>Email:</strong> ${email}</p>
        <p><strong>Subject:</strong> ${subject}</p>
        <p><strong>Service Interest:</strong> ${service || 'Not specified'}</p>
        <p><strong>Newsletter:</strong> ${subscribe ? 'Yes' : 'No'}</p>
        <h3>Message:</h3>
        <p>${message.replace(/\n/g, '<br>')}</p>
      `,
      text: `
New Contact Form Submission

Name: ${name}
Email: ${email}
Subject: ${subject}
Service Interest: ${service || 'Not specified'}
Newsletter: ${subscribe ? 'Yes' : 'No'}

Message:
${message}
      `
    };

    // If email service is available, send email
    if (transporter) {
      await transporter.sendMail(mailOptions);
      console.log(`✅ Contact form email sent from ${email}`);
    } else {
      console.log(`⚠️ Email service not available, would have sent email from ${email}`);
    }

    // Send success response
    res.render('contact-success', { 
      title: 'Message Received',
      name: name 
    });
  } catch (error) {
    console.error('Error sending contact form email:', error);
    res.status(500).render('error', { 
      title: 'Error', 
      message: 'There was a problem sending your message. Please try again later.' 
    });
  }
});

// About page
router.get('/about', (req, res) => {
  res.render('about', { 
            title: 'About FirstQA' 
  });
});

// Newsletter subscription
router.post('/subscribe', async (req, res) => {
  try {
    const { email } = req.body;
    
    // Validate email
    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Please enter a valid email address'
      });
    }
    
    // Load existing subscribers
    let subscribers = [];
    try {
      if (fs.existsSync(subscribersFile)) {
        const data = fs.readFileSync(subscribersFile, 'utf8');
        subscribers = JSON.parse(data);
      }
    } catch (err) {
      console.log('Creating new subscribers file');
    }
    
    // Check if email already exists
    const existingSubscriber = subscribers.find(s => s.email.toLowerCase() === email.toLowerCase());
    if (existingSubscriber) {
      return res.json({
        success: true,
        message: 'You are already subscribed!'
      });
    }
    
    // Add new subscriber
    const newSubscriber = {
      email: email.toLowerCase(),
      subscribedAt: new Date().toISOString(),
      source: 'landing-page'
    };
    subscribers.push(newSubscriber);
    
    // Ensure data directory exists
    const dataDir = path.dirname(subscribersFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    // Save subscribers
    fs.writeFileSync(subscribersFile, JSON.stringify(subscribers, null, 2));
    console.log(`✅ New subscriber added: ${email}`);
    
    // Send notification email
    if (transporter) {
      const mailOptions = {
        from: process.env.EMAIL_FROM || 'noreply@firstqa.dev',
        to: 'hello@firstqa.dev',
        subject: `[FirstQA] New Subscriber: ${email}`,
        html: `
          <h2>New Newsletter Subscriber</h2>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Subscribed at:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Total subscribers:</strong> ${subscribers.length}</p>
        `,
        text: `New subscriber: ${email}\nSubscribed at: ${new Date().toLocaleString()}\nTotal subscribers: ${subscribers.length}`
      };
      
      await transporter.sendMail(mailOptions);
      console.log(`✅ Notification email sent for new subscriber: ${email}`);
    }
    
    res.json({
      success: true,
      message: 'Thanks for subscribing!'
    });
    
  } catch (error) {
    console.error('Error processing subscription:', error);
    res.status(500).json({
      success: false,
      error: 'Something went wrong. Please try again.'
    });
  }
});

// GET waitlist thank you page
router.get('/waitlist-thank-you', (req, res) => {
          res.render('waitlist-thank-you', { title: 'Thanks for Joining the Waitlist - FirstQA' });
});

// Ovi QA Agent endpoint for comprehensive PR analysis
router.post('/generate-test-recipe', async (req, res) => {
  try {
    const { generateQAInsights } = require('../ai/openaiClient');
    
    // Extract required fields from request body
    const { repo, pr_number, title, body, diff } = req.body;
    
    // Validate required fields
    if (!repo || !pr_number || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: 'repo, pr_number, and title are required'
      });
    }
    
    console.log(`🤖 Ovi QA Agent analyzing PR #${pr_number} in ${repo}`);
    console.log('🔍 Input Debug:');
    console.log(`   Repo: ${repo}`);
    console.log(`   PR #: ${pr_number}`);
    console.log(`   Title: ${title}`);
    console.log(`   Body length: ${body?.length || 0}`);
    console.log(`   Diff length: ${diff?.length || 0}`);
    
    // Generate AI insights
    const aiInsights = await generateQAInsights({
      repo,
      pr_number,
      title,
      body,
      diff
    });
    
    if (aiInsights && aiInsights.success) {
      console.log('✅ Ovi QA Agent analysis completed successfully via API');
      res.json({
        success: true,
        data: aiInsights.data,
        metadata: aiInsights.metadata
      });
    } else {
      console.error('❌ Ovi QA Agent analysis failed via API:', aiInsights?.error, aiInsights?.details);
      res.status(500).json({
        success: false,
        error: aiInsights?.error || 'Failed to generate insights',
        details: aiInsights?.details || 'Unknown error occurred'
      });
    }
    
  } catch (error) {
    console.error('❌ Exception in Ovi QA Agent analysis:', error.message);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Ovi QA Agent analysis failed',
      details: error.message
    });
  }
});

// Ovi QA Agent endpoint for short PR analysis
router.post('/generate-short-analysis', async (req, res) => {
  try {
    const { generateShortAnalysis } = require('../ai/openaiClient');
    
    // Extract required fields from request body
    const { repo, pr_number, title, body, diff } = req.body;
    
    // Validate required fields
    if (!repo || !pr_number || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: 'repo, pr_number, and title are required'
      });
    }
    
    console.log(`🤖 Ovi QA Agent generating short analysis for PR #${pr_number} in ${repo}`);
    console.log('🔍 Input Debug:');
    console.log(`   Repo: ${repo}`);
    console.log(`   PR #: ${pr_number}`);
    console.log(`   Title: ${title}`);
    console.log(`   Body length: ${body?.length || 0}`);
    console.log(`   Diff length: ${diff?.length || 0}`);
    
    // Generate short AI insights
    const aiInsights = await generateShortAnalysis({
      repo,
      pr_number,
      title,
      body,
      diff
    });
    
    if (aiInsights && aiInsights.success) {
      console.log('✅ Ovi QA Agent short analysis completed successfully via API');
      res.json({
        success: true,
        data: aiInsights.data,
        metadata: aiInsights.metadata
      });
    } else {
      console.error('❌ Ovi QA Agent short analysis failed via API:', aiInsights?.error, aiInsights?.details);
      res.status(500).json({
        success: false,
        error: aiInsights?.error || 'Failed to generate short insights',
        details: aiInsights?.details || 'Unknown error occurred'
      });
    }
    
  } catch (error) {
    console.error('❌ Exception in Ovi QA Agent short analysis:', error.message);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Ovi QA Agent short analysis failed',
      details: error.message
    });
  }
});

// Ovi QA Agent endpoint for ticket analysis (Linear/Jira)
router.post('/api/analyze-ticket', async (req, res) => {
  try {
    const { generateTicketInsights } = require('../ai/openaiClient');
    
    // Extract ticket data from request body
    const { 
      ticketId, 
      title, 
      description, 
      comments = [], 
      labels = [], 
      platform, 
      priority = 'medium', 
      type = 'story' 
    } = req.body;
    
    // Validate required fields
    if (!ticketId || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        details: 'ticketId and title are required'
      });
    }
    
    console.log(`🤖 Ovi QA Agent analyzing ticket ${ticketId} on ${platform}`);
    console.log('🔍 Input Debug:');
    console.log(`   Ticket ID: ${ticketId}`);
    console.log(`   Platform: ${platform}`);
    console.log(`   Title: ${title}`);
    console.log(`   Description length: ${description?.length || 0}`);
    console.log(`   Comments count: ${comments.length}`);
    console.log(`   Labels: ${labels.join(', ')}`);
    console.log(`   Priority: ${priority}`);
    console.log(`   Type: ${type}`);
    
    // Generate AI insights for ticket
    const aiInsights = await generateTicketInsights({
      ticketId,
      title,
      description,
      comments,
      labels,
      platform,
      priority,
      type
    });
    
    if (aiInsights && aiInsights.success) {
      console.log('✅ Ovi QA Agent ticket analysis completed successfully');
      res.json({
        success: true,
        data: aiInsights.data,
        metadata: aiInsights.metadata
      });
    } else {
      console.error('❌ Ovi QA Agent ticket analysis failed:', aiInsights?.error, aiInsights?.details);
      res.status(500).json({
        success: false,
        error: aiInsights?.error || 'Failed to generate ticket insights',
        details: aiInsights?.details || 'Unknown error occurred'
      });
    }
    
  } catch (error) {
    console.error('❌ Exception in Ovi QA Agent ticket analysis:', error.message);
    console.error('Stack trace:', error.stack);
    
    res.status(500).json({
      success: false,
      error: 'Ovi QA Agent ticket analysis failed',
      details: error.message
    });
  }
});

module.exports = router; 