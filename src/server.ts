import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { verifyDatabaseConnection, verifyMailer, prisma } from './config/index.js';
import http from 'http';
import app from './app.js';
import logger from './utils/logger.js';
import { initSocket, getIO } from './socket/index.js';
import { startFuelPriceCron } from './jobs/fuel-price.cron.js';
import { startBookingTimeoutCron } from './jobs/booking-timeout.cron.js';
import redis from './cache/redis.js';
import { bullRedis } from './queue/redisConnection.js';
import { deadlineWorker } from './queue/deadline.queue.js';
import { maintenanceWorker } from './queue/maintenance.queue.js';

const PORT = process.env.PORT || 3000;

export let server: http.Server;

const startServer = async () => {
  try {
    await verifyMailer();
    await verifyDatabaseConnection();

    server = http.createServer(app);
    await initSocket(server);

    // Start scheduled jobs
    startFuelPriceCron();
    startBookingTimeoutCron();

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

const shutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown`);

  // Force-kill after 10 seconds if shutdown hangs
  const forceKill = setTimeout(() => {
    logger.error('Graceful shutdown timed out after 10s, forcing exit');
    process.exit(1);
  }, 10_000);
  forceKill.unref();

  try {
    // Stop accepting new HTTP connections
    await new Promise<void>((resolve) => server.close(() => resolve()));
    logger.info('HTTP server closed');

    // Close Socket.IO
    const io = getIO();
    if (io) {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      logger.info('Socket.IO closed');
    }

    // Close BullMQ workers
    await Promise.all([deadlineWorker.close(), maintenanceWorker.close()]);
    logger.info('BullMQ workers closed');

    // Close Redis connections
    await Promise.all([redis.quit(), bullRedis.quit()]);
    logger.info('Redis connections closed');

    // Disconnect Prisma
    await prisma.$disconnect();
    logger.info('Prisma disconnected');

    logger.info('Shutdown complete');
    clearTimeout(forceKill);
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown:', err);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

startServer();
