import { Router, Request, Response } from 'express';
import { authenticate, requireRole, requireAnyRole } from '../auth.js';
import * as db from '../db/index.js';
import prisma from '../db/prisma.js';
const sapService = { call: async (..._args: unknown[]): Promise<{ data: Record<string, unknown> }> => ({ data: {} }) };
const { autoAssignDelivery } = require('../services/autoAssignmentService');

const router = Router();

type AuthUser = { sub: string; role?: string; account?: { role?: string } };

interface SmsAdapter {
  sendSms: (opts: { to: string; body: string; metadata?: Record<string, unknown> }) => Promise<{ messageId: string; status: string }>;
}

// Initialize SMS adapter — D7 Networks is the active provider.
// Twilio adapter is kept in codebase but disabled (not currently used).
let smsAdapter: SmsAdapter;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const D7Adapter = require('../sms/d7Adapter.js').default;
  smsAdapter = new D7Adapter(process.env) as SmsAdapter;
  console.log('[SMS] D7 Networks adapter initialized');
} catch (e) {
  console.warn('[SMS] D7 adapter not available, SMS sending will be mocked');
  smsAdapter = {
    sendSms: async ({ to, body }: { to: string; body: string }) => {
      console.log(`[SMS MOCK] Would send to ${to}: ${body}`);
      return { messageId: `mock-${Date.now()}`, status: 'queued' };
    }
  };
}

// NOTE: Twilio adapter is kept in src/server/sms/twilioAdapter.ts as a reference
// implementation but is NOT active. To re-enable, swap the D7Adapter import above.
// const TwilioAdapter = require('../sms/twilioAdapter.js').default;

// POST /api/sms/send - Send SMS
router.post('/send', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { to, body, deliveryId } = req.body as { to?: string; body?: string; deliveryId?: string };

    if (!to || !body) {
      res.status(400).json({ error: 'to_and_body_required' }); return;
    }

    const result = await smsAdapter.sendSms({
      to,
      body,
      metadata: { deliveryId, sentBy: (req.user as AuthUser).sub }
    });

    try {
      await db.query(
        `INSERT INTO sms_confirmations(delivery_id, phone, provider, message_id, status, attempts, metadata)
         VALUES($1, $2, $3, $4, $5, 1, $6)`,
        [
          deliveryId || null,
          to,
          process.env.SMS_PROVIDER || 'd7',
          result.messageId,
          result.status,
          JSON.stringify({ body, sentBy: (req.user as AuthUser).sub, timestamp: new Date().toISOString() })
        ]
      );
    } catch (dbErr: unknown) {
      console.error('[SMS] Failed to log to database:', dbErr);
    }

    res.json({ ok: true, messageId: result.messageId, status: result.status });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('sms/send error', err);
    res.status(500).json({ error: 'sms_send_failed' });
  }
});

// POST /api/sms/send-confirmation — used by Manage orders "Resend SMS" (label unchanged).
// Backend sends via WhatsApp API while D7 SMS is paused; same flow as /deliveries/:id/send-sms.
router.post('/send-confirmation', authenticate, requireAnyRole('admin', 'delivery_team', 'logistics_team'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveryId } = req.body as { deliveryId?: string };

    if (!deliveryId) {
      res.status(400).json({ error: 'delivery_id_required' }); return;
    }

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, phone: true }
    });

    if (!delivery) {
      res.status(404).json({ error: 'delivery_not_found' }); return;
    }

    if (!delivery.phone) {
      res.status(400).json({ error: 'no_phone_number' }); return;
    }

    const { sendConfirmationSms } = await import('../sms/smsService.js');
    const result = await sendConfirmationSms(delivery.id, delivery.phone) as {
      messageId: string;
      expiresAt: string;
      whatsappUrl?: string;
    };

    res.json({
      ok: true,
      messageId: result.messageId,
      status: 'sent',
      expiresAt: result.expiresAt,
      ...(result.whatsappUrl ? { whatsappUrl: result.whatsappUrl } : {}),
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('sms/send-confirmation error', err);
    res.status(500).json({ error: 'sms_confirmation_failed', message: e.message });
  }
});

