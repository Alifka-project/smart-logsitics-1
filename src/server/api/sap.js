const express = require('express');
const router = express.Router();
const sapService = require('../../../services/sapService');

router.get('/ping', async (req, res) => {
  try {
    const resp = await sapService.ping();
    res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

router.post('/call', async (req, res) => {
  const { endpoint, method = 'get', data = null, params = {} } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
  try {
    const resp = await sapService.call(endpoint, method, data, params);
    res.status(resp.status || 200).json({ ok: true, data: resp.data });
  } catch (err) {
    const status = err.response && err.response.status ? err.response.status : 500;
    const message = (err.response && err.response.data) || err.message;
    res.status(status).json({ ok: false, error: message });
  }
});

module.exports = router;
