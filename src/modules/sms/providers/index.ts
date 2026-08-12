import { parseSmsProvider } from '../sms.config.js';
import type { SmsProvider } from './sms.provider.js';
import { TwilioSmsProvider } from './twilio.provider.js';
import { MessenteSmsProvider } from './messente.provider.js';
import { SnsSmsProvider } from './sns.provider.js';

export type { SmsProvider, SmsSendResult, SmsProviderName } from './sms.provider.js';

/** Resolve the active SMS provider from `SMS_PROVIDER` (default twilio). */
export const getSmsProvider = (): SmsProvider => {
  const name = parseSmsProvider(process.env.SMS_PROVIDER);
  switch (name) {
    case 'messente':
      return new MessenteSmsProvider();
    case 'sns':
      return new SnsSmsProvider();
    case 'twilio':
    default:
      return new TwilioSmsProvider();
  }
};
