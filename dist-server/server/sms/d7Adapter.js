"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const adapter_1 = __importDefault(require("./adapter"));
const axios_1 = __importDefault(require("axios"));
const phoneUtils_1 = require("../utils/phoneUtils");
// Regular SMS endpoint — works for most countries but UAE carrier blocks all
// unregistered senders (requires TRA registration, takes 3-7 business days)
const D7_SMS_URL = 'https://api.d7networks.com/messages/v1/send';
// OTP endpoint — uses D7's pre-approved short-code routes that bypass UAE
// carrier restrictions. Accepts custom message_text with {{otp}} placeholder.
const D7_OTP_URL = 'https://api.d7networks.com/verify/v1/otp/send-otp';
class D7Adapter extends adapter_1.default {
    constructor(config) {
        super(config);
        // Strip any surrounding quotes, newlines, or whitespace that can corrupt the header
        this.apiToken = (config.D7_API_TOKEN || '').replace(/^["'\s]+|["'\s]+$/g, '');
        this.originator = (config.D7_ORIGINATOR || 'SignOTP').trim();
    }
    async sendSms({ to, body, metadata = {} }) {
        if (!this.apiToken) {
            const error = new Error('D7 Networks credentials not configured: missing D7_API_TOKEN');
            error.code = 'D7_CONFIG_MISSING';
            throw error;
        }
        if (!to) {
            const error = new Error('D7 "To" phone number is required');
            error.code = 'D7_TO_MISSING';
            throw error;
        }
        if (!body) {
            const error = new Error('D7 SMS body is required');
            error.code = 'D7_BODY_MISSING';
            throw error;
        }
        // Normalize phone: UAE local formats → +971XXXXXXXXX, international → kept as-is
        const normalizedTo = (0, phoneUtils_1.normalizePhone)(to);
        if (normalizedTo && normalizedTo !== to) {
            console.log(`[D7] Phone normalized: "${to}" → "${normalizedTo}"`);
        }
        if (!(0, phoneUtils_1.isValidPhone)(normalizedTo)) {
            console.warn(`[D7] Phone "${normalizedTo}" does not look like a valid E.164 number — sending anyway`);
        }
        const finalTo = normalizedTo || to;
        // Use OTP route for UAE (+971) — bypasses carrier rejection of unregistered senders.
        // For non-UAE numbers, fall back to regular SMS API.
        const isUAE = finalTo.startsWith('+971');
        if (isUAE) {
            return this._sendViaOtp(finalTo, body);
        }
        return this._sendViaSms(finalTo, body);
    }
    // ── OTP route (UAE) ────────────────────────────────────────────────────────
    // The OTP API uses D7's pre-registered short codes accepted by UAE carriers.
    // We embed the full confirmation message in message_text; {{otp}} becomes a
    // 6-digit ref code appended at the end. Customers just click the link.
    async _sendViaOtp(to, body) {
        // Append the {{otp}} placeholder as a reference code at the end
        const messageWithCode = `${body}\n\nRef: {{otp}}`;
        const payload = {
            originator: this.originator,
            recipient: to,
            expiry: 172800, // 48 hours — matches the confirmation link expiry
            data_coding: 'text',
            otp_length: 6,
            message_text: messageWithCode
        };
        console.log(`[D7] Sending delivery confirmation via OTP route to ${to}`);
        let res;
        try {
            res = await axios_1.default.post(D7_OTP_URL, payload, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
        }
        catch (axiosErr) {
            const e = axiosErr;
            const status = e.response?.status;
            const responseBody = e.response?.data;
            const errCode = e.code || 'NO_CODE';
            const errMsg = e.message || 'no message';
            console.error(`[D7] OTP request failed — code: ${errCode}, message: ${errMsg}, HTTP: ${status}, body:`, JSON.stringify(responseBody));
            const err = new Error(`D7 OTP failed [${errCode}]: ${errMsg} | HTTP ${status} | ${JSON.stringify(responseBody)}`);
            err.code = 'D7_OTP_HTTP_ERROR';
            err.response = e.response;
            throw err;
        }
        const data = res.data;
        console.log(`[D7] OTP response:`, JSON.stringify(data));
        if (!data.otp_id) {
            const error = new Error(`D7 OTP rejected: ${JSON.stringify(data)}`);
            error.code = 'D7_OTP_REJECTED';
            throw error;
        }
        console.log(`[D7] OTP route accepted, otp_id: ${data.otp_id}, status: ${data.status}`);
        return { messageId: data.otp_id, status: data.status || 'sent', raw: data };
    }
    // ── Regular SMS route (non-UAE) ────────────────────────────────────────────
    async _sendViaSms(to, body) {
        const payload = {
            messages: [{
                    channel: 'sms',
                    recipients: [to],
                    content: body,
                    msg_type: 'text',
                    data_coding: 'text'
                }],
            message_globals: {
                originator: this.originator
            }
        };
        console.log(`[D7] Sending SMS to ${to} via D7 regular SMS, originator: ${this.originator}`);
        let res;
        try {
            res = await axios_1.default.post(D7_SMS_URL, payload, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${this.apiToken}`
                }
            });
        }
        catch (axiosErr) {
            const e = axiosErr;
            const status = e.response?.status;
            const responseBody = e.response?.data;
            const errCode = e.code || 'NO_CODE';
            const errMsg = e.message || 'no message';
            console.error(`[D7] SMS request failed — code: ${errCode}, message: ${errMsg}, HTTP: ${status}, body:`, JSON.stringify(responseBody));
            const err = new Error(`D7 SMS failed [${errCode}]: ${errMsg} | HTTP ${status} | ${JSON.stringify(responseBody)}`);
            err.code = 'D7_HTTP_ERROR';
            err.response = e.response;
            throw err;
        }
        const data = res.data;
        console.log(`[D7] SMS response:`, JSON.stringify(data));
        if (data.status !== 'accepted') {
            const error = new Error(`D7 SMS rejected: ${JSON.stringify(data)}`);
            error.code = 'D7_REJECTED';
            throw error;
        }
        console.log(`[D7] SMS accepted, request_id: ${data.request_id}`);
        return { messageId: data.request_id, status: data.status, raw: data };
    }
    async parseWebhook(req) {
        const body = (req.body || {});
        return {
            provider: 'd7',
            messageId: (body.request_id || body.otp_id),
            to: (body.to || body.recipient),
            status: body.status,
            raw: body
        };
    }
}
exports.default = D7Adapter;
