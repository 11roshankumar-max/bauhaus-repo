const express = require('express');
const { db } = require('../data/db.js');

const router = express.Router();

// GET /api/raw-events?source_key=&limit=
router.get('/raw-events', (req, res) => {
  const { source_key, limit } = req.query;
  const cap = Math.min(parseInt(limit, 10) || 100, 500);
  if (source_key) {
    return res.json(
      db.prepare('SELECT * FROM raw_events WHERE source_key = ? ORDER BY detected_at DESC LIMIT ?').all(source_key, cap)
    );
  }
  res.json(db.prepare('SELECT * FROM raw_events ORDER BY detected_at DESC LIMIT ?').all(cap));
});

module.exports = router;
