import type { PriceBreakdown } from './ride-booking.types.js';

export interface PaymentSplit {
    amountTotal: number;
    fareAmount: number;
    platformFeeAmount: number;
    currency: string;
}

export interface RefundSplit {
    fareRefundAmount: number;
    feeRefundAmount: number;
}

/**
 * Splits a rider's charge into the driver's fare and the platform's fee.
 *
 * Under the fee-on-top model the fee is already a separate line in `totalPrice`, so the split simply
 * reads it off — it must NOT be recomputed from a percentage. The previous implementation derived
 * `platformFeeAmount = round(totalPrice * pct) / 100` from a total that already included the fee,
 * which double-charged: at 2% on a 20.00 seat the driver received 19.99 instead of the 20.00 they set,
 * and the platform booked 0.41 against a 0.40 rider surcharge.
 *
 * `fareAmount` is derived by subtraction so `amountTotal === fareAmount + platformFeeAmount` holds
 * exactly. Ledger reconciliation compares payment debits (`amountTotal`) against credits
 * (`fareAmount + platformFeeAmount`), so any drift here surfaces as a ledger imbalance.
 */
export const resolvePaymentSplit = (breakdown: PriceBreakdown): PaymentSplit => {
    const totalCents = Math.round(breakdown.totalPrice * 100);
    const feeCents = Math.round(breakdown.serviceFee * 100);
    const fareCents = totalCents - feeCents;

    if (fareCents < 0) {
        throw new Error('PAYMENT_SPLIT_NEGATIVE_FARE');
    }
    if (fareCents + feeCents !== totalCents) {
        throw new Error('PAYMENT_SPLIT_IMBALANCE');
    }

    return {
        amountTotal: totalCents / 100,
        fareAmount: fareCents / 100,
        platformFeeAmount: feeCents / 100,
        currency: breakdown.currency,
    };
};

/**
 * Divides a refund between the driver's fare and the platform's fee, pro-rata on the original split.
 *
 * Without this the driver funds the platform's share of every refund: the ledger debited the driver
 * for the whole gross refund while the platform kept its fee in full.
 *
 * The fee component is derived by subtraction so the two parts always sum to `refundAmount` exactly.
 */
export const resolveRefundSplit = (
    payment: { amountTotal: number; fareAmount: number },
    refundAmount: number
): RefundSplit => {
    const totalCents = Math.round(payment.amountTotal * 100);
    const refundCents = Math.round(refundAmount * 100);

    if (refundCents <= 0) {
        return { fareRefundAmount: 0, feeRefundAmount: 0 };
    }
    if (totalCents <= 0) {
        // No basis to apportion against; attribute everything to the fare.
        return { fareRefundAmount: refundCents / 100, feeRefundAmount: 0 };
    }

    const fareCents = Math.round(payment.fareAmount * 100);
    const fareRefundCents = Math.round((refundCents * fareCents) / totalCents);
    const feeRefundCents = refundCents - fareRefundCents;

    return {
        fareRefundAmount: fareRefundCents / 100,
        feeRefundAmount: feeRefundCents / 100,
    };
};
