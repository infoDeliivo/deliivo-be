import cron from 'node-cron';
import { refreshFuelPrice } from '../services/fuel-price.service.js';
import { logInfo, logError, logDebug } from '../utils/logger.js';

/**
 * Weekly UK fuel price refresh cron job.
 *
 * Runs every Monday at 06:00 UTC — GOV.UK publishes weekly road fuel
 * prices on Mondays, so we refresh shortly after.
 *
 * Schedule: "0 6 * * 1" = minute 0, hour 6, every Monday
 */
export const startFuelPriceCron = () => {
    cron.schedule('0 6 * * 1', async () => {
        logDebug('Refreshing UK fuel price');
        try {
            const result = await refreshFuelPrice('GB');
            logInfo('UK fuel price refreshed', {
                pricePerLiter: result.pricePerLiter,
                effectiveDate: result.effectiveDate || 'unknown',
            });
        } catch (error) {
            logError('UK fuel price refresh failed', error instanceof Error ? error : undefined);
        }
    }, {
        timezone: 'Europe/London',
    });

    logInfo('Fuel price refresh scheduled: every Monday at 06:00 UTC');
};
