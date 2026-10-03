import { Prisma } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { recordPaymentReceived, recordRefund } from '../ledger/ledger.service.js';
import { resolveRefundSplit } from '../ride-booking/booking-payment-split.js';
import { writeOutboxEvent } from './payment-outbox.worker.js';

// ============================================================
//  PAYMENT STATUS TRANSITIONS
// ============================================================

export const PAYMENT_STATUSES = {
    CREATED: 'CREATED',
    PAYMENT_PENDING: 'PAYMENT_PENDING',
    PAID: 'PAID',
    HELD_IN_ESCROW: 'HELD_IN_ESCROW',
    PAYOUT_ELIGIBLE: 'PAYOUT_ELIGIBLE',
    TRANSFER_CREATED: 'TRANSFER_CREATED',
    PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
    REFUND_PENDING: 'REFUND_PENDING',
    REFUNDED: 'REFUNDED',
    PAYMENT_FAILED: 'PAYMENT_FAILED',
} as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[keyof typeof PAYMENT_STATUSES];

const PAYMENT_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['PAYMENT_PENDING', 'PAYMENT_FAILED'],
    PAYMENT_PENDING: ['PAID', 'PAYMENT_FAILED'],
    PAID: ['HELD_IN_ESCROW', 'REFUND_PENDING'],
    HELD_IN_ESCROW: ['PAYOUT_ELIGIBLE', 'REFUND_PENDING'],
    PAYOUT_ELIGIBLE: ['TRANSFER_CREATED', 'REFUND_PENDING'],
    TRANSFER_CREATED: ['PAYOUT_COMPLETED', 'PAYOUT_ELIGIBLE'], // retry on failure
    // PAYOUT_ELIGIBLE: a partial refund leaves the driver a residual fare that must still be paid
    // out. Without this the payment terminates at REFUNDED, which payout selection ignores, so a
    // 50%-refunded booking paid the driver nothing while the rider kept half.
    REFUND_PENDING: ['REFUNDED', 'PAYOUT_ELIGIBLE'],
};

const assertTransition = (current: string, target: string) => {
    const allowed = PAYMENT_TRANSITIONS[current];
    if (!allowed || !allowed.includes(target)) {
        throw new Error(`INVALID_PAYMENT_TRANSITION: ${current} -> ${target}`);
    }
};

// ============================================================
//  RESIDUAL AMOUNTS
// ============================================================

/**
 * What the driver is still owed: the gross fare less everything already refunded out of it.
 *
 * `fareAmount` stays the amount charged, so payout, admin revenue sums and the ledger keep reading
 * one immutable figure and a second partial refund apportions against the original charge rather
 * than a previously reduced one.
 */
export const netFareAmount = (payment: { fareAmount: number; refundedFareAmount?: number | null }) =>
    Math.max(0, Math.round((payment.fareAmount - (payment.refundedFareAmount ?? 0)) * 100)) / 100;

/** The platform's fee less the share already refunded to the rider. */
export const netPlatformFeeAmount = (payment: {
    platformFeeAmount: number;
    refundedFeeAmount?: number | null;
}) =>
    Math.max(0, Math.round((payment.platformFeeAmount - (payment.refundedFeeAmount ?? 0)) * 100)) / 100;

// ============================================================
//  CREATE PAYMENT
// ============================================================

export const createPayment = async (params: {
    bookingId: string;
    rideId: string;
    riderId: string;
    amountTotal: number;
    fareAmount: number;
    platformFeeAmount: number;
    currency: string;
    stripePaymentIntentId?: string;
    /** Initial status. Defaults to CREATED; pass PAYMENT_PENDING to skip the extra transition write. */
    status?: PaymentStatus;
    /** Transaction client, so the payment row can be written atomically with the booking. */
    tx?: Prisma.TransactionClient;
}) => {
    const client = params.tx ?? prisma;
    return client.payment.create({
        data: {
            bookingId: params.bookingId,
            rideId: params.rideId,
            riderId: params.riderId,
            amountTotal: params.amountTotal,
            fareAmount: params.fareAmount,
            platformFeeAmount: params.platformFeeAmount,
            currency: params.currency,
            stripePaymentIntentId: params.stripePaymentIntentId ?? null,
            status: params.status ?? PAYMENT_STATUSES.CREATED,
        },
    });
};

// ============================================================
//  TRANSITION HELPERS
// ============================================================

export const markPaymentPending = async (paymentId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.PAYMENT_PENDING);
    return prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.PAYMENT_PENDING },
    });
};

export const markPaymentPaid = async (paymentId: string, driverId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.PAID);

    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.PAID },
    });

    // Record ledger entries
    await recordPaymentReceived({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        riderId: payment.riderId,
        driverId,
        totalAmount: payment.amountTotal,
        fareAmount: payment.fareAmount,
        platformFee: payment.platformFeeAmount,
        currency: payment.currency,
    });

    // Write outbox event to trigger escrow transition
    await writeOutboxEvent({
        eventType: 'payment.paid',
        aggregateType: 'PAYMENT',
        aggregateId: paymentId,
        payload: { paymentId, bookingId: payment.bookingId, driverId },
    });

    return updated;
};

export const markBookingPaymentPaid = async (bookingId: string, driverId: string) => {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) return null;

    if (payment.status === PAYMENT_STATUSES.CREATED) {
        await markPaymentPending(payment.id);
        return markPaymentPaid(payment.id, driverId);
    }

    if (payment.status === PAYMENT_STATUSES.PAYMENT_PENDING) {
        return markPaymentPaid(payment.id, driverId);
    }

    return payment;
};

