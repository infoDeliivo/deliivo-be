import { Queue, Worker } from 'bullmq';
import logger from '../utils/logger.js';
import { bullRedis } from '../queue/redisConnection.js';
import { sendPushToUser } from '../services/push.service.js';

export const pushQueue = new Queue('push-notifications', {
    connection: bullRedis,
    defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
    },
});

export const pushWorker = new Worker(
    'push-notifications',
    async (job: any) => {
        const { userId, payload } = job.data;
        await sendPushToUser(userId, payload);
    },
    { connection: bullRedis, concurrency: 10 }
);

pushWorker.on('failed', (job: any, err: any) => {
    logger.error(`Push job ${job?.id} failed: ${err.message}`);
});
