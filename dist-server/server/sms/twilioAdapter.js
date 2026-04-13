"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Twilio SMS Adapter — DISABLED (not currently in use)
 * D7 Networks is the active SMS provider.
 * This file is kept as a reference implementation.
 * To re-enable: update smsService.ts and api/sms.ts to import this adapter.
 */
const adapter_1 = __importDefault(require("./adapter"));
const axios_1 = __importDefault(require("axios"));
const phoneUtils_1 = require("../utils/phoneUtils");
class TwilioAdapter extends adapter_1.default {
    constructor(config) {
        super(config);
        this.accountSid = config.TWILIO_ACCOUNT_SID;
        this.authToken = config.TWILIO_AUTH_TOKEN;
        this.from = config.TWILIO_FROM;
        this.messagingServiceSid = config.TWILIO_MESSAGING_SERVICE_SID; // preferred for international routing
        this.baseUrl = 'https://api.twilio.com/2010-04-01';
    }
    async sendSms({ to, from = this.from, body, metadata = {} }) {
        const missing = [];
        if (!this.accountSid)
            missing.push('TWILIO_ACCOUNT_SID');
        if (!this.authToken)
            missing.push('TWILIO_AUTH_TOKEN');
        if (!this.messagingServiceSid && !from)
            missing.push('TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');
        if (missing.length) {
            const error = new Error(`Twilio credentials not configured: missing ${missing.join(', ')}`);
            error.code = 'TWILIO_CONFIG_MISSING';
            error.missing = missing;
            throw error;
        }
        if (!to) {
            const error = new Error('Twilio "To" phone number is required');
            error.code = 'TWILIO_TO_MISSING';
            throw error;
        }
        // Normalize UAE phone number — converts 05X, 5X, 971X, 00971X → +971XXXXXXXXX
        const normalizedTo = (0, phoneUtils_1.normalizeUAEPhone)(to);
        if (normalizedTo && normalizedTo !== to) {
            console.log(`[Twilio] Phone normalized: "${to}" → "${normalizedTo}"`);
        }
        if (!(0, phoneUtils_1.isValidUAEPhone)(normalizedTo)) {
            console.warn(`[Twilio] Phone "${normalizedTo}" is not a standard UAE E.164 number — sending anyway`);
        }
        const finalTo = normalizedTo || to;
        if (!body) {
            const error = new Error('Twilio SMS body is required');
            error.code = 'TWILIO_BODY_MISSING';
            throw error;
        }
        const url = `${this.baseUrl}/Accounts/${this.accountSid}/Messages.json`;
        const params = new URLSearchParams();
        params.append('To', finalTo);
        params.append('Body', body);
        // Use MessagingServiceSid for better international routing (avoids carrier blocks)
        // Otherwise fall back to direct From number
        if (this.messagingServiceSid) {
            params.append('MessagingServiceSid', this.messagingServiceSid);
            console.log(`[Twilio] Using MessagingService: ${this.messagingServiceSid}`);
        }
        else {
            params.append('From', from);
            console.log(`[Twilio] Using direct From: ${from}`);
        }
        const auth = { username: this.accountSid, password: this.authToken };
        const res = await axios_1.default.post(url, params, { auth });
        const data = res.data;
        return { messageId: data.sid, status: data.status, raw: data };
    }
    // Twilio webhook parsing: maps Twilio status to our normalized structure
    async parseWebhook(req) {
        // Twilio sends form-encoded body for status callbacks
        const body = (req.body || {});
        return {
            provider: 'twilio',
            messageId: body.MessageSid,
            to: body.To,
            status: body.MessageStatus, // queued, sending, sent, delivered, failed
            raw: body
        };
    }
}
exports.default = TwilioAdapter;
