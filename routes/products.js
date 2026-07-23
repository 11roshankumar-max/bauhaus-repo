const express = require('express');
const db = require('../data/db.js');

const router = express.Router();

// GET /api/states  -> map metadata for every state
router.get('/states', (req, res) => {
  const states = db.prepare('SELECT * FROM states ORDER BY name').all();
  res.json(states);
});

// GET /api/states/:id -> single state + its products
router.get('/states/:id', (req, res) => {
  const state = db.prepare('SELECT * FROM states WHERE id = ?').get(req.params.id);
  if (!state) return res.status(404).json({ error: 'State not found' });
  const products = db.prepare('SELECT * FROM products WHERE state_id = ? AND active = 1').all(req.params.id);
  res.json({ ...state, products });
});

// GET /api/products?state=rj -> product list, optionally filtered by state
router.get('/products', (req, res) => {
  const { state } = req.query;
  let products;
  if (state) {
    products = db.prepare('SELECT * FROM products WHERE state_id = ? AND active = 1 ORDER BY rowid').all(state);
  } else {
    products = db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY rowid').all();
  }
  res.json(products);
});

// GET /api/products/:id
router.get('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
});

module.exports = router;
