/**
 * WhatsApp Business API Adapter
 *
 * Sends WhatsApp messages silently from the backend — no popup, no button,
 * message arrives on customer's phone exactly like SMS.
 *
 * Default provider: Green API (https://green-api.com)
 *   - Free tier: 500 messages/month, no credit card needed
 *   - Setup: sign up → scan QR with any WhatsApp → copy idInstance + apiTokenInstance
 *
 * Alternative providers (change WHATSAPP_PROVIDER env var):
 *   ultramsg  — https://ultramsg.com ($5/mo, easy)
 *   twilio    — Twilio WhatsApp sandbox (existing Twilio creds)
 *
 * Required env vars (Green API):
 *   WHATSAPP_INSTANCE_ID    — e.g. 1101234567
 *   WHATSAPP_TOKEN          — e.g. abc123def456...
 *
 * Required env vars (UltraMsg):
 *   WHATSAPP_INSTANCE_ID    — UltraMsg instance ID
 *   WHATSAPP_TOKEN          — UltraMsg token
 *
 * Required env vars (Twilio):
 *   TWILIO_ACCOUNT_SID
 *   TWILIO_AUTH_TOKEN
 *   TWILIO_WHATSAPP_FROM    — e.g. whatsapp:+14155238886
 */

import https from 'https';
import http from 'http';

export interface WhatsAppSendResult {
  ok: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

/**
 * Normalise a phone number to E.164 digits only (no +, no spaces).
 * Examples:
 *   '+62 812-9020-2027' → '6281290202027'
 *   '0521234567'         → '971521234567'   (UAE local)
 *   '521234567'          → '971521234567'   (UAE without leading 0)
 *   '00971521234567'     → '971521234567'
 */
function normalisePhone(raw: string): string {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('5')) return '971' + digits;
  if (digits.length === 10 && digits.startsWith('05')) return '971' + digits.slice(1);
  return digits;
}

// ── Simple JSON POST helper (no axios dep required) ──────────────────────────
function jsonPost(url: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<{ statusCode: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers
      }
    };
    const req = (parsed.protocol === 'https:' ? https : http).request(options, (res) => {
      let raw = '';
      res.on('data', (chunk: string) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode || 0, data: JSON.parse(raw) }); }
        catch { resolve({ statusCode: res.statusCode || 0, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Green API ─────────────────────────────────────────────────────────────────
async function sendGreenApi(phone: string, message: string): Promise<WhatsAppSendResult> {
  const instanceId = process.env.WHATSAPP_INSTANCE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!instanceId || !token) {
    return { ok: false, error: 'WHATSAPP_INSTANCE_ID / WHATSAPP_TOKEN not set' };
  }
  const chatId = `${phone}@c.us`;
  const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;
  const res = await jsonPost(url, { chatId, message });
  const data = res.data as Record<string, unknown>;
  if (res.statusCode === 200 && data.idMessage) {
    return { ok: true, messageId: String(data.idMessage), provider: 'green-api' };
  }
  return { ok: false, error: JSON.stringify(data), provider: 'green-api' };
}

// ── UltraMsg ──────────────────────────────────────────────────────────────────
async function sendUltraMsg(phone: string, message: string): Promise<WhatsAppSendResult> {
  const instanceId = process.env.WHATSAPP_INSTANCE_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!instanceId || !token) {
    return { ok: false, error: 'WHATSAPP_INSTANCE_ID / WHATSAPP_TOKEN not set' };
  }
  const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
  const res = await jsonPost(url, { token, to: `+${phone}`, body: message });
  const data = res.data as Record<string, unknown>;
  if (res.statusCode === 200 && data.sent === 'true') {
    return { ok: true, messageId: String(data.id || Date.now()), provider: 'ultramsg' };
  }
  return { ok: false, error: JSON.stringify(data), provider: 'ultramsg' };
}

// ── Twilio WhatsApp ───────────────────────────────────────────────────────────
async function sendTwilioWhatsApp(phone: string, message: string): Promise<WhatsAppSendResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  if (!accountSid || !authToken) {
    return { ok: false, error: 'TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN not set' };
  }
  const to = `whatsapp:+${phone}`;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({ To: to, From: from, Body: message }).toString();
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const headers = {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

  // Use jsonPost shape but send urlencoded
  const parsed = new URL(url);
  const result = await new Promise<{ statusCode: number; data: unknown }>((resolve, reject) => {
    const options = {
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'POST',
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (c: string) => { raw += c; });
      res.on('end', () => {
        try { resolve({ statusCode: res.statusCode || 0, data: JSON.parse(raw) }); }
        catch { resolve({ statusCode: res.statusCode || 0, data: raw }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  const data = result.data as Record<string, unknown>;
  if (result.statusCode === 201 && data.sid) {
    return { ok: true, messageId: String(data.sid), provider: 'twilio-whatsapp' };
  }
  return { ok: false, error: JSON.stringify(data), provider: 'twilio-whatsapp' };
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Send a WhatsApp message silently from the backend.
 * Provider is selected via WHATSAPP_PROVIDER env var (default: green-api).
 *
 * @param phone  Raw phone string (any format — normalised internally)
 * @param body   Plain-text message body
 */
export async function sendWhatsApp(phone: string, body: string): Promise<WhatsAppSendResult> {
  const normalised = normalisePhone(phone);
  if (normalised.length < 7) {
    console.warn(`[WhatsAppAPI] Invalid phone "${phone}" → "${normalised}" — skipping`);
    return { ok: false, error: `invalid_phone: ${phone}` };
  }

  const provider = (process.env.WHATSAPP_PROVIDER || 'green-api').toLowerCase();
  console.log(`[WhatsAppAPI] Sending via ${provider} to +${normalised}`);

  try {
    switch (provider) {
      case 'ultramsg':   return await sendUltraMsg(normalised, body);
      case 'twilio':     return await sendTwilioWhatsApp(normalised, body);
      case 'green-api':
      default:           return await sendGreenApi(normalised, body);
    }
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`[WhatsAppAPI] ${provider} send failed:`, e.message);
    return { ok: false, error: e.message, provider };
  }
}

/**
 * Check if WhatsApp API credentials are configured.
 */
export function isWhatsAppConfigured(): boolean {
  const provider = (process.env.WHATSAPP_PROVIDER || 'green-api').toLowerCase();
  if (provider === 'twilio') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  }
  return !!(process.env.WHATSAPP_INSTANCE_ID && process.env.WHATSAPP_TOKEN);
}
