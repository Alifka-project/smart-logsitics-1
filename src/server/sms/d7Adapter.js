const SmsAdapter = require('./adapter');
const axios = require('axios');
const { normalizeUAEPhone, isValidUAEPhone } = require('../utils/phoneUtils');

const D7_API_URL = 'https://api.d7networks.com/messages/v1/send';

class D7Adapter extends SmsAdapter {
  constructor(config) {
    super(config);
    this.apiToken = config.D7_API_TOKEN;
    this.originator = config.D7_ORIGINATOR || 'Electrolux';
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

    // Normalize UAE phone number → +971XXXXXXXXX
    const normalizedTo = normalizeUAEPhone(to);
    if (normalizedTo && normalizedTo !== to) {
      console.log(`[D7] Phone normalized: "${to}" → "${normalizedTo}"`);
    }
    if (!isValidUAEPhone(normalizedTo)) {
      console.warn(`[D7] Phone "${normalizedTo}" is not a standard UAE E.164 number — sending anyway`);
    }
    to = normalizedTo || to;

    const payload = {
      messages: [
        {
          channel: 'sms',
          recipients: [to],
          content: body,
          msg_type: 'text',
          data_coding: 'text'
        }
      ],
      message_globals: {
        originator: this.originator
      }
    };

    console.log(`[D7] Sending SMS to ${to} via D7 Networks`);

    const res = await axios.post(D7_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${this.apiToken}`
      }
    });

    const data = res.data;
    // D7 returns: { request_id, status, created_at }
    if (data.status !== 'accepted') {
      const error = new Error(`D7 rejected message: ${JSON.stringify(data)}`);
      error.code = 'D7_REJECTED';
      throw error;
    }

    console.log(`[D7] SMS accepted, request_id: ${data.request_id}`);
    return { messageId: data.request_id, status: data.status, raw: data };
  }

  async parseWebhook(req) {
    const body = req.body || {};
    return {
      provider: 'd7',
      messageId: body.request_id,
      to: body.to,
      status: body.status,
      raw: body
    };
  }
}

module.exports = D7Adapter;
