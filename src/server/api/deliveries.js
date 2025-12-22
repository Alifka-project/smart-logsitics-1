const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const sapService = require('../../../services/sapService');

async function deliveryExists(deliveryId) {
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}`, 'get');
    return resp && resp.status && resp.status < 400;
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
    // Forward status update to SAP
    const payload = { status, actor_type, actor_id, note };
    const resp = await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', payload);
    res.status(resp.status || 200).json({ ok: true, status: status, data: resp.data });
  } catch (err) {
    console.error('deliveries status update error (sap)', err);
    const statusCode = err.response && err.response.status ? err.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: err.message });
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
    const resp = await sapService.call(`/Deliveries/${deliveryId}/assign`, 'post', { driver_id });
    res.status(resp.status || 200).json({ ok: true, assignment: resp.data });
  } catch (err) {
    console.error('deliveries assign error (sap)', err);
    const statusCode = err.response && err.response.status ? err.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: err.message });
  }
});

// GET /api/deliveries/:id/events
router.get('/:id/events', authenticate, requireRole('admin'), async (req, res) => {
  const deliveryId = req.params.id;
  try {
    const resp = await sapService.call(`/Deliveries/${deliveryId}/events`, 'get');
    res.json({ events: resp.data && resp.data.value ? resp.data.value : resp.data });
  } catch (err) {
    console.error('deliveries events error (sap)', err);
    const statusCode = err.response && err.response.status ? err.response.status : 500;
    res.status(statusCode).json({ error: 'sap_error', detail: err.message });
  }
});

module.exports = router;
