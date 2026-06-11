/**
 * Request Expiry Utilities
 *
 * Handles rider-selected response deadlines for booking requests.
 * Options: 1h, 3h, 6h, 12h, 24h, or before-departure.
 */

export const EXPIRY_OPTIONS = {
    ONE_HOUR: 'ONE_HOUR',
    THREE_HOURS: 'THREE_HOURS',
    SIX_HOURS: 'SIX_HOURS',
    TWELVE_HOURS: 'TWELVE_HOURS',
    TWENTY_FOUR_HOURS: 'TWENTY_FOUR_HOURS',
    BEFORE_DEPARTURE: 'BEFORE_DEPARTURE',
} as const;

export type ExpiryOption = (typeof EXPIRY_OPTIONS)[keyof typeof EXPIRY_OPTIONS];

const OPTION_TO_HOURS: Record<string, number> = {
    ONE_HOUR: 1,
    THREE_HOURS: 3,
    SIX_HOURS: 6,
    TWELVE_HOURS: 12,
    TWENTY_FOUR_HOURS: 24,
};

/**
 * Calculate the deadline based on the rider's selected option.
 * Always caps at departure time (never expires after the ride departs).
 */
export const calculateDeadline = (
    option: string | undefined,
    departureAt: Date,
    now: Date = new Date()
): { deadlineAt: Date; expiryHours: number } => {
    const hoursUntilDeparture = (departureAt.getTime() - now.getTime()) / (60 * 60 * 1000);

    if (option === EXPIRY_OPTIONS.BEFORE_DEPARTURE || !option) {
        // Default: 1 hour before departure, or half the remaining time if < 2h
        const hoursBeforeDeparture = Math.max(0.5, hoursUntilDeparture - 1);
        const deadlineAt = new Date(now.getTime() + hoursBeforeDeparture * 60 * 60 * 1000);
        return {
            deadlineAt: cap(deadlineAt, departureAt),
            expiryHours: Math.round(hoursBeforeDeparture),
        };
    }

    const hours = OPTION_TO_HOURS[option];
    if (!hours) {
        // Fallback to default behavior
        return calculateDeadline(undefined, departureAt, now);
    }

    const deadlineAt = new Date(now.getTime() + hours * 60 * 60 * 1000);
    return {
        deadlineAt: cap(deadlineAt, departureAt),
        expiryHours: hours,
    };
};

/**
 * Suggest a default expiry option based on time until departure.
 */
export const suggestDefaultOption = (departureAt: Date, now: Date = new Date()): ExpiryOption => {
    const hoursUntilDeparture = (departureAt.getTime() - now.getTime()) / (60 * 60 * 1000);

    if (hoursUntilDeparture <= 2) return EXPIRY_OPTIONS.ONE_HOUR;
    if (hoursUntilDeparture <= 7) return EXPIRY_OPTIONS.THREE_HOURS;
    if (hoursUntilDeparture <= 13) return EXPIRY_OPTIONS.SIX_HOURS;
    if (hoursUntilDeparture <= 25) return EXPIRY_OPTIONS.TWELVE_HOURS;
    return EXPIRY_OPTIONS.TWENTY_FOUR_HOURS;
};

/**
 * Get available options with their labels and whether they're valid (before departure).
 */
export const getAvailableOptions = (departureAt: Date, now: Date = new Date()) => {
    const hoursUntilDeparture = (departureAt.getTime() - now.getTime()) / (60 * 60 * 1000);

    return Object.entries(OPTION_TO_HOURS).map(([key, hours]) => ({
        option: key,
        hours,
        available: hours < hoursUntilDeparture,
        label: formatOptionLabel(key),
    })).concat([{
        option: EXPIRY_OPTIONS.BEFORE_DEPARTURE,
        hours: Math.max(1, Math.round(hoursUntilDeparture - 1)),
        available: hoursUntilDeparture > 1,
        label: 'Before departure',
    }]);
};

const formatOptionLabel = (option: string): string => {
    switch (option) {
        case 'ONE_HOUR': return '1 hour';
        case 'THREE_HOURS': return '3 hours';
        case 'SIX_HOURS': return '6 hours';
        case 'TWELVE_HOURS': return '12 hours';
        case 'TWENTY_FOUR_HOURS': return '24 hours';
        default: return option;
    }
};

const cap = (date: Date, max: Date): Date => {
    return date > max ? max : date;
};
