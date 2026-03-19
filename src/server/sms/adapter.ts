// SMS Adapter interface
// Implementations must export: async sendSms({to, from, body, metadata}) and verifyWebhook(req)

import { Request } from 'express';

export interface SmsConfig {
  [key: string]: string | undefined;
}

export interface SmsSendOptions {
  to: string;
  from?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

export interface SmsSendResult {
  messageId: string;
  status: string;
  raw?: unknown;
}

export interface WebhookResult {
  provider: string;
  messageId: string | undefined;
  to: string | undefined;
  status: string | undefined;
  raw: unknown;
}

class SmsAdapter {
  protected config: SmsConfig;

  constructor(config: SmsConfig) {
    this.config = config;
  }

  // Send SMS, return provider response { messageId, status }
  async sendSms(_options: SmsSendOptions): Promise<SmsSendResult> {
    throw new Error('sendSms not implemented');
  }

  // Optionally parse incoming webhook and return normalized status object
  async parseWebhook(_req: Request): Promise<WebhookResult> {
    throw new Error('parseWebhook not implemented');
  }
}

export default SmsAdapter;
