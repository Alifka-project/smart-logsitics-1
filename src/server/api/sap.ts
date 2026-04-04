import { Router, Request, Response } from 'express';
import sapService from '../services/sapService.js';
const { authenticate, requireRole } = require('../auth');

const router = Router();

// Allowed HTTP methods for the SAP proxy — prevents arbitrary verbs.
const ALLOWED_METHODS = new Set(['get', 'post', 'put', 'patch']);

// GET /api/sap/ping — admin-only liveness check for the SAP connection.
router.get('/ping', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const resp = await sapService.ping() as { status: number; data: unknown };
    res.json({ ok: true, status: resp.status });
  } catch (err: unknown) {
    // Return generic error — don't leak SAP internals.
    console.error('[SAP] ping error:', (err as Error).message);
    res.status(502).json({ ok: false, error: 'sap_unavailable' });
  }
});

// POST /api/sap/call — admin-only passthrough to SAP API.
// Only allowed methods are permitted; endpoint must be a non-empty string.
router.post('/call', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  const { endpoint, method = 'get', data = null, params = {} } = req.body as {
    endpoint?: string;
    method?: string;
    data?: unknown;
    params?: Record<string, unknown>;
  };

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
    const resp = await sapService.call(endpoint, normalizedMethod, data, params) as { status?: number; data: unknown };
    res.status(resp.status || 200).json({ ok: true, data: resp.data });
  } catch (err: unknown) {
    const e = err as { response?: { status?: number }; message?: string };
    console.error('[SAP] call error:', e.message);
    res.status(e.response?.status ?? 502).json({ ok: false, error: 'sap_request_failed' });
  }
});

export default router;
