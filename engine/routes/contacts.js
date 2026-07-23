const express = require('express');
const { db } = require('../data/db.js');

const router = express.Router();

// GET /api/contacts?company_id=
router.get('/contacts', (req, res) => {
  const { company_id } = req.query;
  if (company_id) {
    return res.json(db.prepare('SELECT * FROM contacts WHERE company_id = ? ORDER BY name ASC').all(company_id));
  }
  res.json(db.prepare('SELECT * FROM contacts ORDER BY name ASC').all());
});

// POST /api/contacts
router.post('/contacts', (req, res) => {
  const { company_id, name, role, email, phone, linkedin, verified } = req.body || {};
  if (!company_id || !name) return res.status(400).json({ error: 'company_id and name are required' });
  const result = db.prepare(`
    INSERT INTO contacts (company_id, name, role, email, phone, linkedin, verified)
    VALUES (@company_id, @name, @role, @email, @phone, @linkedin, @verified)
  `).run({
    company_id,
    name,
    role: role || null,
    email: email || null,
    phone: phone || null,
    linkedin: linkedin || null,
    verified: verified ? 1 : 0,
  });
  res.status(201).json(db.prepare('SELECT * FROM contacts WHERE id = ?').get(result.lastInsertRowid));
});

module.exports = router;
