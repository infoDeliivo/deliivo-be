import type { PriceBreakdown } from './ride-booking.types.js';

export const MAX_SEATS_PER_BOOKING = 4;

export interface CalculateBookingPriceInput {
    basePricePerSeat: number;
    seatsBooked: number;
    /** Capacity declaration only — never a monetary surcharge. Accepted for call-site clarity. */
    luggageCount?: number;
    currency?: string;
    /** Rider-paid percentage, applied ON TOP of the driver's fare. Resolved from PricingConfig. */
    serviceFeePercent: number;
    /** Rider-paid fixed amount per booking, applied ON TOP. Usually 0. */
    serviceFeeFlat: number;
}

/**
 * Builds the rider-facing price breakdown.
 *
 * The service fee is charged ON TOP of the driver's fare: the driver keeps `subtotal` in full and the
 * rider pays `subtotal + serviceFee`. See docs/requirements/Carpool_Payment_Feature_Complete_Design.pdf
 * section 10, which specifies "platform fee charged to rider" with the driver's earning liability equal
 * to the seat fare.
 *
 * All arithmetic runs in integer cents so that `subtotal + luggageFee + serviceFee === totalPrice`
 * holds exactly, which is what `resolvePaymentSplit` and the double-entry ledger depend on.
 *
 * The fee is computed once on the whole-booking subtotal, never per seat and multiplied: at low rates
 * per-seat rounding drifts from the charged total (3 seats at 3.30 gives 1.50 per-seat versus 1.49 on
 * the booking). This function is the single source of that number for both the rider's charge and the
 * driver's publish-time quote.
 */
export const calculateBookingPrice = (input: CalculateBookingPriceInput): PriceBreakdown => {
    const { basePricePerSeat, seatsBooked, currency = 'EUR', serviceFeePercent, serviceFeeFlat } = input;

    const subtotalCents = Math.round(basePricePerSeat * 100) * seatsBooked;
    // Luggage is a capacity declaration only; it is never a monetary surcharge.
    const luggageFeeCents = 0;
    const percentFeeCents = Math.round((subtotalCents * serviceFeePercent) / 100);
    const flatFeeCents = Math.round(serviceFeeFlat * 100);
    const serviceFeeCents = percentFeeCents + flatFeeCents;
    const totalCents = subtotalCents + luggageFeeCents + serviceFeeCents;

    return {
        basePricePerSeat,
        seatsBooked,
        subtotal: subtotalCents / 100,
        luggageFee: luggageFeeCents / 100,
        serviceFee: serviceFeeCents / 100,
        totalPrice: totalCents / 100,
        currency,
        serviceFeePercent,
        serviceFeeFlat,
    };
};
