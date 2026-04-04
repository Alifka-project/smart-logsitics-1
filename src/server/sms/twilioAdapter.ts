/**
 * Twilio SMS Adapter — DISABLED (not currently in use)
 * D7 Networks is the active SMS provider.
 * This file is kept as a reference implementation.
 * To re-enable: update smsService.ts and api/sms.ts to import this adapter.
 */
import SmsAdapter, { SmsConfig, SmsSendOptions, SmsSendResult, WebhookResult } from './adapter';
import axios from 'axios';
import { normalizeUAEPhone, isValidUAEPhone } from '../utils/phoneUtils';
import { Request } from 'express';

interface TwilioError extends Error {
  code?: string;
  missing?: string[];
}

class TwilioAdapter extends SmsAdapter {
  private accountSid: string | undefined;
  private authToken: string | undefined;
  private from: string | undefined;
  private messagingServiceSid: string | undefined;
  private baseUrl: string;

  constructor(config: SmsConfig) {
    super(config);
    this.accountSid = config.TWILIO_ACCOUNT_SID;
    this.authToken = config.TWILIO_AUTH_TOKEN;
    this.from = config.TWILIO_FROM;
    this.messagingServiceSid = config.TWILIO_MESSAGING_SERVICE_SID; // preferred for international routing
    this.baseUrl = 'https://api.twilio.com/2010-04-01';
  }

  async sendSms({ to, from = this.from, body, metadata = {} }: SmsSendOptions): Promise<SmsSendResult> {
    const missing: string[] = [];

    if (!this.accountSid) missing.push('TWILIO_ACCOUNT_SID');
    if (!this.authToken) missing.push('TWILIO_AUTH_TOKEN');
    if (!this.messagingServiceSid && !from) missing.push('TWILIO_FROM or TWILIO_MESSAGING_SERVICE_SID');

    if (missing.length) {
      const error: TwilioError = new Error(
        `Twilio credentials not configured: missing ${missing.join(', ')}`
      );
      error.code = 'TWILIO_CONFIG_MISSING';
      error.missing = missing;
      throw error;
    }

    if (!to) {
      const error: TwilioError = new Error('Twilio "To" phone number is required');
      error.code = 'TWILIO_TO_MISSING';
      throw error;
    }

    // Normalize UAE phone number — converts 05X, 5X, 971X, 00971X → +971XXXXXXXXX
    const normalizedTo = normalizeUAEPhone(to);
    if (normalizedTo && normalizedTo !== to) {
      console.log(`[Twilio] Phone normalized: "${to}" → "${normalizedTo}"`);
    }
    if (!isValidUAEPhone(normalizedTo)) {
      console.warn(`[Twilio] Phone "${normalizedTo}" is not a standard UAE E.164 number — sending anyway`);
    }
    const finalTo = normalizedTo || to;

    if (!body) {
      const error: TwilioError = new Error('Twilio SMS body is required');
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
    } else {
      params.append('From', from as string);
      console.log(`[Twilio] Using direct From: ${from}`);
    }

    const auth = { username: this.accountSid as string, password: this.authToken as string };

    const res = await axios.post(url, params, { auth });
    const data = res.data as Record<string, unknown>;
    return { messageId: data.sid as string, status: data.status as string, raw: data };
  }

  // Twilio webhook parsing: maps Twilio status to our normalized structure
  async parseWebhook(req: Request): Promise<WebhookResult> {
    // Twilio sends form-encoded body for status callbacks
    const body = (req.body || {}) as Record<string, unknown>;
    return {
      provider: 'twilio',
      messageId: body.MessageSid as string | undefined,
      to: body.To as string | undefined,
      status: body.MessageStatus as string | undefined, // queued, sending, sent, delivered, failed
      raw: body
    };
  }
}

export default TwilioAdapter;
