const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../auth');
const db = require('../db');
const sapService = require('../../../services/sapService');

// Initialize SMS adapter (Twilio or mock)
let smsAdapter = null;
try {
  const TwilioAdapter = require('../sms/twilioAdapter');
  smsAdapter = new TwilioAdapter(process.env);
} catch (e) {
  console.warn('[SMS] Twilio adapter not available, SMS sending will be mocked');
  smsAdapter = {
    sendSms: async ({ to, body }) => {
      console.log(`[SMS MOCK] Would send to ${to}: ${body}`);
      return { messageId: `mock-${Date.now()}`, status: 'queued' };
    }
  };
}

// POST /api/sms/send - Send SMS
router.post('/send', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { to, body, deliveryId } = req.body;

    if (!to || !body) {
      return res.status(400).json({ error: 'to_and_body_required' });
    }

    // Send SMS
    const result = await smsAdapter.sendSms({
      to,
      body,
      metadata: { deliveryId, sentBy: req.user.sub }
    });

    // Log to database
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
          JSON.stringify({ body, sentBy: req.user.sub, timestamp: new Date().toISOString() })
        ]
      );
    } catch (dbErr) {
      console.error('[SMS] Failed to log to database:', dbErr);
    }

    res.json({ ok: true, messageId: result.messageId, status: result.status });
  } catch (err) {
    console.error('sms/send error', err);
    res.status(500).json({ error: 'sms_send_failed', detail: err.message });
  }
});

// POST /api/sms/send-confirmation - Send confirmation SMS to customer
router.post('/send-confirmation', authenticate, requireRole('admin'), async (req, res) => {
  try {
    const { deliveryId } = req.body;

    if (!deliveryId) {
      return res.status(400).json({ error: 'delivery_id_required' });
    }

    // Get delivery details
    const deliveryResp = await sapService.call(`/Deliveries/${deliveryId}`, 'get');
    const delivery = deliveryResp.data;

    if (!delivery) {
      return res.status(404).json({ error: 'delivery_not_found' });
    }

    const phone = delivery.phone || delivery.Phone;
    if (!phone) {
      return res.status(400).json({ error: 'no_phone_number' });
    }

    // Generate confirmation code (simple numeric code)
    const confirmationCode = Math.floor(1000 + Math.random() * 9000).toString();
    const trackingUrl = `${process.env.FRONTEND_URL || 'https://smart-logistics-1.vercel.app'}/track/${deliveryId}`;

    // Create SMS message
    const message = `Your delivery is scheduled for ${delivery.delivery_date || 'soon'}. 
To confirm, reply with code: ${confirmationCode}
Or visit: ${trackingUrl}
Delivery ID: ${deliveryId}`;

    // Send SMS
    const result = await smsAdapter.sendSms({
      to: phone,
      body: message,
      metadata: { deliveryId, type: 'confirmation', code: confirmationCode }
    });

    // Store confirmation code in delivery events
    try {
      await db.query(
        `INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type, actor_id)
         VALUES($1, 'sms_confirmation_sent', $2, 'admin', $3)`,
        [
          deliveryId,
          JSON.stringify({ code: confirmationCode, messageId: result.messageId, phone }),
          req.user.sub
        ]
      );
    } catch (dbErr) {
      console.error('[SMS] Failed to log confirmation code:', dbErr);
    }

    // Update delivery status to scheduled
    try {
      await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', {
        status: 'scheduled',
        actor_type: 'admin',
        actor_id: req.user.sub,
        note: 'SMS confirmation sent'
      });
    } catch (updateErr) {
      console.warn('[SMS] Failed to update delivery status:', updateErr);
    }

    res.json({ 
      ok: true, 
      messageId: result.messageId, 
      status: result.status,
      confirmationCode 
    });
  } catch (err) {
    console.error('sms/send-confirmation error', err);
    res.status(500).json({ error: 'sms_confirmation_failed', detail: err.message });
  }
});

// POST /api/sms/confirm - Customer confirms via SMS (public endpoint)
// This is also exported separately for use without authentication
const confirmHandler = async (req, res) => {
  try {
    const { deliveryId, code } = req.body;

    if (!deliveryId || !code) {
      return res.status(400).json({ error: 'delivery_id_and_code_required' });
    }

    // Check if confirmation code matches
    const eventsResp = await db.query(
      `SELECT payload FROM delivery_events 
       WHERE delivery_id = $1 AND event_type = 'sms_confirmation_sent'
       ORDER BY created_at DESC LIMIT 1`,
      [deliveryId]
    );

    if (eventsResp.rows.length === 0) {
      return res.status(404).json({ error: 'confirmation_not_found' });
    }

    const eventPayload = eventsResp.rows[0].payload;
    const storedCode = eventPayload.code;

    if (storedCode !== code) {
      return res.status(400).json({ error: 'invalid_confirmation_code' });
    }

    // Update delivery status to scheduled-confirmed
    try {
      await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', {
        status: 'scheduled-confirmed',
        actor_type: 'customer',
        note: 'Customer confirmed via SMS'
      });
    } catch (updateErr) {
      console.warn('[SMS] Failed to update delivery status:', updateErr);
    }

    // Log confirmation event
    await db.query(
      `INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type)
       VALUES($1, 'sms_confirmation_received', $2, 'customer')`,
      [deliveryId, JSON.stringify({ code, timestamp: new Date().toISOString() })]
    );

    res.json({ ok: true, message: 'Delivery confirmed successfully' });
  } catch (err) {
    console.error('sms/confirm error', err);
    res.status(500).json({ error: 'confirmation_failed', detail: err.message });
  }
};

router.post('/confirm', confirmHandler);

// Export confirm handler for public access (without authentication)
router.confirm = confirmHandler;

module.exports = router;

