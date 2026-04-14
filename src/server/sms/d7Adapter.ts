import SmsAdapter, { SmsConfig, SmsSendOptions, SmsSendResult, WebhookResult } from './adapter';
import axios, { AxiosError } from 'axios';
import { normalizePhone, isValidPhone } from '../utils/phoneUtils';
import { Request } from 'express';

// Regular SMS endpoint — used for all numbers (UAE and international)
const D7_SMS_URL = 'https://api.d7networks.com/messages/v1/send';

// ── OTP endpoint removed ────────────────────────────────────────────────────
// D7's OTP API (/verify/v1/otp/send-otp) always overrides message_text with
// its own "Hello User, Your otp code is XXXXXX" template regardless of the
// originator or message_text field — it cannot be used for custom content.
// ───────────────────────────────────────────────────────────────────────────

interface D7Error extends Error {
  code?: string;
  response?: unknown;
}

class D7Adapter extends SmsAdapter {
  private apiToken: string;
  private originator: string;

  constructor(config: SmsConfig) {
    super(config);
    // Strip any surrounding quotes, newlines, or whitespace that can corrupt the header
    this.apiToken = (config.D7_API_TOKEN || '').replace(/^["'\s]+|["'\s]+$/g, '');
    this.originator = (config.D7_ORIGINATOR || 'Electrolux').trim();
  }

  async sendSms({ to, body, metadata = {} }: SmsSendOptions): Promise<SmsSendResult> {
    if (!this.apiToken) {
      const error: D7Error = new Error('D7 Networks credentials not configured: missing D7_API_TOKEN');
      error.code = 'D7_CONFIG_MISSING';
      throw error;
    }
    if (!to) {
      const error: D7Error = new Error('D7 "To" phone number is required');
      error.code = 'D7_TO_MISSING';
      throw error;
    }
    if (!body) {
      const error: D7Error = new Error('D7 SMS body is required');
      error.code = 'D7_BODY_MISSING';
      throw error;
    }

    // Normalize phone: UAE local formats → +971XXXXXXXXX, international → kept as-is
    const normalizedTo = normalizePhone(to);
    if (normalizedTo && normalizedTo !== to) {
      console.log(`[D7] Phone normalized: "${to}" → "${normalizedTo}"`);
    }
    if (!isValidPhone(normalizedTo)) {
      console.warn(`[D7] Phone "${normalizedTo}" does not look like a valid E.164 number — sending anyway`);
    }
    const finalTo = normalizedTo || to;

    return this._sendViaSms(finalTo, body);
  }

  private async _sendViaSms(to: string, body: string): Promise<SmsSendResult> {
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

    console.log(`[D7] Sending SMS to ${to}, originator: ${this.originator}`);

    let res;
    try {
      res = await axios.post(D7_SMS_URL, payload, {
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
      console.error(`[D7] SMS request failed — code: ${errCode}, message: ${errMsg}, HTTP: ${status}, body:`, JSON.stringify(responseBody));
      const err: D7Error = new Error(`D7 SMS failed [${errCode}]: ${errMsg} | HTTP ${status} | ${JSON.stringify(responseBody)}`);
      err.code = 'D7_HTTP_ERROR';
      err.response = e.response;
      throw err;
    }

    const data = res.data as Record<string, unknown>;
    console.log(`[D7] SMS response:`, JSON.stringify(data));
    if (data.status !== 'accepted') {
      const error: D7Error = new Error(`D7 SMS rejected: ${JSON.stringify(data)}`);
      error.code = 'D7_REJECTED';
      throw error;
    }

    console.log(`[D7] SMS accepted, request_id: ${data.request_id}`);
    return { messageId: data.request_id as string, status: data.status as string, raw: data };
  }

  async parseWebhook(req: Request): Promise<WebhookResult> {
    const body = (req.body || {}) as Record<string, unknown>;
    return {
      provider: 'd7',
      messageId: (body.request_id || body.otp_id) as string | undefined,
      to: (body.to || body.recipient) as string | undefined,
      status: body.status as string | undefined,
      raw: body
    };
  }
}

export default D7Adapter;
