const express = require('express');
const db = require('../data/db.js');

const router = express.Router();

// GET /api/admin/orders
router.get('/admin/orders', (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
  res.json(orders);
});

// GET /api/admin/orders/:id
router.get('/admin/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ order, items });
});

// POST /api/admin/orders/:id/status  { status: 'packed'|'shipped'|'delivered'|'cancelled' }
const ALLOWED_STATUSES = ['pending', 'paid', 'packed', 'shipped', 'delivered', 'cancelled'];
router.post('/admin/orders/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!ALLOWED_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${ALLOWED_STATUSES.join(', ')}` });
  }
  const result = db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(status, req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
  res.json({ ok: true });
});

// GET /api/admin/products -> for stock overview
router.get('/admin/products', (req, res) => {
  const products = db.prepare(`
    SELECT p.*, s.name AS state_name FROM products p
    JOIN states s ON s.id = p.state_id
    ORDER BY p.stock ASC
  `).all();
  res.json(products);
});

module.exports = router;
