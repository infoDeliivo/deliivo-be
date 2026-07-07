export const SAME_DAY_MINIMUM_BOOKING_LEAD_MS = 3 * 60 * 60 * 1000;

const isSameUtcDay = (left: Date, right: Date): boolean =>
    left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();

export const isBookingWindowClosed = (departureAt: Date, now: Date): boolean => {
    if (departureAt.getTime() <= now.getTime()) return true;
    return isSameUtcDay(departureAt, now)
        && departureAt.getTime() - now.getTime() < SAME_DAY_MINIMUM_BOOKING_LEAD_MS;
};
