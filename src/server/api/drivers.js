// Express router for driver admin endpoints
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');

// GET /api/admin/drivers - list drivers (with filters)
router.get('/', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const resp = await sapService.call('/Drivers', 'get', null, { $top: 100 });
    const rows = resp.data && Array.isArray(resp.data.value) ? resp.data.value : (resp.data || []);
    res.json({ data: rows, meta: { count: rows.length } });
  } catch (err) {
    console.error('GET /api/admin/drivers (sap)', err);
    res.status(500).json({ error: 'sap_error', detail: err.message });
  }
});

// POST /api/admin/drivers - create driver
router.post('/', authenticate, requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  if (!body.username && !body.email) return res.status(400).json({ error: 'username_or_email_required' });
  try {
    const resp = await sapService.call('/Drivers', 'post', body);
    res.status(resp.status || 201).json(resp.data);
  } catch (err) {
    console.error('POST /api/admin/drivers (sap)', err);
    res.status(500).json({ error: 'sap_error', detail: err.message });
  }
});

// GET /api/admin/drivers/:id
router.get('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  try {
    const resp = await sapService.call(`/Drivers/${id}`, 'get');
    res.json(resp.data);
  } catch (err) {
    console.error('GET /api/admin/drivers/:id (sap)', err);
    const status = err.response && err.response.status ? err.response.status : 500;
    res.status(status).json({ error: 'sap_error', detail: err.message });
  }
});

// PATCH /api/admin/drivers/:id
router.patch('/:id', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  const updates = req.body || {};
  if (!Object.keys(updates).length) return res.status(400).json({ error: 'no_updates' });
  try {
    const resp = await sapService.call(`/Drivers/${id}`, 'patch', updates);
    res.json(resp.data);
  } catch (err) {
    console.error('PATCH /api/admin/drivers/:id (sap)', err);
    const status = err.response && err.response.status ? err.response.status : 500;
    res.status(status).json({ error: 'sap_error', detail: err.message });
  }
});

// POST /api/admin/drivers/:id/reset-password
router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res) => {
  const id = req.params.id;
  try {
    // Forward to SAP if endpoint exists (best-effort)
    const resp = await sapService.call(`/Drivers/${id}/resetPassword`, 'post', req.body || {});
    res.json({ ok: true, data: resp.data });
  } catch (err) {
    // Fallback: return ok (no-op) but log
    console.error('POST /api/admin/drivers/:id/reset-password (sap)', err);
    res.json({ ok: true, note: 'no-op; SAP call failed or not implemented' });
  }
});

module.exports = router;
