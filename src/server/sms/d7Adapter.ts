import SmsAdapter, { SmsConfig, SmsSendOptions, SmsSendResult, WebhookResult } from './adapter';
import axios, { AxiosError } from 'axios';
import { normalizePhone, isValidPhone } from '../utils/phoneUtils';
import { Request } from 'express';

// Regular SMS endpoint — works for most countries but UAE carrier blocks all
// unregistered senders (requires TRA registration, takes 3-7 business days)
const D7_SMS_URL = 'https://api.d7networks.com/messages/v1/send';

// OTP endpoint — uses D7's pre-approved short-code routes that bypass UAE
// carrier restrictions. Accepts custom message_text with {{otp}} placeholder.
const D7_OTP_URL = 'https://api.d7networks.com/verify/v1/otp/send-otp';

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
    this.originator = (config.D7_ORIGINATOR || 'SignOTP').trim();
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

    // UAE (+971): must use D7's OTP/transactional route which goes through
    // D7's pre-registered UAE short codes — bypasses TRA sender ID registration.
    // Regular SMS route with an unregistered alphanumeric originator (Electrolux)
    // is blocked by UAE carriers (Etisalat/du) at the network level.
    // Non-UAE: regular SMS route with the configured originator works fine.
    const isUAE = finalTo.startsWith('+971');
    if (isUAE) {
      return this._sendViaOtp(finalTo, body);
    }
    return this._sendViaSms(finalTo, body);
  }

  // ── OTP route (UAE) ────────────────────────────────────────────────────────
  // D7's OTP API uses pre-registered UAE short codes — bypasses TRA carrier blocks.
  // Rules:
  //   1. originator must be D7's OTP originator (env D7_OTP_ORIGINATOR, default "SignOTP")
  //      NOT the branded name — unregistered alphanumeric senders are rejected even here.
  //   2. message_text must contain {{otp}}; D7 replaces it with a 6-digit code.
  //   3. Keep message under 160 chars (1 SMS segment) for best deliverability.
  private async _sendViaOtp(to: string, body: string): Promise<SmsSendResult> {
    // Append {{otp}} placeholder — D7 replaces it with a 6-digit code on delivery.
    // The full message body is sent as-is (multi-segment supported on OTP route).
    const messageWithCode = `${body}\n\nRef: {{otp}}`;

    const payload = {
      originator: this.originator, // Electrolux — as registered in D7 template
      recipient: to,
      expiry: 172800, // 48 hours
      data_coding: 'text',
      otp_length: 6,
      message_text: messageWithCode
    };

    console.log(`[D7] Sending delivery confirmation via OTP route to ${to}`);

    let res;
    try {
      res = await axios.post(D7_OTP_URL, payload, {
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
      console.error(`[D7] OTP request failed — code: ${errCode}, message: ${errMsg}, HTTP: ${status}, body:`, JSON.stringify(responseBody));
      const err: D7Error = new Error(`D7 OTP failed [${errCode}]: ${errMsg} | HTTP ${status} | ${JSON.stringify(responseBody)}`);
      err.code = 'D7_OTP_HTTP_ERROR';
      err.response = e.response;
      throw err;
    }

    const data = res.data as Record<string, unknown>;
    console.log(`[D7] OTP response:`, JSON.stringify(data));
    if (!data.otp_id) {
      const error: D7Error = new Error(`D7 OTP rejected: ${JSON.stringify(data)}`);
      error.code = 'D7_OTP_REJECTED';
      throw error;
    }

    console.log(`[D7] OTP route accepted, otp_id: ${data.otp_id}, status: ${data.status}`);
    return { messageId: data.otp_id as string, status: (data.status as string) || 'sent', raw: data };
  }

  // ── Regular SMS route (non-UAE) ────────────────────────────────────────────
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

    console.log(`[D7] Sending SMS to ${to} via D7 regular SMS, originator: ${this.originator}`);

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
