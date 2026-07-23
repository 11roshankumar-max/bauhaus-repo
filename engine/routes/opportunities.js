const express = require('express');
const { db, OPPORTUNITY_STATUSES } = require('../data/db.js');

const router = express.Router();

// GET /api/opportunities?status=&industry=
router.get('/opportunities', (req, res) => {
  const { status, industry } = req.query;
  const clauses = [];
  const params = {};
  if (status) { clauses.push('o.status = @status'); params.status = status; }
  if (industry) { clauses.push('o.industry = @industry'); params.industry = industry; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT o.*, c.name AS company_name
    FROM opportunities o
    LEFT JOIN companies c ON c.id = o.company_id
    ${where}
    ORDER BY o.score DESC, o.updated_at DESC
  `).all(params);
  res.json(rows);
});

// GET /api/opportunities/:id
router.get('/opportunities/:id', (req, res) => {
  const row = db.prepare(`
    SELECT o.*, c.name AS company_name
    FROM opportunities o
    LEFT JOIN companies c ON c.id = o.company_id
    WHERE o.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Opportunity not found' });
  res.json(row);
});

// POST /api/opportunities
router.post('/opportunities', (req, res) => {
  const { title, industry, company_id, location, stage, status } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (status && !OPPORTUNITY_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${OPPORTUNITY_STATUSES.join(', ')}` });
  }
  const result = db.prepare(`
    INSERT INTO opportunities (title, industry, company_id, location, stage, status)
    VALUES (@title, @industry, @company_id, @location, @stage, @status)
  `).run({
    title,
    industry: industry || null,
    company_id: company_id || null,
    location: location || null,
    stage: stage || null,
    status: status || 'new',
  });
  const created = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PUT /api/opportunities/:id
router.put('/opportunities/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Opportunity not found' });

  const { title, industry, company_id, location, stage, status, score, confidence } = req.body || {};
  if (status && !OPPORTUNITY_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${OPPORTUNITY_STATUSES.join(', ')}` });
  }

  db.prepare(`
    UPDATE opportunities SET
      title = @title,
      industry = @industry,
      company_id = @company_id,
      location = @location,
      stage = @stage,
      status = @status,
      score = @score,
      confidence = @confidence,
      updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id: req.params.id,
    title: title ?? existing.title,
    industry: industry ?? existing.industry,
    company_id: company_id ?? existing.company_id,
    location: location ?? existing.location,
    stage: stage ?? existing.stage,
    status: status ?? existing.status,
    score: score ?? existing.score,
    confidence: confidence ?? existing.confidence,
  });

  res.json(db.prepare('SELECT * FROM opportunities WHERE id = ?').get(req.params.id));
});

// DELETE /api/opportunities/:id
router.delete('/opportunities/:id', (req, res) => {
  const result = db.prepare('DELETE FROM opportunities WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Opportunity not found' });
  res.json({ ok: true });
});

module.exports = router;
