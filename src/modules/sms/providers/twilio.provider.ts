import twilio from 'twilio';
import { loadSmsWorkerConfig } from '../sms.config.js';
import type { SmsProvider, SmsSendResult } from './sms.provider.js';

export class TwilioSmsProvider implements SmsProvider {
  readonly name = 'twilio' as const;

  async send(to: string, body: string): Promise<SmsSendResult> {
    const config = loadSmsWorkerConfig();

    if (!config.accountSid || !config.authToken) {
      throw new Error('Twilio not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }
    if (!config.messagingServiceSid && !config.phoneNumber) {
      throw new Error(
        'Twilio sender not configured. Set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID',
      );
    }

    const client = twilio(config.accountSid, config.authToken);
    const base = {
      body,
      to,
      ...(config.statusCallbackUrl ? { statusCallback: config.statusCallbackUrl } : {}),
    };

    const message = config.messagingServiceSid
      ? await client.messages.create({ ...base, messagingServiceSid: config.messagingServiceSid })
      : await client.messages.create({ ...base, from: config.phoneNumber as string });

    return { id: message.sid, status: message.status };
  }
}
