const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

export const isConfirmedCancellationWindowClosed = (departureAt: Date, now: Date): boolean =>
    departureAt.getTime() - now.getTime() <= THREE_HOURS_MS;

export const getRiderRefundPercent = (departureAt: Date, now: Date): number => {
    const timeToDepartureMs = departureAt.getTime() - now.getTime();
    return timeToDepartureMs > THREE_HOURS_MS ? 50 : 0;
};

export const getRiderRefundAmount = (totalPrice: number, percent: number): number => {
    if (percent <= 0) return 0;
    return Number(((totalPrice * percent) / 100).toFixed(2));
};

export const toMinorCurrencyUnits = (amountMajor: number): number => {
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) return 0;
    return Math.round(amountMajor * 100);
};
