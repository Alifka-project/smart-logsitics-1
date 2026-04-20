"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const auth_js_1 = require("../auth.js");
const db = __importStar(require("../db/index.js"));
const prisma_js_1 = __importDefault(require("../db/prisma.js"));
const sapService = { call: async (..._args) => ({ data: {} }) };
const { autoAssignDelivery } = require('../services/autoAssignmentService');
const router = (0, express_1.Router)();
// Initialize SMS adapter — D7 Networks is the active provider.
// Twilio adapter is kept in codebase but disabled (not currently used).
let smsAdapter;
try {
    const D7Adapter = require('../sms/d7Adapter.js').default;
    smsAdapter = new D7Adapter(process.env);
    console.log('[SMS] D7 Networks adapter initialized');
}
catch (e) {
    console.warn('[SMS] D7 adapter not available, SMS sending will be mocked');
    smsAdapter = {
        sendSms: async ({ to, body }) => {
            console.log(`[SMS MOCK] Would send to ${to}: ${body}`);
            return { messageId: `mock-${Date.now()}`, status: 'queued' };
        }
    };
}
// NOTE: Twilio adapter is kept in src/server/sms/twilioAdapter.ts as a reference
// implementation but is NOT active. To re-enable, swap the D7Adapter import above.
// const TwilioAdapter = require('../sms/twilioAdapter.js').default;
// POST /api/sms/send - Send SMS
router.post('/send', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { to, body, deliveryId } = req.body;
        if (!to || !body) {
            res.status(400).json({ error: 'to_and_body_required' });
            return;
        }
        const result = await smsAdapter.sendSms({
            to,
            body,
            metadata: { deliveryId, sentBy: req.user.sub }
        });
        try {
            await db.query(`INSERT INTO sms_confirmations(delivery_id, phone, provider, message_id, status, attempts, metadata)
         VALUES($1, $2, $3, $4, $5, 1, $6)`, [
                deliveryId || null,
                to,
                process.env.SMS_PROVIDER || 'd7',
                result.messageId,
                result.status,
                JSON.stringify({ body, sentBy: req.user.sub, timestamp: new Date().toISOString() })
            ]);
        }
        catch (dbErr) {
            console.error('[SMS] Failed to log to database:', dbErr);
        }
        res.json({ ok: true, messageId: result.messageId, status: result.status });
    }
    catch (err) {
        const e = err;
        console.error('sms/send error', err);
        res.status(500).json({ error: 'sms_send_failed' });
    }
});
// POST /api/sms/send-confirmation — used by Manage orders "Resend SMS" (label unchanged).
// Backend sends via WhatsApp API while D7 SMS is paused; same flow as /deliveries/:id/send-sms.
router.post('/send-confirmation', auth_js_1.authenticate, (0, auth_js_1.requireAnyRole)('admin', 'delivery_team', 'logistics_team'), async (req, res) => {
    try {
        const { deliveryId } = req.body;
        if (!deliveryId) {
            res.status(400).json({ error: 'delivery_id_required' });
            return;
        }
        const delivery = await prisma_js_1.default.delivery.findUnique({
            where: { id: deliveryId },
            select: { id: true, phone: true }
        });
        if (!delivery) {
            res.status(404).json({ error: 'delivery_not_found' });
            return;
        }
        if (!delivery.phone) {
            res.status(400).json({ error: 'no_phone_number' });
            return;
        }
        const { sendConfirmationSms } = await Promise.resolve().then(() => __importStar(require('../sms/smsService.js')));
        const result = await sendConfirmationSms(delivery.id, delivery.phone);
        res.json({
            ok: true,
            messageId: result.messageId,
            status: 'sent',
            expiresAt: result.expiresAt,
            ...(result.whatsappUrl ? { whatsappUrl: result.whatsappUrl } : {}),
        });
    }
    catch (err) {
        const e = err;
        console.error('sms/send-confirmation error', err);
        res.status(500).json({ error: 'sms_confirmation_failed', message: e.message });
    }
});
// POST /api/sms/confirm - Customer confirms via SMS (public endpoint)
// This is also exported separately for use without authentication
const confirmHandler = async (req, res) => {
    try {
        const { deliveryId, code } = req.body;
        if (!deliveryId || !code) {
            res.status(400).json({ error: 'delivery_id_and_code_required' });
            return;
        }
        const eventsResp = await db.query(`SELECT payload FROM delivery_events 
       WHERE delivery_id = $1 AND event_type = 'sms_confirmation_sent'
       ORDER BY created_at DESC LIMIT 1`, [deliveryId]);
        if (eventsResp.rows.length === 0) {
            res.status(404).json({ error: 'confirmation_not_found' });
            return;
        }
        const eventPayload = eventsResp.rows[0].payload;
        const storedCode = eventPayload.code;
        if (storedCode !== code) {
            res.status(400).json({ error: 'invalid_confirmation_code' });
            return;
        }
        try {
            await sapService.call(`/Deliveries/${deliveryId}/status`, 'post', {
                status: 'scheduled-confirmed',
                actor_type: 'customer',
                note: 'Customer confirmed via SMS'
            });
        }
        catch (updateErr) {
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
                await autoAssignDelivery(deliveryId);
            }
        }
        catch (assignErr) {
            console.warn('[SMS] scheduled-confirmed auto-assign failed:', assignErr.message);
        }
        await db.query(`INSERT INTO delivery_events(delivery_id, event_type, payload, actor_type)
       VALUES($1, 'sms_confirmation_received', $2, 'customer')`, [deliveryId, JSON.stringify({ code, timestamp: new Date().toISOString() })]);
        res.json({ ok: true, message: 'Delivery confirmed successfully' });
    }
    catch (err) {
        const e = err;
        console.error('sms/confirm error', err);
        res.status(500).json({ error: 'confirmation_failed' });
    }
};
router.post('/confirm', confirmHandler);
// Export confirm handler for public access (without authentication)
router.confirm = confirmHandler;
// GET /api/sms/delivery-info/:id — public endpoint; returns safe display-only fields
// Used by the legacy /track/:deliveryId confirmation page.
router.get('/delivery-info/:id', async (req, res) => {
    const { id } = req.params;
    if (!id) {
        res.status(400).json({ error: 'id_required' });
        return;
    }
    try {
        const result = await db.query(`SELECT id, customer, address, po_number AS "poNumber", status, items
       FROM deliveries WHERE id = $1 LIMIT 1`, [id]);
        if (!result.rows.length) {
            res.status(404).json({ error: 'not_found' });
            return;
        }
        const row = result.rows[0];
        // Only expose safe display fields — no phone/lat/lng
        res.json({ ok: true, delivery: { id: row.id, customer: row.customer, address: row.address, poNumber: row.poNumber, status: row.status, items: row.items } });
    }
    catch (err) {
        const e = err;
        console.error('[SMS] delivery-info error:', e.message);
        res.status(500).json({ error: 'db_error' });
    }
});
// GET /api/sms/whatsapp-diagnostics — admin-only live D7 config + connectivity check
// Returns raw D7 response so you can see exactly what the API says.
// Query params:
//   ?phone=6281290202027          → sends a plain TEXT test (will be rejected for cold numbers)
//   ?phone=...&template_test=1    → sends the real TEMPLATE used for confirmations (proper test)
router.get('/whatsapp-diagnostics', auth_js_1.authenticate, (0, auth_js_1.requireRole)('admin'), async (req, res) => {
    try {
        const { isWhatsAppConfigured, sendWhatsAppDeliveryConfirmation } = await Promise.resolve().then(() => __importStar(require('../sms/whatsappApiAdapter.js')));
        const axios = (await Promise.resolve().then(() => __importStar(require('axios')))).default;
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
        const testPhone = (req.query.phone || '').replace(/\D/g, '');
        const useTemplateTest = req.query.template_test === '1';
        let d7Response = null;
        let d7Error = null;
        let templateResult = null;
        if (testPhone) {
            if (useTemplateTest) {
                // ── Template test: fires the real sendWhatsAppDeliveryConfirmation path ──
                // This is exactly what upload/resend does — use this to verify templates work.
                const testLink = `${process.env.FRONTEND_URL || 'https://electrolux-smart-portal.vercel.app'}/confirm-delivery/test-diag-link`;
                console.log(`[Diagnostics] Template test → +${testPhone}, template="${template}", lang="${lang}"`);
                try {
                    templateResult = await sendWhatsAppDeliveryConfirmation(`+${testPhone}`, {
                        fullTextBody: '[D7 test] WhatsApp template check from Electrolux portal.',
                        customerName: 'Test Customer',
                        poRef: '#TEST-001',
                        confirmationLink: testLink,
                        assistancePhone: '+971524408687',
                    });
                    console.log(`[Diagnostics] Template test result:`, JSON.stringify(templateResult));
                }
                catch (e) {
                    const err = e;
                    templateResult = { ok: false, error: err.message };
                }
            }
            else if (token && originator) {
                // ── Plain TEXT test (kept for connectivity check only — will be rejected for cold numbers) ──
                const payload = {
                    messages: [{
                            originator,
                            content: {
                                message_type: 'TEXT',
                                text: { preview_url: false, body: '[D7 test] WhatsApp TEXT connectivity check from Electrolux portal.' }
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
                }
                catch (e) {
                    const axErr = e;
                    d7Error = { httpStatus: axErr.response?.status, body: axErr.response?.data, message: axErr.message };
                }
            }
        }
        res.json({
            ok: true,
            config,
            ...(testPhone && useTemplateTest ? { testPhone, templateTest: templateResult } : {}),
            ...(testPhone && !useTemplateTest ? { testPhone, d7Response, d7Error } : {}),
        });
    }
    catch (err) {
        const e = err;
        res.status(500).json({ ok: false, error: e.message });
    }
});
exports.default = router;
