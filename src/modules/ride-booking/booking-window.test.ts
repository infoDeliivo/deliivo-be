import { isBookingWindowClosed } from './booking-window.js';

describe('same-day booking window', () => {
    const now = new Date('2026-07-06T10:00:00.000Z');

    it('closes booking when a same-day ride is less than one hour away', () => {
        expect(isBookingWindowClosed(new Date('2026-07-06T10:59:59.999Z'), now)).toBe(true);
    });

    it('allows booking when a same-day ride is at least one hour away', () => {
        expect(isBookingWindowClosed(new Date('2026-07-06T11:00:00.000Z'), now)).toBe(false);
    });

    it('closes booking after departure', () => {
        expect(isBookingWindowClosed(new Date('2026-07-06T09:00:00.000Z'), now)).toBe(true);
    });
});
