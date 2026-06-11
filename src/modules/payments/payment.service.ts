import { prisma } from '../../config/index.js';
import { recordPaymentReceived, recordRefund } from '../ledger/ledger.service.js';
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

const PAYMENT_TRANSITIONS: Record<string, string[]> = {
    CREATED: ['PAYMENT_PENDING', 'PAYMENT_FAILED'],
    PAYMENT_PENDING: ['PAID', 'PAYMENT_FAILED'],
    PAID: ['HELD_IN_ESCROW', 'REFUND_PENDING'],
    HELD_IN_ESCROW: ['PAYOUT_ELIGIBLE', 'REFUND_PENDING'],
    PAYOUT_ELIGIBLE: ['TRANSFER_CREATED', 'REFUND_PENDING'],
    TRANSFER_CREATED: ['PAYOUT_COMPLETED', 'PAYOUT_ELIGIBLE'], // retry on failure
    REFUND_PENDING: ['REFUNDED'],
};

const assertTransition = (current: string, target: string) => {
    const allowed = PAYMENT_TRANSITIONS[current];
    if (!allowed || !allowed.includes(target)) {
        throw new Error(`INVALID_PAYMENT_TRANSITION: ${current} -> ${target}`);
    }
};

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
}) => {
    return prisma.payment.create({
        data: {
            bookingId: params.bookingId,
            rideId: params.rideId,
            riderId: params.riderId,
            amountTotal: params.amountTotal,
            fareAmount: params.fareAmount,
            platformFeeAmount: params.platformFeeAmount,
            currency: params.currency,
            stripePaymentIntentId: params.stripePaymentIntentId ?? null,
            status: PAYMENT_STATUSES.CREATED,
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

export const markRefunded = async (paymentId: string, driverId: string) => {
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    assertTransition(payment.status, PAYMENT_STATUSES.REFUNDED);

    const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: { status: PAYMENT_STATUSES.REFUNDED },
    });

    await recordRefund({
        paymentId: payment.id,
        bookingId: payment.bookingId,
        riderId: payment.riderId,
        driverId,
        refundAmount: payment.amountTotal,
        currency: payment.currency,
    });

    return updated;
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
