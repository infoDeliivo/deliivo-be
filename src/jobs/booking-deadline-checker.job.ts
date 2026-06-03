import cron from 'node-cron';
import { checkExpiredDeadlines } from '../services/booking-deadline-checker.service.js';
import { logInfo, logError } from '../utils/logger.js';

// Run every minute
export const startBookingDeadlineChecker = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const result = await checkExpiredDeadlines();
            if (result.initialExpired > 0 || result.extendedExpired > 0) {
                logInfo('Checked expired deadlines', {
                    initialExpired: result.initialExpired,
                    extendedExpired: result.extendedExpired,
                    timestamp: result.timestamp,
                });
            }
        } catch (error) {
            logError('Error checking expired deadlines', error);
        }
    });

    logInfo('Booking deadline checker started (runs every minute)');
};
