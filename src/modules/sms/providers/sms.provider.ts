import type { SmsProviderName } from '../sms.config.js';

export type { SmsProviderName };

export interface SmsSendResult {
  /** Provider-side message identifier. */
  id: string;
  status?: string;
}

/**
 * A pluggable SMS backend. Implementations perform the actual send only —
 * mock-mode short-circuiting and abuse gating happen upstream in the
 * service/worker before an implementation is ever invoked.
 */
export interface SmsProvider {
  readonly name: SmsProviderName;
  send(to: string, body: string): Promise<SmsSendResult>;
}
