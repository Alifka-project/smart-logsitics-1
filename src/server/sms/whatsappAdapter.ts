import axios, { AxiosError } from 'axios';
import { SmsConfig } from './adapter';

const D7_WA_URL = 'https://api.d7networks.com/whatsapp/v2/send';

interface WhatsAppError extends Error {
  code?: string;
  response?: unknown;
}

interface WhatsAppSendOptions {
  to: string;
  body: string;
}

interface WhatsAppSendResult {
  messageId: string;
  status: string;
  channel: string;
  raw: unknown;
}

class WhatsAppAdapter {
  private apiToken: string;
  private originator: string;

  constructor(config: SmsConfig) {
    this.apiToken = (config.D7_API_TOKEN || '').replace(/^["'\s]+|["'\s]+$/g, '');
    // WhatsApp business number registered in D7 (e.g. 15559261029)
    this.originator = (config.D7_WHATSAPP_NUMBER || '').replace(/[^0-9]/g, '');
  }

  async sendMessage({ to, body }: WhatsAppSendOptions): Promise<WhatsAppSendResult> {
    if (!this.apiToken) {
      const err: WhatsAppError = Object.assign(new Error('D7_API_TOKEN not configured'), { code: 'WA_CONFIG_MISSING' });
      throw err;
    }
    if (!this.originator) {
      const err: WhatsAppError = Object.assign(new Error('D7_WHATSAPP_NUMBER not configured'), { code: 'WA_CONFIG_MISSING' });
      throw err;
    }

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
    } catch (axiosErr: unknown) {
      const e = axiosErr as AxiosError;
      const status = e.response?.status;
      const responseBody = e.response?.data;
      const errCode = e.code || 'NO_CODE';
      const errMsg = e.message || 'no message';
      console.error(`[WhatsApp] Request failed — code: ${errCode}, HTTP: ${status}, body:`, JSON.stringify(responseBody));
      const err: WhatsAppError = new Error(`WhatsApp failed [${errCode}]: ${errMsg} | HTTP ${status} | ${JSON.stringify(responseBody)}`);
      err.code = 'WA_HTTP_ERROR';
      err.response = e.response;
      throw err;
    }

    const data = res.data as Record<string, unknown>;
    console.log(`[WhatsApp] Response:`, JSON.stringify(data));

    if (data.status !== 'accepted') {
      const err: WhatsAppError = new Error(`WhatsApp rejected: ${JSON.stringify(data)}`);
      err.code = 'WA_REJECTED';
      throw err;
    }

    console.log(`[WhatsApp] Accepted, request_id: ${data.request_id}`);
    return { messageId: data.request_id as string, status: data.status as string, channel: 'whatsapp', raw: data };
  }
}

export default WhatsAppAdapter;
