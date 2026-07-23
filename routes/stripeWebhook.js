const express = require('express');
const checkoutRouter = require('./checkout.js');

const router = express.Router();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const stripe = STRIPE_KEY ? require('stripe')(STRIPE_KEY) : null;

// Mounted with express.raw() in server.js so req.body is a Buffer here.
router.post('/', async (req, res) => {
  if (!stripe) return res.status(400).send('Stripe is not configured on this server.');

  let event;
  try {
    if (STRIPE_WEBHOOK_SECRET) {
      const sig = req.headers['stripe-signature'];
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // No webhook secret set — accept unverified (fine for local testing only).
      event = JSON.parse(req.body.toString());
      console.warn('STRIPE_WEBHOOK_SECRET not set — accepting webhook WITHOUT signature verification. Do not do this in production.');
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = session.metadata && session.metadata.orderId;
    if (orderId) {
      await checkoutRouter._finalizeOrderPaid(orderId);
      console.log(`Order #${orderId} marked paid via Stripe webhook.`);
    }
  }

  res.json({ received: true });
});

module.exports = router;
