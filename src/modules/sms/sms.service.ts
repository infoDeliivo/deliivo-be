import { SendSmsPayload } from './sms.types.js';
import { smsQueue } from './sms.queue.js';
import logger from '../../utils/logger.js';
import { getSmsQueueConfig, isValidE164PhoneNumber, maskPhoneNumber } from './sms.config.js';

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

        const payload: SendSmsPayload = { to: normalizedTo, body: normalizedBody };

        const job = await smsQueue.add('send-sms', payload, {
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
