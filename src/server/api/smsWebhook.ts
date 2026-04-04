// SMS provider webhook receiver - normalize and persist
// Active provider: D7 Networks
import express, { Router, Request, Response } from 'express';
import * as db from '../db/index.js';

const router = Router();

// ── Twilio webhook signature verification (DISABLED — Twilio not in use) ──────
// Kept as a reference. Re-enable if switching back to Twilio as SMS provider.
// import * as crypto from 'crypto';
// function verifyTwilioSignature(req: Request, authToken: string): boolean {
//   const twilioSignature = req.headers['x-twilio-signature'] as string | undefined;
//   if (!twilioSignature) return false;
//   const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
//   const params = req.body as Record<string, string>;
//   const sortedKeys = Object.keys(params).sort();
//   const paramString = sortedKeys.map(k => `${k}${params[k]}`).join('');
//   const expectedSig = crypto
//     .createHmac('sha1', authToken)
//     .update(url + paramString)
//     .digest('base64');
//   try {
//     return crypto.timingSafeEqual(Buffer.from(twilioSignature), Buffer.from(expectedSig));
//   } catch { return false; }
// }
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/sms/webhook
// Receives delivery status callbacks from D7 Networks.
// D7 sends JSON: { request_id, otp_id, to, recipient, status }
router.post('/webhook', express.urlencoded({ extended: true }), async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, string>;

  // Detect provider from payload shape — D7 uses request_id/otp_id; Twilio uses MessageSid.
  const provider = body.provider ||
    (body.request_id || body.otp_id ? 'd7' : 'unknown');

  // Normalize field names across providers:
  // D7: request_id / otp_id, to / recipient, status
  // Twilio (disabled): MessageSid, To, MessageStatus
  const messageId = body.request_id || body.otp_id || body.MessageSid || body.messageId || null;
  const to = body.to || body.recipient || body.To || null;
  const status = body.status || body.MessageStatus || null;

  // Validate that status is a known value before storing
  const KNOWN_STATUSES = new Set(['queued', 'sent', 'delivered', 'undelivered', 'failed', 'received', 'read', 'accepted', 'rejected', 'expired']);
  const safeStatus = status && KNOWN_STATUSES.has(status.toLowerCase()) ? status.toLowerCase() : null;

  try {
    await db.query(
      'INSERT INTO sms_confirmations(provider, message_id, phone, status, attempts, last_status_at, metadata) VALUES($1,$2,$3,$4,$5,now(),$6)',
      [provider.substring(0, 50), messageId || null, to || null, safeStatus, 0, JSON.stringify({ provider, status })]
    );
  } catch (err: unknown) {
    console.error('sms webhook persist error', err);
  }

  // Respond quickly — never log PII (phone numbers, message content)
  console.log('[SMS Webhook] received:', { provider, messageId: messageId ? '[redacted]' : null, status: safeStatus });

  res.status(200).send('OK');
});

export default router;
