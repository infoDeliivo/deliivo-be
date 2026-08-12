const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sns', () => ({
  __esModule: true,
  SNSClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  PublishCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { SnsSmsProvider } from './sns.provider.js';

type PublishInput = {
  PhoneNumber?: string;
  Message?: string;
  MessageAttributes?: Record<string, { DataType: string; StringValue?: string }>;
};

const publishInput = (): PublishInput =>
  (PublishCommand as unknown as jest.Mock).mock.calls[0][0] as PublishInput;

describe('SnsSmsProvider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({ MessageId: 'sns-message-1' });
    process.env.SMS_PROVIDER = 'sns';
    process.env.SMS_MOCK_MODE = 'false';
    process.env.NODE_ENV = 'development';
    process.env.SNS_REGION = 'eu-central-1';
    delete process.env.SNS_SENDER_ID;
    delete process.env.SNS_SMS_TYPE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('publishes to the phone number and returns the SNS MessageId', async () => {
    const result = await new SnsSmsProvider().send('+919876543210', 'Your code is 1234');

    expect(result).toEqual({ id: 'sns-message-1', status: 'sent' });
    expect(publishInput().PhoneNumber).toBe('+919876543210');
    expect(publishInput().Message).toBe('Your code is 1234');
  });

  it('defaults to Transactional SMS type for OTP reliability', async () => {
    await new SnsSmsProvider().send('+919876543210', 'code');

    expect(publishInput().MessageAttributes?.['AWS.SNS.SMS.SMSType']).toEqual({
      DataType: 'String',
      StringValue: 'Transactional',
    });
  });

  it('honours SNS_SMS_TYPE=Promotional', async () => {
    process.env.SNS_SMS_TYPE = 'Promotional';

    await new SnsSmsProvider().send('+919876543210', 'code');

    expect(publishInput().MessageAttributes?.['AWS.SNS.SMS.SMSType']?.StringValue).toBe(
      'Promotional',
    );
  });

  it('omits SenderID when SNS_SENDER_ID is unset', async () => {
    await new SnsSmsProvider().send('+919876543210', 'code');

    expect(publishInput().MessageAttributes?.['AWS.SNS.SMS.SenderID']).toBeUndefined();
  });

  it('sends SenderID when configured', async () => {
    process.env.SNS_SENDER_ID = 'Deliivo';

    await new SnsSmsProvider().send('+919876543210', 'code');

    expect(publishInput().MessageAttributes?.['AWS.SNS.SMS.SenderID']?.StringValue).toBe('Deliivo');
  });

  it('uses the configured region', async () => {
    await new SnsSmsProvider().send('+919876543210', 'code');

    expect(SNSClient as unknown as jest.Mock).toHaveBeenCalledWith({ region: 'eu-central-1' });
  });

  it('throws when the region is missing', async () => {
    delete process.env.SNS_REGION;
    delete process.env.AWS_REGION;

    await expect(new SnsSmsProvider().send('+919876543210', 'code')).rejects.toThrow(/SNS_REGION/);
  });

  it('throws when SNS returns no MessageId', async () => {
    mockSend.mockResolvedValue({});

    await expect(new SnsSmsProvider().send('+919876543210', 'code')).rejects.toThrow(
      /missing MessageId/,
    );
  });
});
