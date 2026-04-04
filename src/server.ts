import dotenv from 'dotenv';
dotenv.config({ quiet: true });
import { verifyDatabaseConnection, verifyMailer } from './config/index.js';
import http from 'http';
import app from './app.js';
import logger from './utils/logger.js';
import { initSocket } from './socket/index.js';
import { startFuelPriceCron } from './jobs/fuel-price.cron.js';
import { startBookingTimeoutCron } from './jobs/booking-timeout.cron.js';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await verifyMailer();
    await verifyDatabaseConnection();

    const server = http.createServer(app);
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

startServer();
