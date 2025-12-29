const express = require('express');
const router = express.Router();
// GET /api/admin/dashboard
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');

// GET /api/admin/dashboard
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    // Fetch deliveries and compute KPIs
    const [driversResp, locationsResp, deliveriesResp, smsResp] = await Promise.allSettled([
      sapService.call('/Drivers', 'get'),
      sapService.call('/Locations', 'get'),
      sapService.call('/Deliveries', 'get'),
      sapService.call('/SMSConfirmations', 'get'),
    ]);

    const drivers = driversResp.status === 'fulfilled' ? (Array.isArray(driversResp.value.data.value) ? driversResp.value.data.value.length : (Array.isArray(driversResp.value.data) ? driversResp.value.data.length : 0)) : 0;
    const recentLocations = locationsResp.status === 'fulfilled' ? (Array.isArray(locationsResp.value.data.value) ? locationsResp.value.data.value.length : (Array.isArray(locationsResp.value.data) ? locationsResp.value.data.length : 0)) : 0;
    const smsRecent = smsResp.status === 'fulfilled' ? (Array.isArray(smsResp.value.data.value) ? smsResp.value.data.value.length : (Array.isArray(smsResp.value.data) ? smsResp.value.data.length : 0)) : 0;

    let deliveries = [];
    if (deliveriesResp.status === 'fulfilled') {
      if (Array.isArray(deliveriesResp.value.data.value)) deliveries = deliveriesResp.value.data.value;
      else if (Array.isArray(deliveriesResp.value.data)) deliveries = deliveriesResp.value.data;
    }

    const totals = { 
      total: deliveries.length, 
      delivered: 0, 
      cancelled: 0, 
      rescheduled: 0, 
      pending: 0,
      scheduled: 0,
      'scheduled-confirmed': 0,
      'out-for-delivery': 0,
      'delivered-with-installation': 0,
      'delivered-without-installation': 0,
      rejected: 0
    };
    for (const d of deliveries) {
      const s = (d.status || '').toLowerCase();
      if (s === 'delivered' || s === 'done' || s === 'completed' || s === 'delivered-with-installation' || s === 'delivered-without-installation') {
        totals.delivered++;
      }
      if (s === 'delivered-with-installation') totals['delivered-with-installation']++;
      if (s === 'delivered-without-installation') totals['delivered-without-installation']++;
      if (s === 'cancelled' || s === 'canceled') totals.cancelled++;
      if (s === 'rejected') totals.rejected++;
      if (s === 'rescheduled') totals.rescheduled++;
      if (s === 'scheduled') totals.scheduled++;
      if (s === 'scheduled-confirmed') totals['scheduled-confirmed']++;
      if (s === 'out-for-delivery') totals['out-for-delivery']++;
      if (!['delivered', 'done', 'completed', 'delivered-with-installation', 'delivered-without-installation', 'cancelled', 'canceled', 'rejected', 'rescheduled', 'scheduled', 'scheduled-confirmed', 'out-for-delivery', 'in-progress'].includes(s)) {
        totals.pending++;
      }
    }

    // Recent trends (last 24h) if created_at available
    const now = Date.now();
    const last24 = (d) => {
      const t = d.created_at || d.createdAt || d.created || null;
      if (!t) return false;
      const dt = new Date(t).getTime();
      return (now - dt) <= 24 * 3600 * 1000;
    };
    const recentCounts = { delivered: 0, cancelled: 0, rescheduled: 0 };
    for (const d of deliveries.filter(last24)) {
      const s = (d.status || '').toLowerCase();
      if (s === 'delivered' || s === 'done' || s === 'completed') recentCounts.delivered++;
      else if (s === 'cancelled' || s === 'canceled') recentCounts.cancelled++;
      else if (s === 'rescheduled') recentCounts.rescheduled++;
    }

    res.json({ drivers, recentLocations, smsRecent, totals, recentCounts });
  } catch (err) {
    console.error('admin/dashboard (sap)', err);
    res.status(500).json({ error: 'sap_error', detail: err.message });
  }
});

module.exports = router;
