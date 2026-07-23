const express = require('express');
const { recommendAll } = require('../recommendation/recommend.js');

const router = express.Router();

// POST /api/recommend/run  { recompute?: boolean }
router.post('/recommend/run', (req, res) => {
  const recompute = !!(req.body && req.body.recompute);
  res.json(recommendAll({ recompute }));
});

module.exports = router;
