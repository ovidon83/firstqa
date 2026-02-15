/**
 * Admin routes for FirstQA
 */
const express = require('express');
const router = express.Router();
const { getAllCustomers, getCustomerStats } = require('../utils/customers');

// Simple password protection middleware
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.setHeader('WWW-Authenticate', 'Basic');
    return res.status(401).send('Authentication required');
  }
  
  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  const [username, password] = credentials.split(':');
  
  // Simple hardcoded credentials - in production use environment variables
  if (username === 'admin' && password === 'GetYourTester2025!') {
    next();
  } else {
    res.setHeader('WWW-Authenticate', 'Basic');
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

module.exports = router; 