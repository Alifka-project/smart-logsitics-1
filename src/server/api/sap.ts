import { Router, Request, Response } from 'express';
import sapService from '../services/sapService.js';

const router = Router();

router.get('/ping', async (req: Request, res: Response): Promise<void> => {
  try {
    const resp = await sapService.ping() as { status: number; data: unknown };
    res.json({ ok: true, status: resp.status, data: resp.data });
  } catch (err: unknown) {
    const e = err as { message?: string };
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.post('/call', async (req: Request, res: Response): Promise<void> => {
  const { endpoint, method = 'get', data = null, params = {} } = req.body as {
    endpoint?: string;
    method?: string;
    data?: unknown;
    params?: Record<string, unknown>;
  };
  if (!endpoint) { res.status(400).json({ error: 'endpoint is required' }); return; }
  try {
    const resp = await sapService.call(endpoint, method, data, params) as { status?: number; data: unknown };
    res.status(resp.status || 200).json({ ok: true, data: resp.data });
  } catch (err: unknown) {
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = e.response?.status ?? 500;
    const message = e.response?.data || e.message;
    res.status(status).json({ ok: false, error: message });
  }
});

export default router;
