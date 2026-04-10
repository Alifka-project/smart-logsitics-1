/**
 * WhatsApp API Adapter — silent backend send (same UX as SMS).
 *
 * Primary provider: D7 Networks WhatsApp API v2 (NOT the SMS /messages/v1/send endpoint).
 *   POST https://api.d7networks.com/whatsapp/v2/send
 *   Same Bearer token style as SMS; payload matches src/server/sms/whatsappAdapter.ts.
 *
 * Required env (D7 WhatsApp):
 *   D7_API_TOKEN              — D7 API token (JWT), same as SMS unless you set D7_WHATSAPP_TOKEN
 *   D7_WHATSAPP_TOKEN         — optional; if set, used instead of D7_API_TOKEN for WhatsApp only
 *   D7_WHATSAPP_NUMBER        — WhatsApp Business number registered in D7, digits only (e.g. 971588712409)
 *   D7_WHATSAPP_ORIGINATOR    — alias for D7_WHATSAPP_NUMBER (+971… or digits — normalised to digits)
 *
 * Optional:
 *   WHATSAPP_PROVIDER=d7      — force D7 (default when D7 token + WA originator are set)
 *   WHATSAPP_PROVIDER=green-api | ultramsg | twilio — legacy / alternate providers
 */

import https from 'https';
import http from 'http';
import axios, { AxiosError } from 'axios';
import { normalizePhone as normalizePhoneE164 } from '../utils/phoneUtils';

export interface WhatsAppSendResult {
  ok: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

/** D7 WhatsApp v2 — see whatsappAdapter.ts (do not use SMS messages/v1/send for WhatsApp). */
const D7_WHATSAPP_SEND_URL = 'https://api.d7networks.com/whatsapp/v2/send';

function stripD7Token(token: string): string {
  return (token || '').replace(/^["'\s]+|["'\s]+$/g, '');
}

/**
 * Normalise to digits-only for building +E.164 (aligns with waLink / existing flows).
 */
function normalisePhoneDigits(raw: string): string {
  let digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 9 && digits.startsWith('5')) return '971' + digits;
  if (digits.length === 10 && digits.startsWith('05')) return '971' + digits.slice(1);
  return digits;
}

function d7WhatsAppToken(): string {
  return stripD7Token(process.env.D7_WHATSAPP_TOKEN || process.env.D7_API_TOKEN || '');
}

/** D7 expects originator as digits only (no +), per whatsappAdapter.ts */
function d7WhatsAppOriginatorDigits(): string {
  const raw = (process.env.D7_WHATSAPP_NUMBER || process.env.D7_WHATSAPP_ORIGINATOR || '').trim();
  return raw.replace(/\D/g, '');
}

function isD7WhatsAppReady(): boolean {
  const token = d7WhatsAppToken();
  const origin = d7WhatsAppOriginatorDigits();
  return !!(token && origin.length >= 10);
}

// ── Simple JSON POST helper (non-D7 providers) ───────────────────────────────
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

// ── D7 WhatsApp v2 (dedicated endpoint — not SMS channel) ────────────────────
async function sendD7WhatsApp(phoneRaw: string, message: string): Promise<WhatsAppSendResult> {
  const apiToken = d7WhatsAppToken();
  const originator = d7WhatsAppOriginatorDigits();
  if (!apiToken) {
    return { ok: false, error: 'D7_API_TOKEN or D7_WHATSAPP_TOKEN not set', provider: 'd7' };
  }
  if (!originator || originator.length < 10) {
    return {
      ok: false,
      error: 'D7_WHATSAPP_NUMBER or D7_WHATSAPP_ORIGINATOR not set (use digits, e.g. 971588712409)',
      provider: 'd7'
    };
  }

  const e164 = normalizePhoneE164(phoneRaw) || `+${normalisePhoneDigits(phoneRaw)}`;
  const recipient = String(e164).replace(/^\+/, '').replace(/\D/g, '');

  const payload = {
    messages: [
      {
        originator,
        content: {
          message_type: 'TEXT',
          text: {
            preview_url: true,
            body: message
          }
        },
        recipients: [
          {
            recipient,
            recipient_type: 'individual'
          }
        ]
      }
    ]
  };

  console.log(`[D7 WhatsApp v2] Sending to +${recipient}, originator: ${originator}`);

  try {
    const res = await axios.post(D7_WHATSAPP_SEND_URL, payload, {
      timeout: 20000,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${apiToken}`
      }
    });
    const data = res.data as Record<string, unknown>;
    console.log('[D7 WhatsApp v2] Response:', JSON.stringify(data));
    if (data.status === 'accepted') {
      return { ok: true, messageId: String(data.request_id || Date.now()), provider: 'd7' };
    }
    return { ok: false, error: `D7 rejected: ${JSON.stringify(data)}`, provider: 'd7' };
  } catch (axiosErr: unknown) {
    const e = axiosErr as AxiosError;
    const status = e.response?.status;
    const body = e.response?.data;
    console.error('[D7 WhatsApp v2] HTTP error:', status, JSON.stringify(body));
    return {
      ok: false,
      error: `D7 WhatsApp failed HTTP ${status}: ${JSON.stringify(body) || e.message}`,
      provider: 'd7'
    };
  }
}

// ── Green API ────────────────────────────────────────────────────────────────
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

// ── UltraMsg ─────────────────────────────────────────────────────────────────
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
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  };

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

/** Resolve provider: explicit WHATSAPP_PROVIDER, else D7 if ready, else Green API if keys set. */
function resolveWhatsAppProvider(): string {
  const explicit = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
  if (explicit) return explicit;
  if (isD7WhatsAppReady()) return 'd7';
  if (process.env.WHATSAPP_INSTANCE_ID && process.env.WHATSAPP_TOKEN) return 'green-api';
  return 'd7';
}

/**
 * Send a WhatsApp message silently from the backend.
 */
export async function sendWhatsApp(phone: string, body: string): Promise<WhatsAppSendResult> {
  const normalised = normalisePhoneDigits(phone);
  if (normalised.length < 7) {
    console.warn(`[WhatsAppAPI] Invalid phone "${phone}" → "${normalised}" — skipping`);
    return { ok: false, error: `invalid_phone: ${phone}` };
  }

  const provider = resolveWhatsAppProvider();
  console.log(`[WhatsAppAPI] Sending via ${provider}`);

  try {
    switch (provider) {
      case 'd7':
        return await sendD7WhatsApp(phone, body);
      case 'ultramsg':
        return await sendUltraMsg(normalised, body);
      case 'twilio':
        return await sendTwilioWhatsApp(normalised, body);
      case 'green-api':
      default:
        return await sendGreenApi(normalised, body);
    }
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`[WhatsAppAPI] ${provider} send failed:`, e.message);
    return { ok: false, error: e.message, provider };
  }
}

/**
 * True when WhatsApp can be sent without wa.me fallback.
 */
export function isWhatsAppConfigured(): boolean {
  const provider = resolveWhatsAppProvider();
  if (provider === 'd7') return isD7WhatsAppReady();
  if (provider === 'twilio') {
    return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  }
  if (provider === 'ultramsg' || provider === 'green-api') {
    return !!(process.env.WHATSAPP_INSTANCE_ID && process.env.WHATSAPP_TOKEN);
  }
  return isD7WhatsAppReady();
}
