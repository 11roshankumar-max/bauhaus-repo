const express = require('express');
const { runAll } = require('../ingestion/run.js');

const router = express.Router();

// POST /api/ingest/run — manual trigger; also called on a timer from server.js
router.post('/ingest/run', async (req, res) => {
  const results = await runAll();
  res.json(results);
});

module.exports = router;
