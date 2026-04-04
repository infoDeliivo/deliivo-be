import { Worker } from 'bullmq';
import twilio from 'twilio';
import dotenv from 'dotenv';
import { bullRedis } from '../../queue/redisConnection.js';
import { SendSmsPayload } from './sms.types.js';
import logger from '../../utils/logger.js';
import {
  isValidE164PhoneNumber,
  loadSmsWorkerConfig,
  maskPhoneNumber,
} from './sms.config.js';

dotenv.config({ quiet: true });

logger.info('[SMS] Worker booting');
bullRedis
  .ping()
  .then(() => logger.info('[SMS] Redis ping successful'))
  .catch((error) =>
    logger.error('[SMS] Redis ping failed', { error: error instanceof Error ? error.message : String(error) }),
  );

const smsConfig = loadSmsWorkerConfig();

// Initialize Twilio client
const client =
  !smsConfig.isMockMode && smsConfig.accountSid && smsConfig.authToken
    ? twilio(smsConfig.accountSid, smsConfig.authToken)
    : null;

const worker = new Worker(
  'sms-queue',
  async (job) => {
    logger.info('[SMS] Job received', { jobId: job.id });

    const { to, body } = job.data as SendSmsPayload;
    const normalizedTo = to.trim();
    const normalizedBody = body.trim();

    if (!isValidE164PhoneNumber(normalizedTo)) {
      throw new Error(
        `Invalid phone format "${normalizedTo}". Expected E.164 (example: +919876543210)`,
      );
    }

    if (!normalizedBody) {
      throw new Error('SMS body is required');
    }

    if (normalizedBody.length > smsConfig.maxBodyLength) {
      throw new Error(`SMS body exceeds ${smsConfig.maxBodyLength} characters`);
    }

    if (smsConfig.isMockMode) {
      logger.info('[SMS MOCK] Message accepted', {
        to: maskPhoneNumber(normalizedTo),
        length: normalizedBody.length,
      });
      return { success: true, messageId: 'mock-mode' };
    }

    // Check if Twilio is configured
    if (!client) {
      throw new Error('Twilio not configured. Missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN');
    }

    if (!smsConfig.messagingServiceSid && !smsConfig.phoneNumber) {
      throw new Error(
        'Twilio sender not configured. Set TWILIO_PHONE_NUMBER or TWILIO_MESSAGING_SERVICE_SID',
      );
    }

    const payloadBase = {
      body: normalizedBody,
      to: normalizedTo,
      ...(smsConfig.statusCallbackUrl ? { statusCallback: smsConfig.statusCallbackUrl } : {}),
    };

    const message =
      smsConfig.messagingServiceSid
        ? await client.messages.create({
            ...payloadBase,
            messagingServiceSid: smsConfig.messagingServiceSid,
          })
        : await client.messages.create({
            ...payloadBase,
            from: smsConfig.phoneNumber as string,
          });

    logger.info('[SMS] Message sent', {
      jobId: job.id,
      messageSid: message.sid,
      to: maskPhoneNumber(normalizedTo),
      status: message.status,
    });
    return { success: true, messageId: message.sid };
  },
  {
    connection: bullRedis,
    concurrency: smsConfig.workerConcurrency,
  },
);

worker.on('ready', () => {
  logger.info('[SMS] Worker ready');
});

worker.on('failed', (job, err) => {
  const to = (job?.data as Partial<SendSmsPayload> | undefined)?.to;
  logger.error('[SMS] Job failed', {
    jobId: job?.id,
    to: typeof to === 'string' ? maskPhoneNumber(to) : undefined,
    error: err.message,
  });
});

process.stdin.resume();
