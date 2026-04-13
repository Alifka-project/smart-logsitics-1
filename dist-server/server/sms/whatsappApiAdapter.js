"use strict";
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
 * Meta / business-initiated WhatsApp (D7 template):
 *   Outbound messages outside the 24h customer window must use an APPROVED template.
 *   Set D7_WHATSAPP_CONFIRMATION_TEMPLATE to the template name from D7 (after Meta approval).
 *   Body variables {{1}}..{{4}} map to: customer name, order ref (#PO…), confirmation URL, assistance phone.
 *
 * Optional:
 *   WHATSAPP_PROVIDER=d7      — force D7 (default when D7 token + WA originator are set)
 *   WHATSAPP_PROVIDER=green-api | ultramsg | twilio — legacy / alternate providers
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppDeliveryConfirmation = sendWhatsAppDeliveryConfirmation;
exports.sendWhatsApp = sendWhatsApp;
exports.isWhatsAppConfigured = isWhatsAppConfigured;
exports.logWhatsAppStartupDiagnostics = logWhatsAppStartupDiagnostics;
const https_1 = __importDefault(require("https"));
const http_1 = __importDefault(require("http"));
const axios_1 = __importDefault(require("axios"));
const phoneUtils_1 = require("../utils/phoneUtils");
/** D7 WhatsApp v2 — see whatsappAdapter.ts (do not use SMS messages/v1/send for WhatsApp). */
const D7_WHATSAPP_SEND_URL = 'https://api.d7networks.com/whatsapp/v2/send';
function stripD7Token(token) {
    return (token || '').replace(/^["'\s]+|["'\s]+$/g, '');
}
/**
 * Normalise to digits-only for building +E.164 (aligns with waLink / existing flows).
 */
function normalisePhoneDigits(raw) {
    let digits = String(raw).replace(/\D/g, '');
    if (digits.startsWith('00'))
        digits = digits.slice(2);
    if (digits.length === 9 && digits.startsWith('5'))
        return '971' + digits;
    if (digits.length === 10 && digits.startsWith('05'))
        return '971' + digits.slice(1);
    return digits;
}
function d7WhatsAppToken() {
    return stripD7Token(process.env.D7_WHATSAPP_TOKEN || process.env.D7_API_TOKEN || '');
}
/** D7 expects originator as digits only (no +), per whatsappAdapter.ts */
function d7WhatsAppOriginatorDigits() {
    const raw = (process.env.D7_WHATSAPP_NUMBER || process.env.D7_WHATSAPP_ORIGINATOR || '').trim();
    return raw.replace(/\D/g, '');
}
function isD7WhatsAppReady() {
    const token = d7WhatsAppToken();
    const origin = d7WhatsAppOriginatorDigits();
    return !!(token && origin.length >= 10);
}
// ── Simple JSON POST helper (non-D7 providers) ───────────────────────────────
function jsonPost(url, body, headers = {}) {
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
        const req = (parsed.protocol === 'https:' ? https_1.default : http_1.default).request(options, (res) => {
            let raw = '';
            res.on('data', (chunk) => { raw += chunk; });
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode || 0, data: JSON.parse(raw) });
                }
                catch {
                    resolve({ statusCode: res.statusCode || 0, data: raw });
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}
function d7RecipientDigits(phoneRaw) {
    const e164 = (0, phoneUtils_1.normalizePhone)(phoneRaw) || `+${normalisePhoneDigits(phoneRaw)}`;
    const recipient = String(e164).replace(/^\+/, '').replace(/\D/g, '');
    if (recipient.length < 7) {
        return { ok: false, error: `invalid_phone: ${phoneRaw}` };
    }
    return { recipient, ok: true };
}
async function postD7WhatsAppV2(messages) {
    const apiToken = d7WhatsAppToken();
    if (!apiToken) {
        return { ok: false, error: 'D7_API_TOKEN or D7_WHATSAPP_TOKEN not set', provider: 'd7' };
    }
    const originator = d7WhatsAppOriginatorDigits();
    if (!originator || originator.length < 10) {
        return {
            ok: false,
            error: 'D7_WHATSAPP_NUMBER or D7_WHATSAPP_ORIGINATOR not set (use digits, e.g. 971588712409)',
            provider: 'd7'
        };
    }
    const payload = { messages };
    console.log('[D7 WhatsApp v2] POST', D7_WHATSAPP_SEND_URL, 'originator:', originator);
    try {
        const res = await axios_1.default.post(D7_WHATSAPP_SEND_URL, payload, {
            timeout: 20000,
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                Authorization: `Bearer ${apiToken}`
            }
        });
        const data = res.data;
        console.log('[D7 WhatsApp v2] Response:', JSON.stringify(data));
        const reqStatus = String(data.status || '').toLowerCase();
        if (reqStatus === 'accepted') {
            return { ok: true, messageId: String(data.request_id || Date.now()), provider: 'd7' };
        }
        if (reqStatus === 'rejected') {
            const hint = ' Check D7 dashboard / template: cold outreach usually needs an approved Meta template (set D7_WHATSAPP_CONFIRMATION_TEMPLATE).';
            return {
                ok: false,
                error: `D7 WhatsApp status=rejected: ${JSON.stringify(data)}.${hint}`,
                provider: 'd7',
            };
        }
        return { ok: false, error: `D7 unexpected response: ${JSON.stringify(data)}`, provider: 'd7' };
    }
    catch (axiosErr) {
        const e = axiosErr;
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
// ── D7 WhatsApp v2 TEXT (session / utility; often blocked for cold outreach) ─
async function sendD7WhatsApp(phoneRaw, message) {
    const rec = d7RecipientDigits(phoneRaw);
    if (rec.ok === false)
        return { ok: false, error: rec.error, provider: 'd7' };
    const originator = d7WhatsAppOriginatorDigits();
    return postD7WhatsAppV2([
        {
            originator,
            content: {
                message_type: 'TEXT',
                text: {
                    preview_url: true,
                    body: message
                }
            },
            recipients: [{ recipient: rec.recipient, recipient_type: 'individual' }]
        }
    ]);
}
/**
 * D7 / Meta template message (4 body variables).
 * Template example: "Dear {{1}}, your order {{2}} ... following {{3}} ... contact {{4}}."
 */
async function sendD7WhatsAppTemplate(phoneRaw, templateName, languageCode, bodyParameters) {
    const rec = d7RecipientDigits(phoneRaw);
    if (rec.ok === false)
        return { ok: false, error: rec.error, provider: 'd7' };
    const originator = d7WhatsAppOriginatorDigits();
    // D7 WhatsApp v2 template format (verified against live API responses):
    //   - field name is `template_id` (not `name`)
    //   - `language` is a plain string enum value (e.g. "en")
    //   - body variables use `body_parameter_values` dict {"0":val,"1":val,...}
    //     NOT Meta-style `components` array — D7 does not parse components and
    //     sees 0 params, causing 400 TEMPLATE_PARAMETER_COUNT_MISMATCH
    const bodyParamValues = {};
    bodyParameters.forEach((text, i) => { bodyParamValues[String(i)] = text; });
    const content = {
        message_type: 'TEMPLATE',
        template: {
            template_id: templateName,
            language: languageCode,
            body_parameter_values: bodyParamValues
        }
    };
    console.log(`[D7 WhatsApp v2] TEMPLATE "${templateName}" lang=${languageCode} → +${rec.recipient}`);
    return postD7WhatsAppV2([
        {
            originator,
            content,
            recipients: [{ recipient: rec.recipient, recipient_type: 'individual' }]
        }
    ]);
}
/** Matches Electrolux SMS/portal copy (customerMessageTemplates). */
const DEFAULT_ASSISTANCE_PHONE = '+971524408687';
/**
 * Build the params array for the confirmation template.
 *
 * D7_WHATSAPP_TEMPLATE_PARAM_COUNT controls how many body variables your
 * approved template has (check the D7 dashboard). Mapping:
 *   1 → [confirmationLink]
 *   2 → [customerName, confirmationLink]
 *   3 → [customerName, orderRef, confirmationLink]
 *   4 → [customerName, orderRef, confirmationLink, assistancePhone]  (default)
 *
 * If the env var is not set, the function auto-cascades: tries 4 → 3 → 2 → 1
 * until D7 accepts the request, so the send always goes through even if
 * D7_WHATSAPP_TEMPLATE_PARAM_COUNT is not configured yet.
 */
function buildTemplateParams(parts, count) {
    const name = (parts.customerName || 'Valued Customer').trim();
    const ref = (parts.poRef || '').trim() || 'your Electrolux order';
    const link = parts.confirmationLink.trim();
    const help = (parts.assistancePhone || DEFAULT_ASSISTANCE_PHONE).trim();
    switch (count) {
        case 1: return [link];
        case 2: return [name, link];
        case 3: return [name, ref, link];
        default: return [name, ref, link, help];
    }
}
/**
 * First-upload / resend confirmation: uses Meta template when D7_WHATSAPP_CONFIRMATION_TEMPLATE is set.
 *
 * Set D7_WHATSAPP_TEMPLATE_PARAM_COUNT in Vercel env to the number of {{variables}}
 * in your approved D7 template (1, 2, 3, or 4).
 * If not set: auto-cascades from 4 down to 1 until D7 accepts.
 */
async function sendWhatsAppDeliveryConfirmation(phone, parts) {
    const provider = resolveWhatsAppProvider();
    if (provider !== 'd7' || !isD7WhatsAppReady()) {
        return sendWhatsApp(phone, parts.fullTextBody);
    }
    const templateName = (process.env.D7_WHATSAPP_CONFIRMATION_TEMPLATE || '').trim();
    const lang = (process.env.D7_WHATSAPP_TEMPLATE_LANGUAGE || 'en').trim();
    if (!templateName) {
        console.warn('[D7 WhatsApp] No D7_WHATSAPP_CONFIRMATION_TEMPLATE — sending TEXT. Meta usually requires an approved template for first contact; customers may not receive plain TEXT.');
        return sendD7WhatsApp(phone, parts.fullTextBody);
    }
    const configuredCount = parseInt(process.env.D7_WHATSAPP_TEMPLATE_PARAM_COUNT || '0', 10);
    if (configuredCount >= 1 && configuredCount <= 4) {
        // User explicitly set the param count — send exactly that many
        const params = buildTemplateParams(parts, configuredCount);
        console.log(`[D7 WhatsApp] Template "${templateName}" with ${configuredCount} param(s) (D7_WHATSAPP_TEMPLATE_PARAM_COUNT=${configuredCount})`);
        return sendD7WhatsAppTemplate(phone, templateName, lang, params);
    }
    // D7_WHATSAPP_TEMPLATE_PARAM_COUNT not set — cascade 4 → 3 → 2 → 1
    console.log(`[D7 WhatsApp] D7_WHATSAPP_TEMPLATE_PARAM_COUNT not set — auto-cascading param counts for template "${templateName}"`);
    for (const count of [4, 3, 2, 1]) {
        const params = buildTemplateParams(parts, count);
        const result = await sendD7WhatsAppTemplate(phone, templateName, lang, params);
        if (result.ok) {
            console.log(`[D7 WhatsApp] Template accepted with ${count} param(s) — set D7_WHATSAPP_TEMPLATE_PARAM_COUNT=${count} to skip cascade next time`);
            return result;
        }
        // Only retry on parameter count mismatch; stop on other errors
        if (!result.error?.includes('TEMPLATE_PARAMETER_COUNT_MISMATCH') && !result.error?.includes('Parameters count')) {
            console.warn(`[D7 WhatsApp] Template failed (non-count error) with ${count} param(s): ${result.error}`);
            return result;
        }
        console.warn(`[D7 WhatsApp] Count mismatch with ${count} param(s), trying fewer...`);
    }
    return { ok: false, error: 'Template rejected for all param counts (1–4). Check D7 dashboard for template variable count.', provider: 'd7' };
}
// ── Green API ────────────────────────────────────────────────────────────────
async function sendGreenApi(phone, message) {
    const instanceId = process.env.WHATSAPP_INSTANCE_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!instanceId || !token) {
        return { ok: false, error: 'WHATSAPP_INSTANCE_ID / WHATSAPP_TOKEN not set' };
    }
    const chatId = `${phone}@c.us`;
    const url = `https://api.green-api.com/waInstance${instanceId}/sendMessage/${token}`;
    const res = await jsonPost(url, { chatId, message });
    const data = res.data;
    if (res.statusCode === 200 && data.idMessage) {
        return { ok: true, messageId: String(data.idMessage), provider: 'green-api' };
    }
    return { ok: false, error: JSON.stringify(data), provider: 'green-api' };
}
// ── UltraMsg ─────────────────────────────────────────────────────────────────
async function sendUltraMsg(phone, message) {
    const instanceId = process.env.WHATSAPP_INSTANCE_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!instanceId || !token) {
        return { ok: false, error: 'WHATSAPP_INSTANCE_ID / WHATSAPP_TOKEN not set' };
    }
    const url = `https://api.ultramsg.com/${instanceId}/messages/chat`;
    const res = await jsonPost(url, { token, to: `+${phone}`, body: message });
    const data = res.data;
    if (res.statusCode === 200 && data.sent === 'true') {
        return { ok: true, messageId: String(data.id || Date.now()), provider: 'ultramsg' };
    }
    return { ok: false, error: JSON.stringify(data), provider: 'ultramsg' };
}
// ── Twilio WhatsApp ───────────────────────────────────────────────────────────
async function sendTwilioWhatsApp(phone, message) {
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
    const result = await new Promise((resolve, reject) => {
        const options = {
            hostname: parsed.hostname,
            path: parsed.pathname,
            method: 'POST',
            headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
        };
        const req = https_1.default.request(options, (res) => {
            let raw = '';
            res.on('data', (c) => { raw += c; });
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode || 0, data: JSON.parse(raw) });
                }
                catch {
                    resolve({ statusCode: res.statusCode || 0, data: raw });
                }
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
    const data = result.data;
    if (result.statusCode === 201 && data.sid) {
        return { ok: true, messageId: String(data.sid), provider: 'twilio-whatsapp' };
    }
    return { ok: false, error: JSON.stringify(data), provider: 'twilio-whatsapp' };
}
/** Resolve provider: explicit WHATSAPP_PROVIDER, else D7 if ready, else Green API if keys set. */
function resolveWhatsAppProvider() {
    const explicit = (process.env.WHATSAPP_PROVIDER || '').trim().toLowerCase();
    if (explicit)
        return explicit;
    if (isD7WhatsAppReady())
        return 'd7';
    if (process.env.WHATSAPP_INSTANCE_ID && process.env.WHATSAPP_TOKEN)
        return 'green-api';
    return 'd7';
}
/**
 * Send a WhatsApp message silently from the backend.
 */
async function sendWhatsApp(phone, body) {
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
    }
    catch (err) {
        const e = err;
        console.error(`[WhatsAppAPI] ${provider} send failed:`, e.message);
        return { ok: false, error: e.message, provider };
    }
}
/**
 * True when WhatsApp can be sent without wa.me fallback.
 */
function isWhatsAppConfigured() {
    const provider = resolveWhatsAppProvider();
    if (provider === 'd7')
        return isD7WhatsAppReady();
    if (provider === 'twilio') {
        return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    }
    if (provider === 'ultramsg' || provider === 'green-api') {
        return !!(process.env.WHATSAPP_INSTANCE_ID && process.env.WHATSAPP_TOKEN);
    }
    return isD7WhatsAppReady();
}
/**
 * One-line startup diagnostics (no secrets). Call from server bootstrap.
 */
function logWhatsAppStartupDiagnostics() {
    const provider = resolveWhatsAppProvider();
    const ready = isWhatsAppConfigured();
    const tokenSms = !!(process.env.D7_API_TOKEN || '').replace(/\s/g, '');
    const tokenWa = !!(process.env.D7_WHATSAPP_TOKEN || '').replace(/\s/g, '');
    const origin = d7WhatsAppOriginatorDigits();
    const tpl = (process.env.D7_WHATSAPP_CONFIRMATION_TEMPLATE || '').trim();
    console.log('[WhatsApp] Resolved provider:', provider, '| API configured (silent send):', ready);
    if (provider === 'd7' || (!process.env.WHATSAPP_PROVIDER && tokenSms && !ready)) {
        console.log('[WhatsApp] D7: SMS token set:', tokenSms, '| WA-only token:', tokenWa, '| Business number (originator):', origin ? `${origin.slice(0, 4)}… (${origin.length} digits)` : 'MISSING — set D7_WHATSAPP_NUMBER');
        console.log('[WhatsApp] D7 confirmation template:', tpl || 'NOT SET — outbound confirmations may need an approved Meta template (D7_WHATSAPP_CONFIRMATION_TEMPLATE)');
    }
    if (provider === 'green-api' || provider === 'ultramsg') {
        console.log('[WhatsApp] Green/Ultra: INSTANCE_ID', process.env.WHATSAPP_INSTANCE_ID ? 'set' : 'MISSING', '| TOKEN', process.env.WHATSAPP_TOKEN ? 'set' : 'MISSING');
    }
    if (!ready) {
        console.warn('[WhatsApp] Silent API send is OFF — confirmations use wa.me link fallback only (no automatic message to customer). Fix env vars above.');
    }
}
