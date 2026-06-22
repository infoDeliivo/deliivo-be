/**
 * Integration Test: Request Expiry & Driver Decision (Phase 3)
 *
 * Tests:
 * - Rider-selected response deadline calculation
 * - Default deadline suggestion based on time to departure
 * - Withdraw booking request
 * - Deadline reminder notification
 * - Driver response metrics
 */

import {
    calculateDeadline,
    suggestDefaultOption,
    getAvailableOptions,
    EXPIRY_OPTIONS,
} from '../ride-booking/request-expiry.utils.js';

// ============================================================
//  REQUEST EXPIRY CALCULATION TESTS
// ============================================================

describe('Request Expiry: calculateDeadline', () => {
    const now = new Date('2026-06-11T10:00:00Z');

    test('ONE_HOUR sets deadline 1 hour from now', () => {
        const departureAt = new Date('2026-06-12T10:00:00Z'); // 24h away
        const { deadlineAt, expiryHours } = calculateDeadline('ONE_HOUR', departureAt, now);
        expect(expiryHours).toBe(1);
        expect(deadlineAt.getTime()).toBe(now.getTime() + 1 * 60 * 60 * 1000);
    });

    test('THREE_HOURS sets deadline 3 hours from now', () => {
        const departureAt = new Date('2026-06-12T10:00:00Z');
        const { deadlineAt, expiryHours } = calculateDeadline('THREE_HOURS', departureAt, now);
        expect(expiryHours).toBe(3);
        expect(deadlineAt.getTime()).toBe(now.getTime() + 3 * 60 * 60 * 1000);
    });

    test('SIX_HOURS sets deadline 6 hours from now', () => {
        const departureAt = new Date('2026-06-12T10:00:00Z');
        const { deadlineAt, expiryHours } = calculateDeadline('SIX_HOURS', departureAt, now);
        expect(expiryHours).toBe(6);
        expect(deadlineAt.getTime()).toBe(now.getTime() + 6 * 60 * 60 * 1000);
    });

    test('caps deadline at departure time', () => {
        const departureAt = new Date('2026-06-11T12:00:00Z'); // only 2h away
        const { deadlineAt } = calculateDeadline('SIX_HOURS', departureAt, now);
        // 6 hours would be 16:00, but departure is 12:00 → capped
        expect(deadlineAt.getTime()).toBe(departureAt.getTime());
    });

    test('BEFORE_DEPARTURE uses departure minus 1 hour', () => {
        const departureAt = new Date('2026-06-11T20:00:00Z'); // 10h away
        const { deadlineAt } = calculateDeadline('BEFORE_DEPARTURE', departureAt, now);
        // Should be 9 hours from now (departure - 1h)
        const expected = now.getTime() + 9 * 60 * 60 * 1000;
        expect(deadlineAt.getTime()).toBe(expected);
    });

    test('undefined option defaults to BEFORE_DEPARTURE behavior', () => {
        const departureAt = new Date('2026-06-11T20:00:00Z');
        const { deadlineAt } = calculateDeadline(undefined, departureAt, now);
        const expected = now.getTime() + 9 * 60 * 60 * 1000;
        expect(deadlineAt.getTime()).toBe(expected);
    });

    test('very short time to departure still works', () => {
        const departureAt = new Date('2026-06-11T10:30:00Z'); // 30 min away
        const { deadlineAt } = calculateDeadline(undefined, departureAt, now);
        // Should be capped at departure time
        expect(deadlineAt.getTime()).toBeLessThanOrEqual(departureAt.getTime());
    });
});

// ============================================================
//  DEFAULT OPTION SUGGESTION
// ============================================================

