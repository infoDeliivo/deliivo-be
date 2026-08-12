import { loadQueueLimiterConfig, type QueueLimiterConfig } from '../sms/sms.config.js';

const DEFAULT_MAIL_WORKER_CONCURRENCY = 1;

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

export type MailWorkerConfig = {
  concurrency: number;
  limiter: QueueLimiterConfig;
};

export const loadMailWorkerConfig = (): MailWorkerConfig => ({
  concurrency: parseBoundedInteger(
    'MAIL_WORKER_CONCURRENCY',
    DEFAULT_MAIL_WORKER_CONCURRENCY,
    1,
    50,
  ),
  limiter: loadQueueLimiterConfig('MAIL_LIMITER_MAX', 'MAIL_LIMITER_DURATION'),
});