export const markHeldInEscrow = async (paymentId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.HELD_IN_ESCROW);
    return prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.HELD_IN_ESCROW },
    });
};

export const markPayoutEligible = async (paymentId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.PAYOUT_ELIGIBLE);
    return prisma.payment.update({
        where: { id: paymentId },
        data: {
            status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
            payoutEligibleAt: new Date(),
        },
    });
};

export const markTransferCreated = async (paymentId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.TRANSFER_CREATED);
    return prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.TRANSFER_CREATED },
    });
};

export const markPayoutCompleted = async (paymentId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.PAYOUT_COMPLETED);
    return prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.PAYOUT_COMPLETED },
    });
};

export const markRefundPending = async (paymentId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.REFUND_PENDING);
    return prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.REFUND_PENDING },
    });
};

export const markRefunded = async (paymentId: string, driverId: string, refundAmount?: number) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (payment.status === PAYMENT_STATUSES.REFUNDED) return payment;

    if (payment.status !== PAYMENT_STATUSES.REFUND_PENDING) {
        assertTransition(payment.status, PAYMENT_STATUSES.REFUND_PENDING);
        await prisma.payment.update({
            where: { id: paymentId },
            data: { status: PAYMENT_STATUSES.REFUND_PENDING },
        });
    }

    const effectiveRefund = refundAmount ?? payment.amountTotal;
    // Apportion against the gross charge, never against amounts a previous partial refund reduced.
    const { fareRefundAmount, feeRefundAmount } = resolveRefundSplit(payment, effectiveRefund);

    const cents = (value: number) => Math.round(value * 100);
    const refundedFareCents = cents(payment.refundedFareAmount ?? 0) + cents(fareRefundAmount);
    const refundedFeeCents = cents(payment.refundedFeeAmount ?? 0) + cents(feeRefundAmount);
    const residualFareCents = cents(payment.fareAmount) - refundedFareCents;
    const totalRefundedCents = refundedFareCents + refundedFeeCents;
    const isPartialRefund = totalRefundedCents < cents(payment.amountTotal);

    // A partial refund leaves the driver something to be paid; a full one does not.
    const nextStatus =
        isPartialRefund && residualFareCents > 0
            ? PAYMENT_STATUSES.PAYOUT_ELIGIBLE
            : PAYMENT_STATUSES.REFUNDED;

    assertTransition(PAYMENT_STATUSES.REFUND_PENDING, nextStatus);

    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
            status: nextStatus,
            // Accumulate what has been refunded instead of shrinking the gross: payout pays
            // `fareAmount - refundedFareAmount`, so the driver still gets only the residual while
            // the original charge stays on the row for reconciliation and repeat refunds.
            refundedFareAmount: Math.min(cents(payment.fareAmount), refundedFareCents) / 100,
            refundedFeeAmount: Math.min(cents(payment.platformFeeAmount), refundedFeeCents) / 100,
            ...(nextStatus === PAYMENT_STATUSES.PAYOUT_ELIGIBLE ? { payoutEligibleAt: new Date() } : {}),
        },
    });

    await recordRefund({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        riderId: payment.riderId,
        driverId,
        refundAmount: effectiveRefund,
        fareRefundAmount,
        feeRefundAmount,
        currency: payment.currency,
    });

    return updated;
};

export const markBookingPaymentRefunded = async (
    bookingId: string,
    driverId: string,
    refundAmount?: number
) => {
    const payment = await prisma.payment.findUnique({ where: { bookingId } });
    if (!payment) return null;
    return markRefunded(payment.id, driverId, refundAmount);
};

export const markPaymentFailed = async (paymentId: string, reason?: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.PAYMENT_FAILED);
    return prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.PAYMENT_FAILED, failureReason: reason ?? null },
    });
};

// ============================================================
//  QUERIES
// ============================================================

export const getPaymentByBookingId = async (bookingId: string) => {
    return prisma.payment.findUnique({ where: { bookingId } });
};

export const getPaymentsByRideId = async (rideId: string) => {
    return prisma.payment.findMany({ where: { rideId }, orderBy: { createdAt: 'desc' } });
};

export const getRiderTransactions = async (riderId: string) => {
    return prisma.payment.findMany({
        where: { riderId },
        orderBy: { createdAt: 'desc' },
        include: {
            booking: {
                select: {
                    id: true,
                    status: true,
                    pickupAddress: true,
                    dropoffAddress: true,
                    refundAmount: true,
                    refundPercent: true,
                    refundedAt: true,
                    cancelledAt: true,
                    disputes: {
                        select: { id: true, status: true, reason: true },
                        orderBy: { createdAt: 'desc' },
                    },
                    ride: {
                        select: {
                            id: true,
                            originAddress: true,
                            destinationAddress: true,
                            departureDate: true,
                            departureTime: true,
                            driver: { select: { id: true, firstName: true } },
                        },
                    },
                },
            },
        },
    });
};

export const getEligiblePaymentsForPayout = async (driverId?: string) => {
    return prisma.payment.findMany({
        where: {
            status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
            ...(driverId ? { booking: { ride: { driverId } } } : {}),
        },
        include: {
            booking: {
                select: { ride: { select: { driverId: true } } },
            },
        },
    });
};
