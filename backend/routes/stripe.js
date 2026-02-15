const express = require('express');
const router = express.Router();
const { addCustomer } = require('../utils/customers');

// Only initialize Stripe if API key is available
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('✅ Stripe client initialized successfully');
  } catch (error) {
    console.warn('⚠️ Failed to initialize Stripe client:', error.message);
  }
} else {
  console.warn('⚠️ STRIPE_SECRET_KEY not set, Stripe webhooks disabled');
}

// Stripe webhook endpoint for payment events
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // Check if Stripe is available
  if (!stripe) {
    console.error('❌ Stripe webhook received but Stripe client not initialized');
    return res.status(503).send('Stripe service unavailable');
  }

  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
  } catch (err) {
    console.error('❌ Stripe webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log('📡 Stripe webhook received:', event.type);

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object);
      break;
    case 'invoice.payment_succeeded':
      await handlePaymentSucceeded(event.data.object);
      break;
    case 'customer.subscription.created':
      await handleSubscriptionCreated(event.data.object);
      break;
    default:
      console.log(`⚠️ Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

// Handle completed checkout sessions
async function handleCheckoutCompleted(session) {
  try {
    console.log('💰 Checkout completed for session:', session.id);
    
    // Extract customer information
    const customerData = {
      email: session.customer_details?.email || session.customer_email,
      name: session.customer_details?.name,
      plan: determinePlanFromSession(session),
      status: 'paid', // Payment was successful
      source: 'stripe_webhook',
      stripeCustomerId: session.customer,
      stripeSessionId: session.id,
      paymentAmount: session.amount_total,
      currency: session.currency,
      paymentStatus: 'succeeded'
    };

    // Add customer to tracking system
    if (customerData.email) {
      const customer = addCustomer(customerData);
      console.log(`✅ Customer automatically added from Stripe: ${customer.email} (${customer.plan})`);
    } else {
      console.warn('⚠️ No email found in Stripe session, cannot add customer');
    }

  } catch (error) {
    console.error('❌ Error handling checkout completed:', error);
  }
}

// Handle successful payments
async function handlePaymentSucceeded(invoice) {
  try {
    console.log('💳 Payment succeeded for invoice:', invoice.id);
    
    // Get customer details from Stripe
    const customer = await stripe.customers.retrieve(invoice.customer);
    
    const customerData = {
      email: customer.email,
      name: customer.name,
      plan: determinePlanFromInvoice(invoice),
      status: 'paid',
      source: 'stripe_webhook',
      stripeCustomerId: customer.id,
      stripeInvoiceId: invoice.id,
      paymentAmount: invoice.amount_paid,
      currency: invoice.currency,
      paymentStatus: 'succeeded'
    };

    // Add/update customer
    if (customerData.email) {
      // Add new customer (simple approach)
      addCustomer(customerData);
      console.log(`✅ Customer added from payment: ${customer.email}`);
    }

  } catch (error) {
    console.error('❌ Error handling payment succeeded:', error);
  }
}

// Handle subscription creation
async function handleSubscriptionCreated(subscription) {
  try {
    console.log('📅 Subscription created:', subscription.id);
    
    // Get customer details
    const customer = await stripe.customers.retrieve(subscription.customer);
    
    const customerData = {
      email: customer.email,
      name: customer.name,
      plan: determinePlanFromSubscription(subscription),
      status: subscription.status === 'active' ? 'paid' : 'free_trial',
      source: 'stripe_webhook',
      stripeCustomerId: customer.id,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
    };

    // Add/update customer
    if (customerData.email) {
      // Add new customer (simple approach)
      addCustomer(customerData);
      console.log(`✅ New customer added from subscription: ${customer.email}`);
    }

  } catch (error) {
    console.error('❌ Error handling subscription created:', error);
  }
}

// Helper function to determine plan from checkout session
function determinePlanFromSession(session) {
  const lineItems = session.line_items?.data || [];
  
  for (const item of lineItems) {
    if (item.price?.product) {
      const productId = item.price.product;
      // Map Stripe product IDs to your plan names
      if (productId.includes('starter') || productId.includes('49')) {
        return 'Starter';
      } else if (productId.includes('growth') || productId.includes('149')) {
        return 'Growth';
      }
    }
  }
  
  // Fallback based on amount
  if (session.amount_total === 4900) { // $49.00 in cents
    return 'Starter';
  } else if (session.amount_total === 14900) { // $149.00 in cents
    return 'Growth';
  }
  
  return 'Free Trial';
}

// Helper function to determine plan from invoice
function determinePlanFromInvoice(invoice) {
  // Similar logic for invoices
  return determinePlanFromSession({ line_items: { data: invoice.lines?.data || [] } });
}

// Helper function to determine plan from subscription
function determinePlanFromSubscription(subscription) {
  // Map subscription items to plan names
  const items = subscription.items?.data || [];
  
  for (const item of items) {
    if (item.price?.product) {
      const productId = item.price.product;
      if (productId.includes('starter') || productId.includes('49')) {
        return 'Starter';
      } else if (productId.includes('growth') || productId.includes('149')) {
        return 'Growth';
      }
    }
  }
  
  return 'Free Trial';
}

module.exports = router;
