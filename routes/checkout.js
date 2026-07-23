const express = require('express');
const db = require('../data/db.js');
const cartRouter = require('./cart.js');
const cartStore = require('../data/cart.js');
const { sendOrderConfirmation } = require('../data/email.js');

const router = express.Router();

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const stripe = STRIPE_KEY ? require('stripe')(STRIPE_KEY) : null;
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

function createOrderFromCart(sessionId, customer) {
  const { items, subtotal_cents } = cartRouter._hydrate(sessionId);
  if (items.length === 0) return { error: 'Cart is empty' };

  // stock check
  for (const it of items) {
    if (it.quantity < 1) return { error: `"${it.title}" has no quantity selected` };
    if (it.quantity > it.stock) return { error: `Only ${it.stock} left of "${it.title}"` };
  }

  const insertOrder = db.prepare(`
    INSERT INTO orders (status, payment_provider, customer_email, customer_name, shipping_address, total_cents, currency)
    VALUES ('pending', @provider, @email, @name, @address, @total, 'usd')
  `);
  const info = insertOrder.run({
    provider: stripe ? 'stripe' : 'mock',
    email: customer.email,
    name: customer.name,
    address: customer.address,
    total: subtotal_cents,
  });
  const orderId = info.lastInsertRowid;

  const insertItem = db.prepare(`
    INSERT INTO order_items (order_id, product_id, title, unit_price_cents, quantity)
    VALUES (@order_id, @product_id, @title, @unit_price_cents, @quantity)
  `);
  const tx = db.transaction(() => {
    items.forEach((it) => {
      insertItem.run({
        order_id: orderId,
        product_id: it.productId,
        title: it.title,
        unit_price_cents: it.unit_price_cents,
        quantity: it.quantity,
      });
    });
  });
  tx();

  return { orderId, items, subtotal_cents };
}

async function finalizeOrderPaid(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return null;
  if (order.status === 'paid') return order; // idempotent

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);

  const tx = db.transaction(() => {
    items.forEach((it) => {
      db.prepare('UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?').run(it.quantity, it.product_id);
    });
    db.prepare("UPDATE orders SET status = 'paid', updated_at = datetime('now') WHERE id = ?").run(orderId);
  });
  tx();

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  try {
    await sendOrderConfirmation(updated, items);
  } catch (err) {
    console.error('Failed to send confirmation email:', err.message);
  }
  return updated;
}

// POST /api/checkout  { email, name, address }
router.post('/checkout', async (req, res) => {
  const { email, name, address } = req.body || {};
  if (!email || !name || !address) {
    return res.status(400).json({ error: 'email, name and address are all required' });
  }

  const result = createOrderFromCart(req.sessionId, { email, name, address });
  if (result.error) return res.status(400).json({ error: result.error });

  const { orderId, items, subtotal_cents } = result;

  if (stripe) {
    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        customer_email: email,
        line_items: items.map((it) => ({
          quantity: it.quantity,
          price_data: {
            currency: it.currency,
            unit_amount: it.unit_price_cents,
            product_data: { name: it.title },
          },
        })),
        success_url: `${BASE_URL}/success.html?order=${orderId}&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${BASE_URL}/cart-cancelled.html?order=${orderId}`,
        metadata: { orderId: String(orderId) },
      });
      db.prepare('UPDATE orders SET provider_session_id = ? WHERE id = ?').run(session.id, orderId);
      return res.json({ url: session.url, orderId, mode: 'stripe' });
    } catch (err) {
      console.error('Stripe error:', err.message);
      return res.status(502).json({ error: 'Payment provider error: ' + err.message });
    }
  }

  // ---- DEMO / MOCK MODE: no Stripe key configured ----
  // Simulates an instantly-successful payment so the full flow is testable
  // without a Stripe account. Replace by setting STRIPE_SECRET_KEY in .env.
  await finalizeOrderPaid(orderId);
  cartStore.clearCart(req.sessionId);
  return res.json({ url: `/success.html?order=${orderId}&demo=1`, orderId, mode: 'mock' });
});

// GET /api/checkout/order/:id  -> used by success.html to display + finalize if needed
router.get('/checkout/order/:id', async (req, res) => {
  const orderId = req.params.id;
  const { session_id } = req.query;
  let order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  // Fallback finalization in case the webhook hasn't arrived yet (e.g. running
  // locally without `stripe listen --forward-to`). Verifies with Stripe directly.
  if (order.status !== 'paid' && stripe && session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      if (session.payment_status === 'paid') {
        order = await finalizeOrderPaid(orderId);
        cartStore.clearCart(req.sessionId);
      }
    } catch (err) {
      console.error('Could not verify Stripe session:', err.message);
    }
  }

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  res.json({ order, items });
});

router._finalizeOrderPaid = finalizeOrderPaid;
module.exports = router;
