const express = require('express');
const { scoreAll } = require('../scoring/score.js');

const router = express.Router();

// POST /api/score/run  { rescore?: boolean }
router.post('/score/run', (req, res) => {
  const rescore = !!(req.body && req.body.rescore);
  res.json(scoreAll({ rescore }));
});

module.exports = router;
