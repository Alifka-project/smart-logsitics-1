// Express router for driver admin endpoints
const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../auth');

// GET /api/admin/drivers - list drivers (with filters)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { rows } = await db.query('SELECT id, username, email, phone, full_name, active, created_at FROM drivers ORDER BY created_at DESC LIMIT 100');
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    console.error('GET /api/admin/drivers', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/admin/drivers - create driver
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const { username, email, phone, full_name, password } = req.body;
  if (!username) return res.status(400).json({ error: 'username_required' });
  try {
    const insert = await db.query(
      'INSERT INTO drivers(username, email, phone, full_name) VALUES($1,$2,$3,$4) RETURNING id, username, email, phone, full_name, created_at',
      [username, email || null, phone || null, full_name || null]
    );
    const driver = insert.rows[0];

    // If password provided, create driver_accounts entry (password hashing left to implement)
    if (password) {
      await db.query('INSERT INTO driver_accounts(driver_id, password_hash, role) VALUES($1,$2,$3)', [driver.id, 'TODO_HASH', 'driver']);
    }

    res.status(201).json(driver);
  } catch (err) {
    console.error('POST /api/admin/drivers', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/admin/drivers/:id
router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  try {
    const { rows } = await db.query('SELECT id, username, email, phone, full_name, active, created_at FROM drivers WHERE id = $1 LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// PATCH /api/admin/drivers/:id
router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const updates = req.body || {};
  const allowed = ['email', 'phone', 'full_name', 'active'];
  const fields = [];
  const values = [];
  let idx = 1;
  for (const k of allowed) {
    if (k in updates) {
      fields.push(`${k} = $${idx++}`);
      values.push(updates[k]);
    }
  }
  if (!fields.length) return res.status(400).json({ error: 'no_updates' });
  values.push(id);
  const sql = `UPDATE drivers SET ${fields.join(', ')}, updated_at = now() WHERE id = $${idx} RETURNING id, username, email, phone, full_name, active`;
  try {
    const { rows } = await db.query(sql, values);
    res.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/admin/drivers/:id', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/admin/drivers/:id/reset-password
router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  // TODO: implement password reset flow (email / sms)
  res.json({ ok: true });
});

module.exports = router;
