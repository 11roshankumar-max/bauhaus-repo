const express = require('express');
const { db } = require('../data/db.js');

const router = express.Router();

// GET /api/profiles — industry scoring profiles (config, not code; see Milestone 4)
router.get('/profiles', (req, res) => {
  const rows = db.prepare('SELECT * FROM industry_profiles ORDER BY name ASC').all();
  res.json(rows.map((r) => ({ ...r, config: JSON.parse(r.config_json) })));
});

module.exports = router;
