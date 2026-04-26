/**
 * Admin routes for FirstQA
 */
const express = require('express');
const router = express.Router();
const { getAllCustomers, getCustomerStats } = require('../utils/customers');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');
const loops = require('../services/loops');

// HTTP Basic Auth middleware — credentials from env with fallback
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic realm="FirstQA Admin"');
    return res.status(401).send('Authentication required');
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [username, password] = credentials.split(':');

  const validUser = process.env.ADMIN_USERNAME || 'admin';
  const validPass = process.env.ADMIN_PASSWORD || 'GetYourTester2025!';

  if (username === validUser && password === validPass) {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic realm="FirstQA Admin"');
    res.status(401).send('Invalid credentials');
  }
};

// Admin dashboard - requires authentication
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const customers = getAllCustomers();
    const stats = getCustomerStats();
    
    res.render('admin/dashboard', {
      title: 'Admin Dashboard - FirstQA',
      customers: customers || [],
      stats: stats,
      moment: require('moment')
    });
  } catch (error) {
    console.error('Error loading admin dashboard:', error);
    res.status(500).render('error', {
      title: 'Admin Dashboard Error',
      message: 'Failed to load customer data',
      error: { status: 500 }
    });
  }
});

// Customer details view - requires authentication
router.get('/customers/:id', requireAuth, async (req, res) => {
  try {
    const customers = getAllCustomers();
    const customer = customers.find(c => c.id === req.params.id);
    
    if (!customer) {
      return res.status(404).render('error', {
        title: 'Customer Not Found',
        message: 'The requested customer was not found',
        error: { status: 404 }
      });
    }
    
    res.render('admin/customer-details', {
      title: `Customer Details - ${customer.email}`,
      customer: customer,
      moment: require('moment')
    });
  } catch (error) {
    console.error('Error loading customer details:', error);
    res.status(500).render('error', {
      title: 'Customer Details Error',
      message: 'Failed to load customer data',
      error: { status: 500 }
    });
  }
});

// API endpoint for customer data (JSON) - requires authentication
router.get('/api/customers', requireAuth, async (req, res) => {
  try {
    const customers = getAllCustomers();
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// API endpoint for customer statistics - requires authentication
router.get('/api/stats', requireAuth, async (req, res) => {
  try {
    const stats = getCustomerStats();
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ── Launch Partner Applications ──────────────────────────────────────────────

router.get('/', requireAuth, async (req, res) => {
  try {
    let applications = [];

    if (isSupabaseConfigured() && supabaseAdmin) {
      const { data, error } = await supabaseAdmin
        .from('discovery_interviews')
        .select('*')
        .order('submitted_at', { ascending: false });

      if (error) throw error;
      applications = data || [];
    }

    res.render('admin/applications', {
      title: 'Admin – FirstQA',
      applications
    });
  } catch (err) {
    console.error('Admin error:', err);
    res.status(500).send('Failed to load admin panel');
  }
});

router.post('/launch-partners/:id/approve', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabaseAdmin
      .from('discovery_interviews')
      .update({ qualification_status: 'approved' })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Trigger onboarding sequence in Loops
    await loops.approveLaunchPartner(data.email, {
      firstName: data.role || '',
      companyName: data.company_name || ''
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Approve application error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/launch-partners/:id/reject', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { error } = await supabaseAdmin
      .from('discovery_interviews')
      .update({ qualification_status: 'rejected' })
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true });
  } catch (err) {
    console.error('Reject application error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router; 