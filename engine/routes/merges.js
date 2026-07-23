const express = require('express');
const { scanForMerges, listPending, confirmMerge, rejectMerge } = require('../entity/resolve.js');

const router = express.Router();

// GET /api/company-merges — pending suggestions
router.get('/company-merges', (req, res) => {
  res.json(listPending());
});

// POST /api/company-merges/scan — (re)compute suggestions
router.post('/company-merges/scan', (req, res) => {
  res.json(scanForMerges());
});

// POST /api/company-merges/:id/confirm
router.post('/company-merges/:id/confirm', (req, res) => {
  const result = confirmMerge(req.params.id);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// POST /api/company-merges/:id/reject
router.post('/company-merges/:id/reject', (req, res) => {
  res.json(rejectMerge(req.params.id));
});

module.exports = router;
