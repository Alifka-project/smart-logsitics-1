// SMS provider webhook receiver - normalize and persist
const express = require('express');
const router = express.Router();
const db = require('../db');

// POST /api/sms/webhook
router.post('/webhook', express.urlencoded({ extended: true }), async (req, res) => {
  // Adapter should parse provider format into { provider, messageId, to, status, raw }
  // For now accept generic fields in body
  const provider = req.body.provider || 'unknown';
  const messageId = req.body.MessageSid || req.body.messageId || req.body.MessageID;
  const to = req.body.To || req.body.to;
  const status = req.body.MessageStatus || req.body.status;

  try {
    await db.query(
      'INSERT INTO sms_confirmations(provider, message_id, phone, status, attempts, last_status_at, metadata) VALUES($1,$2,$3,$4,$5,now(),$6)',
      [provider, messageId || null, to || null, status || null, 0, JSON.stringify(req.body)]
    );
  } catch (err) {
    console.error('sms webhook persist error', err);
  }

  console.log('[SMS Webhook] ', { provider, messageId, to, status });

  // Respond quickly
  res.status(200).send('OK');
});

module.exports = router;