// POST /api/sms/confirm - Customer confirms via SMS (public endpoint)
// This is also exported separately for use without authentication
const confirmHandler = async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveryId, code } = req.body as { deliveryId?: string; code?: string };

    if (!deliveryId || !code) {
      res.status(400).json({ error: 'delivery_id_and_code_required' }); return;
    }

    const eventsResp = await db.query(
      `SELECT payload FROM delivery_events 
       WHERE delivery_id = $1 AND event_type = 'sms_confirmation_sent'
       ORDER BY created_at DESC LIMIT 1`,
      [deliveryId]
    );

    if (eventsResp.rows.length === 0) {
      res.status(404).json({ error: 'confirmation_not_found' }); return;
    }

    const eventPayload = (eventsResp.rows[0] as Record<string, unknown>).payload as { code: string };
    const storedCode = eventPayload.code;

    if (storedCode !== code) {
      res.status(400).json({ error: 'invalid_confirmation_code' }); return;
    }

    try {
      await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', {
        status: 'scheduled-confirmed',
        actor_type: 'customer',
        note: 'Customer confirmed via SMS'
      });
    } catch (updateErr: unknown) {
      console.warn('[SMS] Failed to update delivery status:', updateErr);
    }

    // Auto-assign a driver if none assigned yet, so drivers can see confirmed
    // orders before the admin formally dispatches.
    try {
      const prisma = require('../db/prisma').default;
      const existingAssignment = await prisma.deliveryAssignment.findFirst({
        where: { deliveryId, status: { in: ['assigned', 'in_progress'] } }
      });
      if (!existingAssignment) {
        await autoAssignDelivery(deliveryId as string);
      }
    } catch (assignErr: unknown) {
      console.warn('[SMS] scheduled-confirmed auto-assign failed:', (assignErr as Error).message);
    }

    await db.query(
      `INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type)
       VALUES($1, 'sms_confirmation_received', $2, 'customer')`,
      [deliveryId, JSON.stringify({ code, timestamp: new Date().toISOString() })]
    );

    res.json({ ok: true, message: 'Delivery confirmed successfully' });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('sms/confirm error', err);
    res.status(500).json({ error: 'confirmation_failed' });
  }
};

router.post('/confirm', confirmHandler);

// Export confirm handler for public access (without authentication)
(router as unknown as Record<string, unknown>).confirm = confirmHandler;

// GET /api/sms/delivery-info/:id — public endpoint; returns safe display-only fields
// Used by the legacy /track/:deliveryId confirmation page.
router.get('/delivery-info/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  if (!id) { res.status(400).json({ error: 'id_required' }); return; }
  try {
    const result = await db.query(
      `SELECT id, customer, address, po_number AS "poNumber", status, items
       FROM deliveries WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!result.rows.length) { res.status(404).json({ error: 'not_found' }); return; }
    const row = result.rows[0] as Record<string, unknown>;
    // Only expose safe display fields — no phone/lat/lng
    res.json({ ok: true, delivery: { id: row.id, customer: row.customer, address: row.address, poNumber: row.poNumber, status: row.status, items: row.items } });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('[SMS] delivery-info error:', e.message);
    res.status(500).json({ error: 'db_error' });
  }
});

// GET /api/sms/whatsapp-diagnostics — admin-only live D7 config + connectivity check
// Returns raw D7 response so you can see exactly what the API says.
// Optional query param: ?phone=971XXXXXXXXX  (send a real test TEXT message to that number)
router.get('/whatsapp-diagnostics', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { isWhatsAppConfigured, logWhatsAppStartupDiagnostics } = await import('../sms/whatsappApiAdapter.js');
    const axios = (await import('axios')).default;

    const token = (process.env.D7_WHATSAPP_TOKEN || process.env.D7_API_TOKEN || '').replace(/^["'\s]+|["'\s]+$/g, '');
    const originator = (process.env.D7_WHATSAPP_NUMBER || process.env.D7_WHATSAPP_ORIGINATOR || '').replace(/\D/g, '');
    const template = (process.env.D7_WHATSAPP_CONFIRMATION_TEMPLATE || '').trim();
    const lang = (process.env.D7_WHATSAPP_TEMPLATE_LANGUAGE || 'en').trim();
    const configured = isWhatsAppConfigured();

    const config = {
      configured,
      tokenSet: !!token,
      tokenPrefix: token ? token.slice(0, 20) + '…' : null,
      originator: originator || 'MISSING',
      template: template || 'NOT SET',
      lang,
    };

    // If ?phone= provided, make a live test TEXT call to D7 and return raw response
    const testPhone = (req.query.phone as string || '').replace(/\D/g, '');
    let d7Response: unknown = null;
    let d7Error: unknown = null;

    if (testPhone && token && originator) {
      const payload = {
        messages: [{
          originator,
          content: {
            message_type: 'TEXT',
            text: { preview_url: false, body: '[D7 test] WhatsApp connection check from Electrolux portal.' }
          },
          recipients: [{ recipient: testPhone, recipient_type: 'individual' }]
        }]
      };
      try {
        const r = await axios.post('https://api.d7networks.com/whatsapp/v2/send', payload, {
          timeout: 15000,
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` }
        });
        d7Response = r.data;
      } catch (e: unknown) {
        const axErr = e as { response?: { status?: number; data?: unknown }; message?: string };
        d7Error = { httpStatus: axErr.response?.status, body: axErr.response?.data, message: axErr.message };
      }
    }

    res.json({ ok: true, config, ...(testPhone ? { testPhone, d7Response, d7Error } : {}) });
  } catch (err: unknown) {
    const e = err as { message?: string };
    res.status(500).json({ ok: false, error: e.message });
  }
});

export default router;
