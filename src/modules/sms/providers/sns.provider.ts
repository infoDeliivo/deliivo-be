import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { loadSmsWorkerConfig } from '../sms.config.js';
import type { SmsProvider, SmsSendResult } from './sms.provider.js';

/**
 * Amazon SNS direct-publish SMS. Credentials resolve through the AWS SDK
 * default chain (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY), same as SES.
 *
 * `SNS_SMS_TYPE=Transactional` buys the higher-reliability delivery path and is
 * the right default for OTP codes; `Promotional` is cheaper but deprioritised.
 * `SNS_SENDER_ID` is honoured only in countries that support alphanumeric
 * sender IDs — elsewhere SNS silently substitutes a long/short code.
 */
export class SnsSmsProvider implements SmsProvider {
  readonly name = 'sns' as const;

  async send(to: string, body: string): Promise<SmsSendResult> {
    const config = loadSmsWorkerConfig();

    if (!config.snsRegion) {
      throw new Error('SNS not configured. Set SNS_REGION (or AWS_REGION)');
    }

    const client = new SNSClient({ region: config.snsRegion });

    const response = await client.send(
      new PublishCommand({
        PhoneNumber: to,
        Message: body,
        MessageAttributes: {
          'AWS.SNS.SMS.SMSType': {
            DataType: 'String',
            StringValue: config.snsSmsType,
          },
          ...(config.snsSenderId
            ? {
                'AWS.SNS.SMS.SenderID': {
                  DataType: 'String',
                  StringValue: config.snsSenderId,
                },
              }
            : {}),
        },
      }),
    );

    if (!response.MessageId) {
      throw new Error('SNS publish response missing MessageId');
    }

    return { id: response.MessageId, status: 'sent' };
  }
}
