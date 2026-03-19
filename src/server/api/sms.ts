import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../auth.js';
import * as db from '../db/index.js';
const sapService = { call: async (..._args: unknown[]): Promise<{ data: Record<string, unknown> }> => ({ data: {} }) };

const router = Router();

type AuthUser = { sub: string; role?: string; account?: { role?: string } };

interface SmsAdapter {
  sendSms: (opts: { to: string; body: string; metadata?: Record<string, unknown> }) => Promise<{ messageId: string; status: string }>;
}

// Initialize SMS adapter (Twilio or mock)
let smsAdapter: SmsAdapter;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const TwilioAdapter = require('../sms/twilioAdapter.js').default;
  smsAdapter = new TwilioAdapter(process.env) as SmsAdapter;
} catch (e) {
  console.warn('[SMS] Twilio adapter not available, SMS sending will be mocked');
  smsAdapter = {
    sendSms: async ({ to, body }: { to: string; body: string }) => {
      console.log(`[SMS MOCK] Would send to ${to}: ${body}`);
      return { messageId: `mock-${Date.now()}`, status: 'queued' };
    }
  };
}

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
          'twilio',
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
    res.status(500).json({ error: 'sms_send_failed', detail: e.message });
  }
});

// POST /api/sms/send-confirmation - Send confirmation SMS to customer
router.post('/send-confirmation', authenticate, requireRole('admin'), async (req: Request, res: Response): Promise<void> => {
  try {
    const { deliveryId } = req.body as { deliveryId?: string };

    if (!deliveryId) {
      res.status(400).json({ error: 'delivery_id_required' }); return;
    }

    const deliveryResp = await sapService.call(`/Deliveries/${deliveryId}`, 'get') as { data: Record<string, unknown> };
    const delivery = deliveryResp.data;

    if (!delivery) {
      res.status(404).json({ error: 'delivery_not_found' }); return;
    }

    const phone = (delivery.phone || delivery.Phone) as string | undefined;
    if (!phone) {
      res.status(400).json({ error: 'no_phone_number' }); return;
    }

    const confirmationCode = Math.floor(1000 + Math.random() * 9000).toString();
    const trackingUrl = `${process.env.FRONTEND_URL || 'https://smart-logistics-1.vercel.app'}/track/${deliveryId}`;

    const message = `Your delivery is scheduled for ${delivery.delivery_date || 'soon'}. 
To confirm, reply with code: ${confirmationCode}
Or visit: ${trackingUrl}
Delivery ID: ${deliveryId}`;

    const result = await smsAdapter.sendSms({
      to: phone,
      body: message,
      metadata: { deliveryId, type: 'confirmation', code: confirmationCode }
    });

    try {
      await db.query(
        `INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type, actor_id)
         VALUES($1, 'sms_confirmation_sent', $2, 'admin', $3)`,
        [
          deliveryId,
          JSON.stringify({ code: confirmationCode, messageId: result.messageId, phone }),
          (req.user as AuthUser).sub
        ]
      );
    } catch (dbErr: unknown) {
      console.error('[SMS] Failed to log confirmation code:', dbErr);
    }

    try {
      await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', {
        status: 'scheduled',
        actor_type: 'admin',
        actor_id: (req.user as AuthUser).sub,
        note: 'SMS confirmation sent'
      });
    } catch (updateErr: unknown) {
      console.warn('[SMS] Failed to update delivery status:', updateErr);
    }

    res.json({ 
      ok: true, 
      messageId: result.messageId, 
      status: result.status,
      confirmationCode 
    });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('sms/send-confirmation error', err);
    res.status(500).json({ error: 'sms_confirmation_failed', detail: e.message });
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

    await db.query(
      `INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type)
       VALUES($1, 'sms_confirmation_received', $2, 'customer')`,
      [deliveryId, JSON.stringify({ code, timestamp: new Date().toISOString() })]
    );

    res.json({ ok: true, message: 'Delivery confirmed successfully' });
  } catch (err: unknown) {
    const e = err as { message?: string };
    console.error('sms/confirm error', err);
    res.status(500).json({ error: 'confirmation_failed', detail: e.message });
  }
};

router.post('/confirm', confirmHandler);

// Export confirm handler for public access (without authentication)
(router as unknown as Record<string, unknown>).confirm = confirmHandler;

export default router;
