const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticate, requireRole } = require('../auth');

// GET /api/admin/dashboard
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const [{ rows: drivers }] = await Promise.all([
      db.query('SELECT count(*)::int AS count FROM drivers'),
      db.query("SELECT count(*)::int AS count FROM live_locations WHERE recorded_at > now() - interval '1 hour'"),
    ]);

    const driverCount = drivers[0] ? drivers[0].count : 0;
    const recentLocations = (await db.query("SELECT count(*)::int AS count FROM live_locations WHERE recorded_at > now() - interval '1 hour'")).rows[0].count;

    // deliveries table may not exist in all installs; guard the query
    let pendingDeliveries = 0;
    try {
      const r = await db.query("SELECT count(*)::int AS count FROM deliveries WHERE status != 'delivered'");
      pendingDeliveries = r.rows[0].count || 0;
    } catch (e) {
      // deliveries table not present
      pendingDeliveries = null;
    }

    const smsRecent = (await db.query("SELECT count(*)::int AS count FROM sms_confirmations WHERE created_at > now() - interval '24 hour'")).rows[0].count;

    res.json({ drivers: driverCount, recentLocations, pendingDeliveries, smsRecent });
  } catch (err) {
    console.error('admin/dashboard', err);
    res.status(500).json({ error: 'db_error' });
  }
});

module.exports = router;
