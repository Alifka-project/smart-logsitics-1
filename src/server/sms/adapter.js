// SMS Adapter interface
// Implementations must export: async sendSms({to, from, body, metadata}) and verifyWebhook(req)

class SmsAdapter {
  constructor(config) {
    this.config = config;
  }

  // Send SMS, return provider response { messageId, status }
  async sendSms({ to, from, body, metadata = {} }) {
    throw new Error('sendSms not implemented');
  }

  // Optionally parse incoming webhook and return normalized status object
  async parseWebhook(req) {
    throw new Error('parseWebhook not implemented');
  }
}

module.exports = SmsAdapter;
