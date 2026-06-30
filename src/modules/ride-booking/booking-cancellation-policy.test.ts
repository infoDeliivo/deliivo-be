import {
    getRiderRefundAmount,
    getRiderRefundPercent,
    isConfirmedCancellationWindowClosed,
} from './booking-cancellation-policy.js';

describe('booking cancellation policy', () => {
    it('returns 50% when cancellation is more than 3h before departure', () => {
        const now = new Date('2026-04-01T10:00:00.000Z');
        const departure = new Date('2026-04-01T13:00:01.000Z');

        expect(getRiderRefundPercent(departure, now)).toBe(50);
        expect(getRiderRefundAmount(1000, 50)).toBe(500);
    });

    it('returns 0% when cancellation is within 3h', () => {
        const now = new Date('2026-04-01T10:00:00.000Z');
        const departure = new Date('2026-04-01T13:00:00.000Z');

        expect(getRiderRefundPercent(departure, now)).toBe(0);
        expect(getRiderRefundAmount(1000, 0)).toBe(0);
    });

    it('closes confirmed-booking cancellation at exactly 3h', () => {
        const now = new Date('2026-04-01T10:00:00.000Z');
        expect(isConfirmedCancellationWindowClosed(new Date('2026-04-01T13:00:00.000Z'), now)).toBe(true);
        expect(isConfirmedCancellationWindowClosed(new Date('2026-04-01T13:00:01.000Z'), now)).toBe(false);
    });
});
