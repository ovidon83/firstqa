const express = require('express');
const router = express.Router();
const { addCustomer } = require('../utils/customers');
const { supabaseAdmin, isSupabaseConfigured } = require('../lib/supabase');

const TRIAL_EXTENSION_PRICE_CENTS = 900; // $9.00
const TRIAL_EXTENSION_ANALYSES = 10;

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
      if (event.data.object.metadata?.type === 'trial_extension') {
        await handleTrialExtension(event.data.object);
      } else {
        await handleCheckoutCompleted(event.data.object);
      }
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

// Plan amount map (in cents) — update when Stripe products change
const PLAN_AMOUNTS = {
  14900: 'Launch Partner', // $149/mo
  24900: 'Starter',        // $249/mo
  59900: 'Pro',            // $599/mo
};

// Helper function to determine plan from checkout session
function determinePlanFromSession(session) {
  const lineItems = session.line_items?.data || [];

  for (const item of lineItems) {
    const priceId = item.price?.id || '';
    const productId = item.price?.product || '';

    // Match by Stripe Price ID env vars (preferred — set these in your .env)
    if (process.env.STRIPE_PRICE_LAUNCH_PARTNER && priceId === process.env.STRIPE_PRICE_LAUNCH_PARTNER) return 'Launch Partner';
    if (process.env.STRIPE_PRICE_STARTER && priceId === process.env.STRIPE_PRICE_STARTER) return 'Starter';
    if (process.env.STRIPE_PRICE_PRO && priceId === process.env.STRIPE_PRICE_PRO) return 'Pro';

    // Fallback: match by product ID keyword
    const pid = productId.toLowerCase();
    if (pid.includes('launch_partner') || pid.includes('launch-partner')) return 'Launch Partner';
    if (pid.includes('starter')) return 'Starter';
    if (pid.includes('pro')) return 'Pro';
    if (pid.includes('enterprise')) return 'Enterprise';
  }

  // Final fallback: match by total amount
  const plan = PLAN_AMOUNTS[session.amount_total];
  if (plan) return plan;

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

// ── Trial Extension Checkout ─────────────────────────────────────────────────

router.post('/checkout/trial-extension', async (req, res) => {
  if (!stripe) return res.status(503).send('Stripe unavailable');

  const user = req.session?.user;
  if (!user) return res.redirect('/login?redirect=/dashboard');

  try {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: TRIAL_EXTENSION_PRICE_CENTS,
          product_data: {
            name: 'FirstQA Trial Extension',
            description: `${TRIAL_EXTENSION_ANALYSES} more analyses added to your trial`
          }
        },
        quantity: 1
      }],
      metadata: {
        type: 'trial_extension',
        user_id: user.id,
        user_email: user.email,
        analyses_to_add: String(TRIAL_EXTENSION_ANALYSES)
      },
      success_url: `${baseUrl}/dashboard?success=Trial+extended!+${TRIAL_EXTENSION_ANALYSES}+more+analyses+added.`,
      cancel_url: `${baseUrl}/dashboard`
    });

    res.redirect(303, session.url);
  } catch (err) {
    console.error('Trial extension checkout error:', err);
    res.redirect('/dashboard?error=Could+not+start+checkout.+Please+try+again.');
  }
});

// ── Trial Extension Webhook Handler ──────────────────────────────────────────

async function handleTrialExtension(session) {
  const { user_id, user_email, analyses_to_add } = session.metadata || {};
  if (!user_id) {
    console.warn('[Trial Extension] Missing user_id in metadata');
    return;
  }

  const toAdd = parseInt(analyses_to_add, 10) || TRIAL_EXTENSION_ANALYSES;

  try {
    // Increment analyses_limit by toAdd
    const { data: current } = await supabaseAdmin
      .from('users')
      .select('analyses_limit')
      .eq('id', user_id)
      .single();

    const newLimit = (current?.analyses_limit || 5) + toAdd;

    await supabaseAdmin
      .from('users')
      .update({ analyses_limit: newLimit })
      .eq('id', user_id);

    console.log(`✅ Trial extended for ${user_email}: limit now ${newLimit}`);
  } catch (err) {
    console.error('[Trial Extension] Supabase update error:', err.message);
  }
}

module.exports = router;
