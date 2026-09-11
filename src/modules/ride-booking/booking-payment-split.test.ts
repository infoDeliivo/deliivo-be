import { resolvePaymentSplit, resolveRefundSplit } from './booking-payment-split.js';
import { calculateBookingPrice } from './booking-price.js';
import type { PriceBreakdown } from './ride-booking.types.js';

const breakdown = (overrides: Partial<PriceBreakdown> = {}): PriceBreakdown => ({
    basePricePerSeat: 20,
    seatsBooked: 1,
    subtotal: 20,
    luggageFee: 0,
    serviceFee: 0.4,
    totalPrice: 20.4,
    currency: 'EUR',
    serviceFeePercent: 2,
    serviceFeeFlat: 0,
    ...overrides,
});

describe('resolvePaymentSplit', () => {
    it('gives the driver the full fare they set and the platform only the rider surcharge', () => {
        const split = resolvePaymentSplit(breakdown());

        expect(split.amountTotal).toBe(20.4);
        expect(split.fareAmount).toBe(20);
        expect(split.platformFeeAmount).toBe(0.4);
        expect(split.currency).toBe('EUR');
    });

    it('does not carve the fee out of a total that already includes it (regression)', () => {
        const split = resolvePaymentSplit(breakdown());

        // The old implementation computed round(20.40 * 2) / 100 = 0.41 and left the driver 19.99.
        expect(split.fareAmount).not.toBe(19.99);
        expect(split.platformFeeAmount).not.toBe(0.41);
    });

    it('does not carve the fee out at the 20% the frontend used to hardcode (regression)', () => {
        const split = resolvePaymentSplit(
            breakdown({ serviceFee: 4, totalPrice: 24, serviceFeePercent: 20 })
        );

        expect(split.fareAmount).toBe(20);
        expect(split.platformFeeAmount).toBe(4);
        // Old behaviour: fee 4.80, fare 19.20.
        expect(split.fareAmount).not.toBe(19.2);
        expect(split.platformFeeAmount).not.toBe(4.8);
    });

    it('treats a zero fee as the whole total going to the driver', () => {
        const split = resolvePaymentSplit(
            breakdown({ serviceFee: 0, totalPrice: 20, serviceFeePercent: 0 })
        );

        expect(split.fareAmount).toBe(20);
        expect(split.platformFeeAmount).toBe(0);
        expect(split.fareAmount).toBe(split.amountTotal);
    });

    it('keeps the invariant exact on a rounding-hostile multi-seat booking', () => {
        // 3 seats at 3.30 at 2%: the booking fee is 0.20, while summing a per-seat 0.07 would give 0.21.
        const priced = calculateBookingPrice({
            basePricePerSeat: 3.3,
            seatsBooked: 3,
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });
        const split = resolvePaymentSplit(priced);

        expect(priced.subtotal).toBe(9.9);
        expect(priced.serviceFee).toBe(0.2);
        expect(priced.totalPrice).toBe(10.1);
        expect(split.fareAmount).toBe(9.9);
        expect(
            Math.round(split.fareAmount * 100) + Math.round(split.platformFeeAmount * 100)
        ).toBe(Math.round(split.amountTotal * 100));
    });

    it('includes a flat fee component in the platform side', () => {
        const priced = calculateBookingPrice({
            basePricePerSeat: 10,
            seatsBooked: 1,
            serviceFeePercent: 2,
            serviceFeeFlat: 0.3,
        });
        const split = resolvePaymentSplit(priced);

        expect(split.platformFeeAmount).toBe(0.5);
        expect(split.fareAmount).toBe(10);
        expect(split.amountTotal).toBe(10.5);
    });

    it('rejects a fee larger than the total', () => {
        expect(() => resolvePaymentSplit(breakdown({ serviceFee: 25, totalPrice: 20.4 }))).toThrow(
            'PAYMENT_SPLIT_NEGATIVE_FARE'
        );
    });
});

describe('resolveRefundSplit', () => {
    it('splits a partial refund pro-rata so the driver does not fund the platform fee', () => {
        const split = resolveRefundSplit({ amountTotal: 20.4, fareAmount: 20 }, 10.2);

        expect(split.fareRefundAmount).toBe(10);
        expect(split.feeRefundAmount).toBe(0.2);
    });

    it('always sums to the refund amount exactly, even on a non-terminating ratio', () => {
        const split = resolveRefundSplit({ amountTotal: 30, fareAmount: 20 }, 10);

        expect(
            Math.round(split.fareRefundAmount * 100) + Math.round(split.feeRefundAmount * 100)
        ).toBe(1000);
    });

    it('returns the whole refund as fare when there is no fee', () => {
        const split = resolveRefundSplit({ amountTotal: 20, fareAmount: 20 }, 20);

        expect(split.fareRefundAmount).toBe(20);
        expect(split.feeRefundAmount).toBe(0);
    });

    it('treats a zero refund as no movement', () => {
        expect(resolveRefundSplit({ amountTotal: 20.4, fareAmount: 20 }, 0)).toEqual({
            fareRefundAmount: 0,
            feeRefundAmount: 0,
        });
    });
});
