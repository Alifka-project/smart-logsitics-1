const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../auth');

// Helper to ensure deliveries table exists
async function deliveryExists(deliveryId) {
  try {
    const r = await db.query('SELECT id FROM deliveries WHERE id = $1 LIMIT 1', [deliveryId]);
    return r.rows.length > 0;
  } catch (e) {
    return false;
  }
}

// POST /api/deliveries/:id/status
// body: { status, actor_type, actor_id, note }
router.post('/:id/status', authenticate, async (req, res) => {
  const deliveryId = req.params.id;
  const { status, actor_type, actor_id, note } = req.body;

  if (!status) return res.status(400).json({ error: 'status_required' });

  const exists = await deliveryExists(deliveryId);
  if (!exists) return res.status(404).json({ error: 'delivery_not_found' });

  try {
    await db.query('BEGIN');
    await db.query('UPDATE deliveries SET status = $1, updated_at = now() WHERE id = $2', [status, deliveryId]);
    await db.query(
      'INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type, actor_id) VALUES($1,$2,$3,$4,$5)',
      [deliveryId, status, JSON.stringify({ note: note || null }), actor_type || req.user?.role || 'system', actor_id || req.user?.sub || null]
    );
    await db.query('COMMIT');
    res.json({ ok: true, status });
  } catch (err) {
    await db.query('ROLLBACK');
    console.error('deliveries status update error', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// POST /api/deliveries/:id/assign - assign driver
// body: { driver_id }
router.post('/:id/assign', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryId = req.params.id;
  const { driver_id } = req.body;
  if (!driver_id) return res.status(400).json({ error: 'driver_id_required' });
  const exists = await deliveryExists(deliveryId);
  if (!exists) return res.status(404).json({ error: 'delivery_not_found' });
  try {
    const insert = await db.query('INSERT INTO delivery_assignments(delivery_id, driver_id, assigned_at, status) VALUES($1,$2,now(),$3) RETURNING *', [deliveryId, driver_id, 'assigned']);
    await db.query('INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type, actor_id) VALUES($1,$2,$3,$4,$5)', [deliveryId, 'assigned', JSON.stringify({ driver_id }), 'admin', req.user?.sub || null]);
    res.json({ ok: true, assignment: insert.rows[0] });
  } catch (err) {
    console.error('deliveries assign error', err);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/deliveries/:id/events
router.get('/:id/events', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryId = req.params.id;
  try {
    const r = await db.query('SELECT id, event_type, payload, actor_type, actor_id, created_at FROM delivery_events WHERE delivery_id = $1 ORDER BY created_at DESC', [deliveryId]);
    res.json({ events: r.rows });
  } catch (err) {
    console.error('deliveries events error', err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;
