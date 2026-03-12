const axios = require('axios');

const D7_WA_URL = 'https://api.d7networks.com/whatsapp/v2/send';

class WhatsAppAdapter {
  constructor(config) {
    this.apiToken = (config.D7_API_TOKEN || '').replace(/^["'\s]+|["'\s]+$/g, '');
    // WhatsApp business number registered in D7 (e.g. 15559261029)
    this.originator = (config.D7_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  }

  async sendMessage({ to, body }) {
    if (!this.apiToken) throw Object.assign(new Error('D7_API_TOKEN not configured'), { code: 'WA_CONFIG_MISSING' });
    if (!this.originator) throw Object.assign(new Error('D7_WHATSAPP_NUMBER not configured'), { code: 'WA_CONFIG_MISSING' });

    // Strip leading + for D7 WhatsApp recipient format
    const recipient = String(to).replace(/^\+/, '');

    const payload = {
      messages: [{
        originator: this.originator,
        content: {
          message_type: 'TEXT',
          text: {
            preview_url: true,
            body
          }
        },
        recipients: [{
          recipient,
          recipient_type: 'individual'
        }]
      }]
    };

    console.log(`[WhatsApp] Sending to ${to} via D7 WhatsApp (originator: ${this.originator})`);

    let res;
    try {
      res = await axios.post(D7_WA_URL, payload, {
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${this.apiToken}`
        }
      });
    } catch (axiosErr) {
      const status = axiosErr.response?.status;
      const body = axiosErr.response?.data;
      const errCode = axiosErr.code || 'NO_CODE';
      const errMsg = axiosErr.message || 'no message';
      console.error(`[WhatsApp] Request failed — code: ${errCode}, HTTP: ${status}, body:`, JSON.stringify(body));
      const err = new Error(`WhatsApp failed [${errCode}]: ${errMsg} | HTTP ${status} | ${JSON.stringify(body)}`);
      err.code = 'WA_HTTP_ERROR';
      err.response = axiosErr.response;
      throw err;
    }

    const data = res.data;
    console.log(`[WhatsApp] Response:`, JSON.stringify(data));

    if (data.status !== 'accepted') {
      const err = new Error(`WhatsApp rejected: ${JSON.stringify(data)}`);
      err.code = 'WA_REJECTED';
      throw err;
    }

    console.log(`[WhatsApp] Accepted, request_id: ${data.request_id}`);
    return { messageId: data.request_id, status: data.status, channel: 'whatsapp', raw: data };
  }
}

module.exports = WhatsAppAdapter;
