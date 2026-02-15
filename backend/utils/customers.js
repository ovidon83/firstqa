const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

// Simple customers file path
const customersFile = path.join(__dirname, '../../data/customers.json');

// Ensure data directory exists
const dataDir = path.dirname(customersFile);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Initialize customers file if it doesn't exist
if (!fs.existsSync(customersFile)) {
  const initialData = {
    customers: [],
    lastUpdated: new Date().toISOString(),
    totalCustomers: 0,
    paidCustomers: 0,
    freeTrialCustomers: 0
  };
  fs.writeFileSync(customersFile, JSON.stringify(initialData, null, 2));
}

// Simple function to add customer
function addCustomer(customerData) {
  try {
    console.log(`📝 Adding customer: ${customerData.email} (${customerData.plan})`);
    
    // Read existing data
    const data = JSON.parse(fs.readFileSync(customersFile, 'utf8'));
    
    // Generate ID
    const customerId = 'cust_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    
    // Create customer
    const customer = {
      id: customerId,
      ...customerData,
      createdAt: new Date().toISOString(),
      status: 'paid', // Always paid since they reached success page
      lastActivity: new Date().toISOString()
    };
    
    // Add to array
    data.customers.push(customer);
    
    // Update stats
    data.totalCustomers = data.customers.length;
    data.paidCustomers = data.customers.filter(c => c.status === 'paid').length;
    data.freeTrialCustomers = data.customers.filter(c => c.status === 'free_trial').length;
    data.lastUpdated = new Date().toISOString();
    
    // Save to file
    fs.writeFileSync(customersFile, JSON.stringify(data, null, 2));
    console.log(`✅ Customer saved to: ${customersFile}`);
    
    // Email notification removed to prevent spam
    
    return customer;
  } catch (error) {
    console.error('❌ Error adding customer:', error);
    throw error;
  }
}

// Simple function to get all customers
function getAllCustomers() {
  try {
    const data = JSON.parse(fs.readFileSync(customersFile, 'utf8'));
    return data.customers;
  } catch (error) {
    console.error('❌ Error reading customers:', error);
    return [];
  }
}

// Simple function to get customer stats
function getCustomerStats() {
  try {
    const data = JSON.parse(fs.readFileSync(customersFile, 'utf8'));
    return {
      totalCustomers: data.totalCustomers,
      paidCustomers: data.paidCustomers,
      freeTrialCustomers: data.freeTrialCustomers,
      lastUpdated: data.lastUpdated
    };
  } catch (error) {
    console.error('❌ Error reading customer stats:', error);
    return {
      totalCustomers: 0,
      paidCustomers: 0,
      freeTrialCustomers: 0,
      lastUpdated: new Date().toISOString()
    };
  }
}

// Email notification function removed to prevent spam

module.exports = {
  addCustomer,
  getAllCustomers,
  getCustomerStats
};
