const express = require('express');
const cartRouter = require('./cart.js');
const { getShippingQuote, isConfigured } = require('../data/shipping.js');

const router = express.Router();

// POST /api/shipping/quote { postcode }
router.post('/shipping/quote', async (req, res) => {
  const { postcode } = req.body || {};
  if (!postcode) return res.status(400).json({ error: 'postcode is required' });

  const { items } = cartRouter._hydrate(req.sessionId);
  if (items.length === 0) return res.status(400).json({ error: 'Cart is empty' });

  const weightGrams = items.reduce((sum, it) => sum + it.weight_grams * it.quantity, 0);

  try {
    const quote = await getShippingQuote({ postcode, weightGrams });
    res.json({ ...quote, weightGrams, real: isConfigured });
  } catch (err) {
    console.error('Shipping quote failed:', err.message);
    res.status(502).json({ error: 'Could not get a shipping quote: ' + err.message });
  }
});

module.exports = router;
