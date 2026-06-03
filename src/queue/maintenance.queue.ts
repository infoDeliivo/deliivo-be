// @ts-ignore — bullmq types not resolved by moduleResolution:"Node"; runtime works fine
import { Queue, Worker } from 'bullmq';
import { logInfo } from '../utils/logger.js';
import { bullRedis } from './redisConnection.js';
import { prisma } from '../config/index.js';

const QUEUE_NAME = 'maintenance';

const maintenanceQueue = new Queue(QUEUE_NAME, { connection: bullRedis });

// Schedule the nightly job once — BullMQ deduplicates by jobId
maintenanceQueue.add(
    'nightly-cleanup',
    {},
    {
        repeat: { pattern: '0 2 * * *' }, // 02:00 UTC daily
        jobId: 'nightly-cleanup',
        removeOnComplete: true,
        removeOnFail: 100,
    }
);

new Worker(
    QUEUE_NAME,
    async () => {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

        // D3: Delete read notifications older than 30 days
        const deletedRead = await prisma.notification.deleteMany({
            where: {
                isRead: true,
                createdAt: { lt: thirtyDaysAgo },
            },
        });

        // D3: Delete all notifications older than 90 days
        const deletedOld = await prisma.notification.deleteMany({
            where: {
                createdAt: { lt: ninetyDaysAgo },
            },
        });

        // D5: Nullify StripeWebhookEvent payload after 30 days (keep id + eventType for idempotency)
        const nullifiedWebhooks = await prisma.stripeWebhookEvent.updateMany({
            where: {
                processedAt: { lt: thirtyDaysAgo },
                payload: { not: null as any },
            },
            data: { payload: null as any },
        });

        logInfo('Maintenance nightly cleanup complete', {
            notificationsDeletedRead30d: deletedRead.count,
            notificationsDeletedAll90d: deletedOld.count,
            webhookPayloadsNullified: nullifiedWebhooks.count,
        });
    },
    { connection: bullRedis, concurrency: 1 }
);
