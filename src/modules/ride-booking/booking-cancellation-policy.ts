const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const getRiderRefundPercent = (departureAt: Date, now: Date): number => {
    const timeToDepartureMs = departureAt.getTime() - now.getTime();
    return timeToDepartureMs > TWENTY_FOUR_HOURS_MS ? 50 : 0;
};

export const getRiderRefundAmount = (totalPrice: number, percent: number): number => {
    if (percent <= 0) return 0;
    return Number(((totalPrice * percent) / 100).toFixed(2));
};

export const toMinorCurrencyUnits = (amountMajor: number): number => {
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) return 0;
    return Math.round(amountMajor * 100);
};
