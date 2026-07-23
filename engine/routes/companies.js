const express = require('express');
const { db } = require('../data/db.js');

const router = express.Router();

// GET /api/companies
router.get('/companies', (req, res) => {
  res.json(db.prepare('SELECT * FROM companies ORDER BY name ASC').all());
});

// POST /api/companies
router.post('/companies', (req, res) => {
  const { name, type, website, city, country } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name is required' });
  const result = db.prepare(`
    INSERT INTO companies (name, type, website, city, country)
    VALUES (@name, @type, @website, @city, @country)
  `).run({
    name,
    type: type || null,
    website: website || null,
    city: city || null,
    country: country || null,
  });
  res.status(201).json(db.prepare('SELECT * FROM companies WHERE id = ?').get(result.lastInsertRowid));
});

module.exports = router;