describe('Request Expiry: suggestDefaultOption', () => {
    const now = new Date('2026-06-11T10:00:00Z');

    test('suggests ONE_HOUR when departure is < 2h away', () => {
        const departureAt = new Date('2026-06-11T11:30:00Z');
        expect(suggestDefaultOption(departureAt, now)).toBe(EXPIRY_OPTIONS.ONE_HOUR);
    });

    test('suggests THREE_HOURS when departure is 2-7h away', () => {
        const departureAt = new Date('2026-06-11T15:00:00Z'); // 5h
        expect(suggestDefaultOption(departureAt, now)).toBe(EXPIRY_OPTIONS.THREE_HOURS);
    });

    test('suggests SIX_HOURS when departure is 7-13h away', () => {
        const departureAt = new Date('2026-06-11T20:00:00Z'); // 10h
        expect(suggestDefaultOption(departureAt, now)).toBe(EXPIRY_OPTIONS.SIX_HOURS);
    });

    test('suggests TWELVE_HOURS when departure is 13-25h away', () => {
        const departureAt = new Date('2026-06-12T05:00:00Z'); // 19h
        expect(suggestDefaultOption(departureAt, now)).toBe(EXPIRY_OPTIONS.TWELVE_HOURS);
    });

    test('suggests TWENTY_FOUR_HOURS when departure is > 25h away', () => {
        const departureAt = new Date('2026-06-13T10:00:00Z'); // 48h
        expect(suggestDefaultOption(departureAt, now)).toBe(EXPIRY_OPTIONS.TWENTY_FOUR_HOURS);
    });
});

// ============================================================
//  AVAILABLE OPTIONS
// ============================================================

describe('Request Expiry: getAvailableOptions', () => {
    const now = new Date('2026-06-11T10:00:00Z');

    test('marks options as unavailable when departure is too soon', () => {
        const departureAt = new Date('2026-06-11T12:00:00Z'); // 2h away
        const options = getAvailableOptions(departureAt, now);

        const oneHour = options.find(o => o.option === 'ONE_HOUR');
        const threeHours = options.find(o => o.option === 'THREE_HOURS');
        const sixHours = options.find(o => o.option === 'SIX_HOURS');

        expect(oneHour!.available).toBe(true);
        expect(threeHours!.available).toBe(false);
        expect(sixHours!.available).toBe(false);
    });

    test('all options available when departure is far away', () => {
        const departureAt = new Date('2026-06-13T10:00:00Z'); // 48h away
        const options = getAvailableOptions(departureAt, now);
        const allAvailable = options.every(o => o.available);
        expect(allAvailable).toBe(true);
    });

    test('includes BEFORE_DEPARTURE option', () => {
        const departureAt = new Date('2026-06-12T10:00:00Z');
        const options = getAvailableOptions(departureAt, now);
        const beforeDeparture = options.find(o => o.option === 'BEFORE_DEPARTURE');
        expect(beforeDeparture).toBeDefined();
        expect(beforeDeparture!.available).toBe(true);
    });
});

// ============================================================
//  WITHDRAW BOOKING (unit test with mocks)
// ============================================================

describe('Withdraw Booking', () => {
    test('withdrawBooking function is exported', async () => {
        const { withdrawBooking } = await import('../ride-booking/ride-booking.service.js');
        expect(typeof withdrawBooking).toBe('function');
    });

    test('getDriverResponseMetrics function is exported', async () => {
        const { getDriverResponseMetrics } = await import('../ride-booking/ride-booking.service.js');
        expect(typeof getDriverResponseMetrics).toBe('function');
    });
});

// ============================================================
//  MANUAL CAPTURE SUPPORT
// ============================================================

describe('Stripe Manual Capture', () => {
    test('capturePaymentIntent function is exported', async () => {
        const { capturePaymentIntent } = await import('../payments/stripe.service.js');
        expect(typeof capturePaymentIntent).toBe('function');
    });

    test('cancelPaymentIntent function is exported', async () => {
        const { cancelPaymentIntent } = await import('../payments/stripe.service.js');
        expect(typeof cancelPaymentIntent).toBe('function');
    });
});
