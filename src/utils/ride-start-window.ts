import logger from './logger.js';

/**
 * Early-start window for a ride, in minutes before the scheduled departure.
 *
 * Controlled by `RIDE_START_EARLY_LIMIT_MINUTES`:
 *  - unset / empty  -> no restriction, a driver may start the ride at any time
 *  - `0`            -> the ride may only be started at or after departure time
 *  - `N` (positive) -> the ride may be started from N minutes before departure
 */
export const RIDE_START_EARLY_LIMIT_ENV = 'RIDE_START_EARLY_LIMIT_MINUTES';

export const getRideStartEarlyLimitMinutes = (): number | null => {
    const raw = process.env[RIDE_START_EARLY_LIMIT_ENV]?.trim();
    if (!raw) return null;

    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes < 0) {
        logger.warn('Invalid ride start early-limit env value, early-start restriction disabled', {
            env: RIDE_START_EARLY_LIMIT_ENV,
            value: raw,
        });
        return null;
    }

    return minutes;
};

/** True when the ride may not be started yet under the configured early-start window. */
export const isRideStartTooEarly = (departureAt: Date, now: number = Date.now()): boolean => {
    const limitMinutes = getRideStartEarlyLimitMinutes();
    if (limitMinutes === null) return false;

    return now < departureAt.getTime() - limitMinutes * 60 * 1000;
};

/** Client-facing message for the `RIDE_TOO_EARLY` error, matching the configured window. */
export const rideTooEarlyMessage = (): string => {
    const limitMinutes = getRideStartEarlyLimitMinutes();
    if (limitMinutes === null || limitMinutes === 0) {
        return 'Ride cannot be started before the scheduled departure time';
    }

    return `Ride cannot be started more than ${limitMinutes} minutes before the scheduled departure time`;
};
