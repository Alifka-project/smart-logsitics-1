// Express router for driver location ingestion
const express = require('express');
const router = express.Router();
const db = require('../db');

const { authenticate } = require('../auth');

// POST /api/driver/:id/location
router.post('/:id/location', async (req, res) => {
  const driverId = req.params.id;
  const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body;

  if (!latitude || !longitude) return res.status(400).json({ error: 'lat_long_required' });

  try {
    const q = `INSERT INTO live_locations(driver_id, latitude, longitude, heading, speed, accuracy, recorded_at)
               VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, driver_id, latitude, longitude, recorded_at`;
    const vals = [driverId, latitude, longitude, heading || null, speed || null, accuracy || null, recorded_at || new Date().toISOString()];
    const { rows } = await db.query(q, vals);

    // TODO: publish to Redis / pubsub for realtime maps

    res.json({ ok: true, location: rows[0] });
  } catch (err) {
    console.error('POST /api/driver/:id/location', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/driver/me/location - authenticated driver posts own location
router.post('/me/location', authenticate, async (req, res) => {
  const driverId = req.user.sub;
  const { latitude, longitude, heading, speed, accuracy, recorded_at } = req.body;
  if (!latitude || !longitude) return res.status(400).json({ error: 'lat_long_required' });
  try {
    const q = `INSERT INTO live_locations(driver_id, latitude, longitude, heading, speed, accuracy, recorded_at)
               VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id, driver_id, latitude, longitude, recorded_at`;
    const vals = [driverId, latitude, longitude, heading || null, speed || null, accuracy || null, recorded_at || new Date().toISOString()];
    const { rows } = await db.query(q, vals);
    res.json({ ok: true, location: rows[0] });
  } catch (err) {
    console.error('POST /api/driver/me/location', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/driver/me/live - authenticated driver's latest location
router.get('/me/live', authenticate, async (req, res) => {
  const driverId = req.user.sub;
  try {
    const { rows } = await db.query('SELECT driver_id, latitude, longitude, recorded_at FROM live_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1', [driverId]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/driver/me/live', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/driver/:id/live - latest location (public per-driver)
router.get('/:id/live', async (req, res) => {
  const driverId = req.params.id;
  try {
    const { rows } = await db.query('SELECT driver_id, latitude, longitude, recorded_at FROM live_locations WHERE driver_id = $1 ORDER BY recorded_at DESC LIMIT 1', [driverId]);
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('GET /api/driver/:id/live', err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;
