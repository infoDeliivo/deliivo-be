const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;
const TWILIO_ACCOUNT_SID_REGEX = /^AC[a-zA-Z0-9]{32}$/;
const TWILIO_MESSAGING_SERVICE_SID_REGEX = /^MG[a-zA-Z0-9]{32}$/;

const DEFAULT_SMS_MAX_BODY_LENGTH = 1200;
const TWILIO_MAX_BODY_LENGTH = 1600;
const DEFAULT_SMS_RETRY_ATTEMPTS = 3;
const DEFAULT_SMS_RETRY_BACKOFF_MS = 2000;
const DEFAULT_SMS_QUEUE_REMOVE_ON_COMPLETE_COUNT = 1000;
const DEFAULT_SMS_QUEUE_REMOVE_ON_FAIL_COUNT = 5000;
const DEFAULT_SMS_WORKER_CONCURRENCY = 5;

const parseBoolean = (value?: string): boolean => value?.trim().toLowerCase() === 'true';

const parseBoundedInteger = (
  envName: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const raw = process.env[envName];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${envName} must be an integer between ${min} and ${max}`);
  }

  return parsed;
};

const isValidHttpUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

export type SmsQueueConfig = {
  maxBodyLength: number;
  retryAttempts: number;
  retryBackoffMs: number;
  removeOnCompleteCount: number;
  removeOnFailCount: number;
  workerConcurrency: number;
};

export type SmsWorkerConfig = SmsQueueConfig & {
  isProduction: boolean;
  isMockMode: boolean;
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
  messagingServiceSid?: string;
  statusCallbackUrl?: string;
};

export const getSmsQueueConfig = (): SmsQueueConfig => ({
  maxBodyLength: parseBoundedInteger(
    'SMS_MAX_BODY_LENGTH',
    DEFAULT_SMS_MAX_BODY_LENGTH,
    1,
    TWILIO_MAX_BODY_LENGTH,
  ),
  retryAttempts: parseBoundedInteger('SMS_RETRY_ATTEMPTS', DEFAULT_SMS_RETRY_ATTEMPTS, 1, 10),
  retryBackoffMs: parseBoundedInteger(
    'SMS_RETRY_BACKOFF_MS',
    DEFAULT_SMS_RETRY_BACKOFF_MS,
    500,
    120000,
  ),
  removeOnCompleteCount: parseBoundedInteger(
    'SMS_QUEUE_REMOVE_ON_COMPLETE_COUNT',
    DEFAULT_SMS_QUEUE_REMOVE_ON_COMPLETE_COUNT,
    1,
    100000,
  ),
  removeOnFailCount: parseBoundedInteger(
    'SMS_QUEUE_REMOVE_ON_FAIL_COUNT',
    DEFAULT_SMS_QUEUE_REMOVE_ON_FAIL_COUNT,
    1,
    100000,
  ),
  workerConcurrency: parseBoundedInteger(
    'SMS_WORKER_CONCURRENCY',
    DEFAULT_SMS_WORKER_CONCURRENCY,
    1,
    50,
  ),
});

export const loadSmsWorkerConfig = (): SmsWorkerConfig => {
  const queueConfig = getSmsQueueConfig();
  const isProduction = process.env.NODE_ENV === 'production';
  const isMockMode = parseBoolean(process.env.SMS_MOCK_MODE) || process.env.NODE_ENV === 'test';

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL;

  if (isProduction && isMockMode) {
    throw new Error('SMS_MOCK_MODE=true is not allowed in production');
  }

  if (!isMockMode) {
    if (!accountSid || !authToken) {
      throw new Error('Twilio not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }

    if (!TWILIO_ACCOUNT_SID_REGEX.test(accountSid)) {
      throw new Error('TWILIO_ACCOUNT_SID must be a valid AC-prefixed SID');
    }

    if (!messagingServiceSid && !phoneNumber) {
      throw new Error(
        'Twilio sender not configured. Set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID',
      );
    }

    if (phoneNumber && !E164_PHONE_REGEX.test(phoneNumber)) {
      throw new Error('TWILIO_PHONE_NUMBER must be in E.164 format (example: +919876543210)');
    }

    if (messagingServiceSid && !TWILIO_MESSAGING_SERVICE_SID_REGEX.test(messagingServiceSid)) {
      throw new Error('TWILIO_MESSAGING_SERVICE_SID must be a valid MG-prefixed SID');
    }
  }

  if (statusCallbackUrl) {
    if (!isValidHttpUrl(statusCallbackUrl)) {
      throw new Error('TWILIO_STATUS_CALLBACK_URL must be a valid http/https URL');
    }

    if (isProduction && !statusCallbackUrl.startsWith('https://')) {
      throw new Error('TWILIO_STATUS_CALLBACK_URL must use https in production');
    }
  }

  return {
    ...queueConfig,
    isProduction,
    isMockMode,
    accountSid,
    authToken,
    phoneNumber,
    messagingServiceSid,
    statusCallbackUrl,
  };
};

export const isValidE164PhoneNumber = (value: string): boolean => E164_PHONE_REGEX.test(value);

export const maskPhoneNumber = (value: string): string => {
  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }

  return `${value.slice(0, 3)}***${value.slice(-2)}`;
};
