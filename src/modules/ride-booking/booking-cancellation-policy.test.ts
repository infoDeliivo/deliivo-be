import {
    getRiderRefundAmount,
    getRiderRefundPercent,
} from './booking-cancellation-policy.js';

describe('booking cancellation policy', () => {
    it('returns 50% when cancellation is more than 24h before departure', () => {
        const now = new Date('2026-04-01T10:00:00.000Z');
        const departure = new Date('2026-04-02T10:00:01.000Z');

        expect(getRiderRefundPercent(departure, now)).toBe(50);
        expect(getRiderRefundAmount(1000, 50)).toBe(500);
    });

    it('returns 0% when cancellation is within 24h', () => {
        const now = new Date('2026-04-01T10:00:00.000Z');
        const departure = new Date('2026-04-02T10:00:00.000Z');

        expect(getRiderRefundPercent(departure, now)).toBe(0);
        expect(getRiderRefundAmount(1000, 0)).toBe(0);
    });
});
