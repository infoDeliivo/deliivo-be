import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { bullRedis } from '../../queue/redisConnection.js';
import { SendSmsPayload } from './sms.types.js';
import logger from '../../utils/logger.js';
import {
  isValidE164PhoneNumber,
  loadQueueLimiterConfig,
  loadSmsWorkerConfig,
  maskPhoneNumber,
} from './sms.config.js';
import { getSmsProvider } from './providers/index.js';

dotenv.config({ quiet: true });

logger.info('[SMS] Worker booting');
bullRedis
  .ping()
  .then(() => logger.info('[SMS] Redis ping successful'))
  .catch((error) =>
    logger.error('[SMS] Redis ping failed', { error: error instanceof Error ? error.message : String(error) }),
  );

const smsConfig = loadSmsWorkerConfig();
const smsProvider = smsConfig.isMockMode ? null : getSmsProvider();
const smsLimiter = loadQueueLimiterConfig('SMS_LIMITER_MAX', 'SMS_LIMITER_DURATION');

const worker = new Worker(
  'sms-queue',
  async (job: any) => {
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

    if (!smsProvider) {
      throw new Error('SMS provider not initialized');
    }

    const result = await smsProvider.send(normalizedTo, normalizedBody);

    logger.info('[SMS] Message sent', {
      jobId: job.id,
      provider: smsProvider.name,
      messageSid: result.id,
      to: maskPhoneNumber(normalizedTo),
      status: result.status,
    });
    return { success: true, messageId: result.id };
  },
  {
    connection: bullRedis,
    concurrency: smsConfig.workerConcurrency,
    ...(smsLimiter ? { limiter: smsLimiter } : {}),
  },
);

worker.on('ready', () => {
  logger.info('[SMS] Worker ready');
});

worker.on('failed', (job: any, err: any) => {
  const to = (job?.data as Partial<SendSmsPayload> | undefined)?.to;
  logger.error('[SMS] Job failed', {
    jobId: job?.id,
    to: typeof to === 'string' ? maskPhoneNumber(to) : undefined,
    error: err.message,
  });
});

process.stdin.resume();
