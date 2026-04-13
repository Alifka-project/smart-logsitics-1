"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const sapService_js_1 = __importDefault(require("../services/sapService.js"));
const { authenticate, requireRole } = require('../auth');
const router = (0, express_1.Router)();
// Allowed HTTP methods for the SAP proxy — prevents arbitrary verbs.
const ALLOWED_METHODS = new Set(['get', 'post', 'put', 'patch']);
// GET /api/sap/ping — admin-only liveness check for the SAP connection.
router.get('/ping', authenticate, requireRole('admin'), async (req, res) => {
    try {
        const resp = await sapService_js_1.default.ping();
        res.json({ ok: true, status: resp.status });
    }
    catch (err) {
        // Return generic error — don't leak SAP internals.
        console.error('[SAP] ping error:', err.message);
        res.status(502).json({ ok: false, error: 'sap_unavailable' });
    }
});
// POST /api/sap/call — admin-only passthrough to SAP API.
// Only allowed methods are permitted; endpoint must be a non-empty string.
router.post('/call', authenticate, requireRole('admin'), async (req, res) => {
    const { endpoint, method = 'get', data = null, params = {} } = req.body;
    if (!endpoint || typeof endpoint !== 'string' || endpoint.trim() === '') {
        res.status(400).json({ error: 'endpoint_required' });
        return;
    }
    const normalizedMethod = (method || 'get').toLowerCase();
    if (!ALLOWED_METHODS.has(normalizedMethod)) {
        res.status(400).json({ error: 'method_not_allowed', allowed: [...ALLOWED_METHODS] });
        return;
    }
    try {
        const resp = await sapService_js_1.default.call(endpoint, normalizedMethod, data, params);
        res.status(resp.status || 200).json({ ok: true, data: resp.data });
    }
    catch (err) {
        const e = err;
        console.error('[SAP] call error:', e.message);
        res.status(e.response?.status ?? 502).json({ ok: false, error: 'sap_request_failed' });
    }
});
exports.default = router;
