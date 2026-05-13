import cron from 'node-cron';
import { checkExpiredDeadlines } from '../services/booking-deadline-checker.service.js';

// Run every minute
export const startBookingDeadlineChecker = () => {
    cron.schedule('* * * * *', async () => {
        try {
            const result = await checkExpiredDeadlines();
            if (result.initialExpired > 0 || result.extendedExpired > 0) {
                console.log(
                    `[Cron] Deadline Checker: ${result.initialExpired} expired, ${result.extendedExpired} auto-cancelled at ${result.timestamp}`
                );
            }
        } catch (error) {
            console.error('[Cron] Error checking expired deadlines:', error);
        }
    });

    console.log('[Cron] Booking deadline checker started (runs every minute)');
};
