import { SendSmsPayload } from './sms.types.js';
import { smsQueue } from './sms.queue.js';
import logger from '../../utils/logger.js';
import { bullRedis } from '../../queue/redisConnection.js';
import { getSmsQueueConfig, isValidE164PhoneNumber, loadSmsWorkerConfig, maskPhoneNumber } from './sms.config.js';
import { assertSmsAllowed } from './sms.abuse.js';
import { getSmsProvider } from './providers/index.js';

export interface SendSmsResult {
    success: boolean;
    jobId?: string;
    error?: string;
}

/**
 * Queue SMS for sending via BullMQ worker
 * @param to - Phone number with country code (e.g., +919876543210)
 * @param body - Message content
 */
export const sendSms = async (to: string, body: string): Promise<SendSmsResult> => {
    try {
        const normalizedTo = to.trim();
        const normalizedBody = body.trim();
        const queueConfig = getSmsQueueConfig();

        if (!isValidE164PhoneNumber(normalizedTo)) {
            return { success: false, error: 'Phone number must be in E.164 format (example: +919876543210)' };
        }

        if (!normalizedBody) {
            return { success: false, error: 'SMS body is required' };
        }

        if (normalizedBody.length > queueConfig.maxBodyLength) {
            return {
                success: false,
                error: `SMS body exceeds ${queueConfig.maxBodyLength} characters`,
            };
        }

        // Abuse gate: country allowlist + per-phone daily cap + global spend cap.
        // Runs once per accepted send; covers both the queued and direct-fallback paths.
        const allowed = await assertSmsAllowed(normalizedTo);
        if (!allowed.ok) {
            logger.warn('[SMS] Blocked by abuse gate', {
                to: maskPhoneNumber(normalizedTo),
                reason: allowed.error,
            });
            return { success: false, error: allowed.error };
        }

        const payload: SendSmsPayload = { to: normalizedTo, body: normalizedBody };
        const queueUnavailable = bullRedis.status !== 'ready';

        if (queueUnavailable) {
            return await sendSmsDirect(payload);
        }

        let job;
        try {
            job = await smsQueue.add('send-sms', payload, {
                attempts: queueConfig.retryAttempts,
                backoff: {
                    type: 'exponential',
                    delay: queueConfig.retryBackoffMs,
                },
                removeOnComplete: {
                    count: queueConfig.removeOnCompleteCount,
                },
                removeOnFail: {
                    count: queueConfig.removeOnFailCount,
                },
            });
        } catch (error: any) {
            logger.warn('[SMS] Queue unavailable, falling back to direct send', {
                error: error?.message || String(error),
            });
            return await sendSmsDirect(payload);
        }

        logger.info('[SMS] Queued SMS job', {
            jobId: job.id,
            to: maskPhoneNumber(normalizedTo),
        });
        return { success: true, jobId: job.id };
    } catch (error: any) {
        logger.error('[SMS] Failed to queue SMS job', {
            error: error?.message || String(error),
        });
        return { success: false, error: error?.message || 'Failed to queue SMS' };
    }
};

async function sendSmsDirect(payload: SendSmsPayload): Promise<SendSmsResult> {
    try {
        const smsConfig = loadSmsWorkerConfig();
        const normalizedTo = payload.to.trim();
        const normalizedBody = payload.body.trim();

        if (smsConfig.isMockMode) {
            logger.info('[SMS MOCK] Direct fallback accepted', {
                to: maskPhoneNumber(normalizedTo),
                length: normalizedBody.length,
            });
            return { success: true, jobId: 'mock-direct' };
        }

        const result = await getSmsProvider().send(normalizedTo, normalizedBody);

        logger.info('[SMS] Direct fallback sent', {
            messageSid: result.id,
            to: maskPhoneNumber(normalizedTo),
            status: result.status,
        });
        return { success: true, jobId: result.id };
    } catch (error: any) {
        logger.error('[SMS] Direct fallback failed', {
            error: error?.message || String(error),
        });
        return { success: false, error: error?.message || 'Failed to send SMS' };
    }
}
