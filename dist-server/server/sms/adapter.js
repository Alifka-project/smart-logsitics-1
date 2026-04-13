"use strict";
// SMS Adapter interface
// Implementations must export: async sendSms({to, from, body, metadata}) and verifyWebhook(req)
Object.defineProperty(exports, "__esModule", { value: true });
class SmsAdapter {
    constructor(config) {
        this.config = config;
    }
    // Send SMS, return provider response { messageId, status }
    async sendSms(_options) {
        throw new Error('sendSms not implemented');
    }
    // Optionally parse incoming webhook and return normalized status object
    async parseWebhook(_req) {
        throw new Error('parseWebhook not implemented');
    }
}
exports.default = SmsAdapter;
