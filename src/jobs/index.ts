import { Queue, Worker } from 'bullmq';
import logger from '../utils/logger.js';
import { bullRedis } from '../queue/redisConnection.js';

export const notificationQueue = new Queue('notifications', { connection: bullRedis });

const worker = new Worker(
    'notifications',
    async (job: any) => {
        logger.info(`Processing job ${job.id}: ${job.name}`);
        // Simulate sending notification
        await new Promise((resolve) => setTimeout(resolve, 1000));
        logger.info(`Job ${job.id} completed`);
    },
    { connection: bullRedis }
);

worker.on('completed', (job: any) => {
    logger.info(`Job ${job.id} has completed!`);
});

worker.on('failed', (job: any, err: any) => {
    logger.error(`Job ${job?.id} has failed with ${err.message}`);
});
