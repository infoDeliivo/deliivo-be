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

const DEFAULT_SMS_PER_PHONE_DAILY_MAX = 5;

const parseBoolean = (value?: string): boolean => value?.trim().toLowerCase() === 'true';

/**
 * Parse an optional bounded integer. Blank/unset returns null (feature disabled)
 * rather than a fallback, used for caps that are off until an operator sets them.
 */
const parseOptionalBoundedInteger = (
  envName: string,
  min: number,
  max: number,
): number | null => {
  const raw = process.env[envName];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${envName} must be an integer between ${min} and ${max}`);
  }

  return parsed;
};

/** Parse a comma-separated list of E.164 calling codes (digits only, no '+'). */
const parseCallingCodes = (value?: string): string[] => {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code.length > 0)
    .map((code) => {
      const normalized = code.replace(/^\+/, '');
      if (!/^\d{1,4}$/.test(normalized)) {
        throw new Error(
          `SMS_ALLOWED_COUNTRY_CODES entry "${code}" must be 1-4 digits (E.164 calling code)`,
        );
      }
      return normalized;
    });
};

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

export type SmsProviderName = 'twilio' | 'messente' | 'sns';

export type SnsSmsType = 'Transactional' | 'Promotional';

/** Alphanumeric sender ID: 1-11 chars, must start with a letter. */
const SNS_SENDER_ID_REGEX = /^[A-Za-z][A-Za-z0-9]{0,10}$/;

export type SmsWorkerConfig = SmsQueueConfig & {
  isProduction: boolean;
  isMockMode: boolean;
  provider: SmsProviderName;
  accountSid?: string;
  authToken?: string;
  phoneNumber?: string;
  messagingServiceSid?: string;
  statusCallbackUrl?: string;
  messenteUsername?: string;
  messentePassword?: string;
  messenteSender?: string;
  snsRegion?: string;
  snsSenderId?: string;
  snsSmsType: SnsSmsType;
};

export const parseSmsProvider = (value?: string): SmsProviderName => {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === '' || normalized === 'twilio') {
    return 'twilio';
  }
  if (normalized === 'messente') {
    return 'messente';
  }
  if (normalized === 'sns') {
    return 'sns';
  }
  throw new Error('SMS_PROVIDER must be one of: twilio, messente, sns');
};

export const parseSnsSmsType = (value?: string): SnsSmsType => {
  const normalized = value?.trim().toLowerCase();
  // OTP codes are transactional; that is the safe default when unset.
  if (normalized === undefined || normalized === '' || normalized === 'transactional') {
    return 'Transactional';
  }
  if (normalized === 'promotional') {
    return 'Promotional';
  }
  throw new Error('SNS_SMS_TYPE must be one of: Transactional, Promotional');
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
  const provider = parseSmsProvider(process.env.SMS_PROVIDER);

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const phoneNumber = process.env.TWILIO_PHONE_NUMBER;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const statusCallbackUrl = process.env.TWILIO_STATUS_CALLBACK_URL;
  const messenteUsername = process.env.MESSENTE_API_USERNAME;
  const messentePassword = process.env.MESSENTE_API_PASSWORD;
  const messenteSender = process.env.MESSENTE_SENDER;
  const snsRegion = process.env.SNS_REGION || process.env.AWS_REGION;
  const snsSenderId = process.env.SNS_SENDER_ID;
  const snsSmsType = parseSnsSmsType(process.env.SNS_SMS_TYPE);

  if (isProduction && isMockMode) {
    throw new Error('SMS_MOCK_MODE=true is not allowed in production');
  }

  // Only the active provider's credentials are required.
  if (!isMockMode && provider === 'twilio') {
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

  if (!isMockMode && provider === 'messente') {
    if (!messenteUsername || !messentePassword) {
      throw new Error(
        'Messente not configured. Missing MESSENTE_API_USERNAME or MESSENTE_API_PASSWORD',
      );
    }
    if (!messenteSender) {
      throw new Error('Messente sender not configured. Set MESSENTE_SENDER');
    }
  }

  if (!isMockMode && provider === 'sns') {
    if (!snsRegion) {
      throw new Error('SNS not configured. Set SNS_REGION (or AWS_REGION)');
    }

    // Credentials come from the AWS SDK default chain, so they are not required
    // here — an instance role or profile is a valid setup.
    if (snsSenderId && !SNS_SENDER_ID_REGEX.test(snsSenderId)) {
      throw new Error(
        'SNS_SENDER_ID must be 1-11 alphanumeric characters starting with a letter',
      );
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
    provider,
    accountSid,
    authToken,
    phoneNumber,
    messagingServiceSid,
    statusCallbackUrl,
    messenteUsername,
    messentePassword,
    messenteSender,
    snsRegion,
    snsSenderId,
    snsSmsType,
  };
};

export type SmsAbuseConfig = {
  /** Allowed E.164 calling codes (digits only). Empty = allow all countries. */
  allowedCountryCodes: string[];
  /** Max OTP SMS per phone number per rolling day. */
  perPhoneDailyMax: number;
  /** Hard daily send ceiling. null = disabled. */
  dailySpendCap: number | null;
  /** Hard monthly send ceiling. null = disabled. */
  monthlySpendCap: number | null;
  /** Address alerted when a spend cap is breached. */
  adminAlertEmail?: string;
};

export const loadSmsAbuseConfig = (): SmsAbuseConfig => ({
  allowedCountryCodes: parseCallingCodes(process.env.SMS_ALLOWED_COUNTRY_CODES),
  perPhoneDailyMax: parseBoundedInteger(
    'SMS_PER_PHONE_DAILY_MAX',
    DEFAULT_SMS_PER_PHONE_DAILY_MAX,
    1,
    1000,
  ),
  dailySpendCap: parseOptionalBoundedInteger('SMS_DAILY_SPEND_CAP', 1, 10_000_000),
  monthlySpendCap: parseOptionalBoundedInteger('SMS_MONTHLY_SPEND_CAP', 1, 100_000_000),
  adminAlertEmail: process.env.ADMIN_ALERT_EMAIL?.trim() || undefined,
});

export type QueueLimiterConfig = { max: number; duration: number } | undefined;

/** Read a BullMQ `limiter` config from a max/duration env pair. Both required or returns undefined. */
export const loadQueueLimiterConfig = (
  maxEnv: string,
  durationEnv: string,
): QueueLimiterConfig => {
  const max = parseOptionalBoundedInteger(maxEnv, 1, 100000);
  const duration = parseOptionalBoundedInteger(durationEnv, 1, 3_600_000);
  if (max === null || duration === null) {
    return undefined;
  }
  return { max, duration };
};

export const isValidE164PhoneNumber = (value: string): boolean => E164_PHONE_REGEX.test(value);

export const maskPhoneNumber = (value: string): string => {
  if (value.length <= 6) {
    return `${value.slice(0, 2)}***`;
  }

  return `${value.slice(0, 3)}***${value.slice(-2)}`;
};
