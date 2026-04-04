// SMS provider webhook receiver - normalize and persist
import express, { Router, Request, Response } from 'express';
import * as crypto from 'crypto';
import * as db from '../db/index.js';

const router = Router();

/**
 * Verify Twilio webhook signature.
 * Twilio signs every request with HMAC-SHA1 using the auth token.
 * See: https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
function verifyTwilioSignature(req: Request, authToken: string): boolean {
  const twilioSignature = req.headers['x-twilio-signature'] as string | undefined;
  if (!twilioSignature) return false;

  // Build the URL exactly as Twilio sees it
  const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

  // Sort POST body params alphabetically and append to URL
  const params = req.body as Record<string, string>;
  const sortedKeys = Object.keys(params).sort();
  const paramString = sortedKeys.map(k => `${k}${params[k]}`).join('');
  const signingInput = url + paramString;

  const expectedSig = crypto
    .createHmac('sha1', authToken)
    .update(signingInput)
    .digest('base64');

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(twilioSignature),
      Buffer.from(expectedSig)
    );
  } catch {
    return false;
  }
}

// POST /api/sms/webhook
router.post('/webhook', express.urlencoded({ extended: true }), async (req: Request, res: Response): Promise<void> => {
  const provider = (req.body as Record<string, string>).provider || 'unknown';

  // Verify Twilio webhook signatures when auth token is configured.
  // This prevents forged webhook requests from manipulating delivery records.
  if (process.env.TWILIO_AUTH_TOKEN) {
    if (!verifyTwilioSignature(req, process.env.TWILIO_AUTH_TOKEN)) {
      console.warn('[SMS Webhook] Invalid signature — rejecting request from', req.ip);
      res.status(403).send('Forbidden');
      return;
    }
  } else if (process.env.NODE_ENV === 'production') {
    // In production, TWILIO_AUTH_TOKEN must be set for signature verification.
    console.error('[SMS Webhook] TWILIO_AUTH_TOKEN not set — cannot verify signature in production');
    res.status(500).send('Webhook not configured');
    return;
  }

  const body = req.body as Record<string, string>;
  const messageId = body.MessageSid || body.messageId || body.MessageID;
  const to = body.To || body.to;
  const status = body.MessageStatus || body.status;

  // Validate that status is a known value before storing
  const KNOWN_STATUSES = new Set(['queued', 'sent', 'delivered', 'undelivered', 'failed', 'received', 'read']);
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
