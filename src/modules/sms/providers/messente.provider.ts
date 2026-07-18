import { loadSmsWorkerConfig } from '../sms.config.js';
import type { SmsProvider, SmsSendResult } from './sms.provider.js';

const MESSENTE_OMNIMESSAGE_URL = 'https://api.messente.com/v1/omnimessage/send';

interface MessenteOmnimessageResponse {
  omnimessage?: {
    id?: string;
    messages?: Array<{ message_id?: string; channel?: string }>;
  };
}

/**
 * Messente Omnimessage API (SMS channel). Auth is HTTP Basic with the API
 * username/password from the Messente dashboard. Uses the Node global `fetch`.
 */
export class MessenteSmsProvider implements SmsProvider {
  readonly name = 'messente' as const;

  async send(to: string, body: string): Promise<SmsSendResult> {
    const config = loadSmsWorkerConfig();

    if (!config.messenteUsername || !config.messentePassword) {
      throw new Error(
        'Messente not configured. Missing MESSENTE_API_USERNAME or MESSENTE_API_PASSWORD',
      );
    }
    if (!config.messenteSender) {
      throw new Error('Messente sender not configured. Set MESSENTE_SENDER');
    }

    const auth = Buffer.from(`${config.messenteUsername}:${config.messentePassword}`).toString(
      'base64',
    );

    const response = await fetch(MESSENTE_OMNIMESSAGE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to,
        messages: [{ channel: 'sms', sender: config.messenteSender, text: body }],
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Messente send failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as MessenteOmnimessageResponse;
    const id = data.omnimessage?.id ?? data.omnimessage?.messages?.[0]?.message_id;
    if (!id) {
      throw new Error('Messente response missing omnimessage id');
    }

    return { id, status: 'sent' };
  }
}
