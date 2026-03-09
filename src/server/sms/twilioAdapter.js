const SmsAdapter = require('./adapter');
const axios = require('axios');

class TwilioAdapter extends SmsAdapter {
  constructor(config) {
    super(config);
    this.accountSid = config.TWILIO_ACCOUNT_SID;
    this.authToken = config.TWILIO_AUTH_TOKEN;
    this.from = config.TWILIO_FROM; // default sender
    this.baseUrl = 'https://api.twilio.com/2010-04-01';
  }

  async sendSms({ to, from = this.from, body, metadata = {} }) {
    const missing = [];

    if (!this.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!this.authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!from) missing.push('TWILIO_FROM');

    if (missing.length) {
      const error = new Error(
        `Twilio credentials not configured: missing ${missing.join(', ')}`
      );
      error.code = 'TWILIO_CONFIG_MISSING';
      error.missing = missing;
      throw error;
    }

    if (!to) {
      const error = new Error('Twilio "To" phone number is required');
      error.code = 'TWILIO_TO_MISSING';
      throw error;
    }

    if (!body) {
      const error = new Error('Twilio SMS body is required');
      error.code = 'TWILIO_BODY_MISSING';
      throw error;
    }

    const url = `${this.baseUrl}/Accounts/${this.accountSid}/Messages.json`;
    const params = new URLSearchParams();
    params.append('To', to);
    params.append('From', from);
    params.append('Body', body);

    const auth = { username: this.accountSid, password: this.authToken };

    const res = await axios.post(url, params, { auth });
    const data = res.data;
    return { messageId: data.sid, status: data.status, raw: data };
  }

  // Twilio webhook parsing: maps Twilio status to our normalized structure
  async parseWebhook(req) {
    // Twilio sends form-encoded body for status callbacks
    const body = req.body || {};
    return {
      provider: 'twilio',
      messageId: body.MessageSid,
      to: body.To,
      status: body.MessageStatus, // queued, sending, sent, delivered, failed
      raw: body
    };
  }
}

module.exports = TwilioAdapter;
