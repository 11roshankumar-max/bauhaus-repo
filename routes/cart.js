const express = require('express');
const db = require('../data/db.js');
const cartStore = require('../data/cart.js');

const router = express.Router();

function hydrate(sessionId) {
  const items = cartStore.cartAsArray(sessionId);
  const productIds = items.map((i) => i.productId);
  if (productIds.length === 0) return { items: [], subtotal_cents: 0, currency: 'usd' };

  const placeholders = productIds.map(() => '?').join(',');
  const products = db.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`).all(...productIds);
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const lineItems = items
    .filter((i) => byId[i.productId]) // drop items whose product no longer exists
    .map((i) => {
      const p = byId[i.productId];
      const quantity = Math.min(i.quantity, p.stock); // clamp to available stock
      return {
        productId: p.id,
        title: p.title,
        stateId: p.state_id,
        category: p.category,
        unit_price_cents: p.price_cents,
        currency: p.currency,
        quantity,
        stock: p.stock,
        line_total_cents: p.price_cents * quantity,
        weight_grams: p.weight_grams || 0,
      };
    });

  const subtotal_cents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0);
  return { items: lineItems, subtotal_cents, currency: 'usd' };
}

// GET /api/cart
router.get('/cart', (req, res) => {
  res.json(hydrate(req.sessionId));
});

// POST /api/cart/add { productId, quantity }
router.post('/cart/add', (req, res) => {
  const { productId, quantity = 1 } = req.body || {};
  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (quantity < 1) return res.status(400).json({ error: 'Quantity must be at least 1' });

  cartStore.addItem(req.sessionId, productId, quantity);
  res.json(hydrate(req.sessionId));
});

// POST /api/cart/update { productId, quantity }
router.post('/cart/update', (req, res) => {
  const { productId, quantity } = req.body || {};
  if (typeof quantity !== 'number') return res.status(400).json({ error: 'quantity is required' });
  cartStore.setItem(req.sessionId, productId, quantity);
  res.json(hydrate(req.sessionId));
});

// POST /api/cart/remove { productId }
router.post('/cart/remove', (req, res) => {
  const { productId } = req.body || {};
  cartStore.removeItem(req.sessionId, productId);
  res.json(hydrate(req.sessionId));
});

router._hydrate = hydrate; // exported for checkout route to reuse
module.exports = router;
