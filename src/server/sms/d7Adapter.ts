import SmsAdapter, { SmsConfig, SmsSendOptions, SmsSendResult, WebhookResult } from './adapter';
import axios, { AxiosError } from 'axios';
import { normalizePhone, isValidPhone } from '../utils/phoneUtils';
import { Request } from 'express';

// Regular SMS endpoint — used for all numbers
const D7_SMS_URL = 'https://api.d7networks.com/messages/v1/send';

// ── OTP endpoint removed ────────────────────────────────────────────────────
// D7 OTP API always overrides message_text with "Hello User, Your otp code is…"
// regardless of originator or payload — cannot be used for custom content.
// ───────────────────────────────────────────────────────────────────────────

interface D7Error extends Error {
  code?: string;
  response?: unknown;
}

// Variables extracted from a confirmation request message for template sending.
// Order matches D7 template: {{1}}=name, {{2}}=poRef, {{3}}=confirmationLink
function extractTemplateParams(body: string): string[] | null {
  // Match: "Dear <name>," at start
  const nameMatch = body.match(/^Dear (.+?),/);
  // Match: "order <poRef> is"
  const poMatch = body.match(/order (.+?) is ready/);
  // Match a URL on its own line (https://...)
  const urlMatch = body.match(/\n(https?:\/\/\S+)\n/);
  if (nameMatch && poMatch && urlMatch) {
    return [nameMatch[1].trim(), poMatch[1].trim(), urlMatch[1].trim()];
  }
  return null;
}

class D7Adapter extends SmsAdapter {
  private apiToken: string;
  private originator: string;
  private smsTemplateId: string | null;

  constructor(config: SmsConfig) {
    super(config);
    this.apiToken = (config.D7_API_TOKEN || '').replace(/^["'\s]+|["'\s]+$/g, '');
    this.originator = (config.D7_ORIGINATOR || 'Electrolux').trim();
    // Optional: D7 SMS template name/ID for UAE template-based sending
    this.smsTemplateId = (process.env.D7_SMS_TEMPLATE_ID || '').trim() || null;
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

    const normalizedTo = normalizePhone(to);
    if (normalizedTo && normalizedTo !== to) {
      console.log(`[D7] Phone normalized: "${to}" → "${normalizedTo}"`);
    }
    if (!isValidPhone(normalizedTo)) {
      console.warn(`[D7] Phone "${normalizedTo}" does not look like a valid E.164 number — sending anyway`);
    }
    const finalTo = normalizedTo || to;

    // If a D7 SMS template ID is configured, use template-based sending (UAE-approved route).
    // Otherwise fall back to free-text (works for non-UAE numbers).
    if (this.smsTemplateId) {
      const params = extractTemplateParams(body);
      if (params) {
        return this._sendViaTemplate(finalTo, this.smsTemplateId, params);
      }
      console.warn('[D7] Could not extract template params from body — falling back to free-text');
    }

    return this._sendViaSms(finalTo, body);
  }

  // ── Template-based SMS (UAE) ────────────────────────────────────────────────
  // Uses a pre-approved D7 SMS template referenced by ID/name.
  // D7 substitutes {{1}}, {{2}}, {{3}} with the provided params on their side.
  private async _sendViaTemplate(to: string, templateId: string, params: string[]): Promise<SmsSendResult> {
    const payload = {
      messages: [{
        channel: 'sms',
        recipients: [to],
        template: templateId,
        params
      }],
      message_globals: {
        originator: this.originator
      }
    };

    console.log(`[D7] Sending via template "${templateId}" to ${to}, params:`, params);

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
      console.error(`[D7] Template SMS failed — HTTP: ${status}, body:`, JSON.stringify(responseBody));
      console.warn('[D7] Template send failed — retrying as free-text');
      // Fallback: reconstruct free-text body from params (params = [customerName, orderRef, link])
      const fallbackBody = params.length >= 3
        ? `Dear ${params[0]},\n\nYour Electrolux order ${params[1]} is ready for delivery.\n\nPlease confirm your preferred delivery date using the link below:\n${params[2]}\n\nThank you,\nElectrolux Delivery Team.`
        : params.join(' ');
      return this._sendViaSms(to, fallbackBody);
    }

    const data = res.data as Record<string, unknown>;
    console.log(`[D7] Template SMS response:`, JSON.stringify(data));
    if (data.status !== 'accepted') {
      console.warn('[D7] Template route rejected — falling back to free-text');
      // Reconstruct message from params for fallback
      const fallbackBody = `Dear ${params[0]},\n\nYour Electrolux order ${params[1]} is ready for delivery.\n\nPlease confirm your preferred delivery date using the link below:\n${params[2]}\n\nThank you,\nElectrolux Delivery Team.`;
      return this._sendViaSms(to, fallbackBody);
    }

    console.log(`[D7] Template SMS accepted, request_id: ${data.request_id}`);
    return { messageId: data.request_id as string, status: data.status as string, raw: data };
  }

  // ── Free-text SMS (all numbers when no template configured) ────────────────
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
