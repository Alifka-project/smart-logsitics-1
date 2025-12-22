const express = require('express');
const router = express.Router();
const db = require('../db');
const { hashPassword, comparePassword, generateToken, createLoginSession, clearLoginSession } = require('../auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password, email, phone, full_name } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username_password_required' });
  try {
    // create driver
    const insert = await db.query('INSERT INTO drivers(username, email, phone, full_name) VALUES($1,$2,$3,$4) RETURNING id, username, email, phone, full_name', [username, email || null, phone || null, full_name || null]);
    const driver = insert.rows[0];
    const pwHash = await hashPassword(password);
    await db.query('INSERT INTO driver_accounts(driver_id, password_hash, role) VALUES($1,$2,$3)', [driver.id, pwHash, 'driver']);
    res.status(201).json({ ok: true, driver });
  } catch (err) {
    console.error('auth/register', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username_password_required' });
  try {
    const { rows } = await db.query('SELECT da.driver_id, da.password_hash, da.role, d.username, d.full_name FROM driver_accounts da JOIN drivers d ON d.id = da.driver_id WHERE d.username = $1 LIMIT 1', [username]);
    if (!rows.length) return res.status(401).json({ error: 'invalid_credentials' });
    const r = rows[0];
    const ok = await comparePassword(password, r.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid_credentials' });
    const payload = { sub: r.driver_id, role: r.role, username: r.username };
    // create server-side session and set cookie; return clientKey to client
    const clientKey = createLoginSession(req, res, payload);
    res.json({ driver: { id: r.driver_id, username: r.username, full_name: r.full_name, role: r.role }, clientKey });
  } catch (err) {
    console.error('auth/login', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    clearLoginSession(res);
    res.json({ ok: true });
  } catch (err) {
    console.error('auth/logout', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
