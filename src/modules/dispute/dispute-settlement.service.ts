import { BookingStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { recordRefund } from '../ledger/ledger.service.js';
import { PAYMENT_STATUSES } from '../payments/payment.service.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { emitToUsers } from '../../socket/index.js';
import { DISPUTE_STATUSES, OPEN_DISPUTE_STATUSES } from './dispute.constants.js';

export type DisputeResolution = 'REFUND' | 'PAYOUT' | 'SPLIT' | 'ESCALATE';

type SettlementInput = {
    disputeId: string;
    resolution: DisputeResolution;
    resolvedBy: string;
    refundPercent?: number;
};

const clampRefundPercent = (value: number | undefined, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(100, Math.max(0, Math.round(value)));
};

const round2 = (value: number) => Number(value.toFixed(2));
const SETTLEABLE_DISPUTE_STATUSES = [
    ...OPEN_DISPUTE_STATUSES,
    DISPUTE_STATUSES.AUTO_RESOLVED_RIDER_REFUND,
    DISPUTE_STATUSES.AUTO_RESOLVED_DRIVER_PAYOUT,
] as string[];

export const hasOpenDisputeForBooking = async (bookingId: string) => {
    const count = await prisma.dispute.count({
        where: {
            bookingId,
            status: { in: OPEN_DISPUTE_STATUSES },
        },
    });
    return count > 0;
};

export const openDisputeWhereForPaymentEligibility = {
    disputes: {
        none: {
            status: { in: OPEN_DISPUTE_STATUSES },
        },
    },
};

export const settleDispute = async (input: SettlementInput) => {
    const dispute = await prisma.dispute.findUnique({
        where: { id: input.disputeId },
        include: {
            booking: {
                include: {
                    payment: true,
                    passenger: { select: { id: true, name: true } },
                    ride: {
                        select: {
                            id: true,
                            driverId: true,
                            originAddress: true,
                            destinationAddress: true,
                            currency: true,
                        },
                    },
                },
            },
            ride: { select: { id: true, driverId: true, originAddress: true, destinationAddress: true } },
        },
    });

    if (!dispute) throw new Error('DISPUTE_NOT_FOUND');
    if (!SETTLEABLE_DISPUTE_STATUSES.includes(dispute.status)) throw new Error('DISPUTE_ALREADY_RESOLVED');

    const booking = dispute.booking;
    const payment = booking.payment;
    const riderId = booking.passengerId;
    const driverId = booking.ride.driverId;
    const paymentAmount = payment?.amountTotal ?? booking.paymentAmount ?? booking.totalPrice;
    const paymentCurrency = payment?.currency ?? booking.paymentCurrency ?? booking.ride.currency;
    const existingRefund = booking.refundedAt || booking.refundAmount;

    let finalStatus: string = DISPUTE_STATUSES.ESCALATED;
    let resolutionText: string = input.resolution;
    let refundAmount = 0;
    let payoutAmount = payment?.fareAmount ?? booking.segmentFare ?? booking.totalPrice;
    const now = new Date();

    if (input.resolution === 'ESCALATE') {
        finalStatus = DISPUTE_STATUSES.ESCALATED;
    } else if (input.resolution === 'REFUND' || input.resolution === 'SPLIT') {
        const refundPercent = input.resolution === 'REFUND'
            ? 100
            : clampRefundPercent(input.refundPercent, 50);
        refundAmount = round2((paymentAmount * refundPercent) / 100);
        payoutAmount = Math.max(0, round2((payment?.fareAmount ?? paymentAmount) - refundAmount));
        resolutionText = input.resolution === 'SPLIT'
            ? `SPLIT:${refundPercent}%_REFUND`
            : 'REFUND';

        if (refundAmount > 0 && !existingRefund) {
            await prisma.rideBooking.update({
                where: { id: booking.id },
                data: {
                    refundAmount,
                    refundPercent,
                    status: input.resolution === 'REFUND' ? BookingStatus.CANCELLED : BookingStatus.DISPUTED,
                },
            });

            if (payment) {
                await prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: PAYMENT_STATUSES.REFUND_PENDING },
                });
            }

            if (booking.stripePaymentIntentId && booking.paymentCapturedAt) {
                const refund = await refundPaymentIntent(
                    booking.stripePaymentIntentId,
                    toMinorCurrencyUnits(refundAmount)
                );
                await prisma.rideBooking.update({
                    where: { id: booking.id },
                    data: {
                        refundId: refund.id,
                        refundedAt: now,
                    },
                });
            } else {
                await prisma.rideBooking.update({
                    where: { id: booking.id },
                    data: { refundedAt: now },
                });
            }

            if (payment) {
                await recordRefund({
                    paymentId: payment.id,
                    bookingId: booking.id,
                    riderId,
                    driverId,
                    refundAmount,
                    currency: paymentCurrency,
                });
            }
        }

        if (payment) {
            await prisma.payment.update({
                where: { id: payment.id },
                data: input.resolution === 'REFUND'
                    ? { status: PAYMENT_STATUSES.REFUNDED }
                    : {
                        status: payoutAmount > 0 ? PAYMENT_STATUSES.PAYOUT_ELIGIBLE : PAYMENT_STATUSES.REFUNDED,
                        fareAmount: payoutAmount,
                        payoutEligibleAt: payoutAmount > 0 ? now : null,
                    },
            });
        }

        finalStatus = input.resolution === 'REFUND'
            ? DISPUTE_STATUSES.RESOLVED_REFUND
            : DISPUTE_STATUSES.RESOLVED_SPLIT;
    } else if (input.resolution === 'PAYOUT') {
        if (payment) {
            await prisma.payment.update({
                where: { id: payment.id },
                data: {
                    status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
                    payoutEligibleAt: now,
                },
            });
        }
        await prisma.rideBooking.update({
            where: { id: booking.id },
            data: { status: booking.status === BookingStatus.DISPUTED ? BookingStatus.COMPLETED : booking.status },
        });
        finalStatus = DISPUTE_STATUSES.RESOLVED_PAYOUT;
    }

    const updatedDispute = await prisma.dispute.update({
        where: { id: dispute.id },
        data: {
            status: finalStatus,
            resolution: resolutionText,
            resolvedBy: input.resolvedBy,
            resolvedAt: finalStatus === DISPUTE_STATUSES.ESCALATED ? null : now,
        },
        include: {
            booking: { select: { id: true, passengerId: true, status: true, totalPrice: true } },
            ride: { select: { id: true, driverId: true, originAddress: true, destinationAddress: true } },
        },
    });

    const route = `${booking.ride.originAddress.split(',')[0]} to ${booking.ride.destinationAddress.split(',')[0]}`;
    const notificationBody = input.resolution === 'ESCALATE'
        ? `Your dispute for ${route} has been escalated for manual review.`
        : `Your dispute for ${route} was resolved: ${resolutionText.replace(/_/g, ' ')}.`;

    await Promise.all([
        createNotification({
            userId: riderId,
            type: 'dispute.resolved',
            title: input.resolution === 'ESCALATE' ? 'Dispute escalated' : 'Dispute resolved',
            body: notificationBody,
            data: {
                disputeId: dispute.id,
                bookingId: booking.id,
                rideId: booking.rideId,
                resolution: resolutionText,
                refundAmount: String(refundAmount),
                payoutAmount: String(payoutAmount),
                deepLink: `app://booking/${booking.id}`,
            },
        }),
        createNotification({
            userId: driverId,
            type: 'dispute.resolved',
            title: input.resolution === 'ESCALATE' ? 'Dispute escalated' : 'Dispute resolved',
            body: notificationBody,
            data: {
                disputeId: dispute.id,
                bookingId: booking.id,
                rideId: booking.rideId,
                resolution: resolutionText,
                refundAmount: String(refundAmount),
                payoutAmount: String(payoutAmount),
                deepLink: `app://driver/booking-request/${booking.id}`,
            },
        }),
    ]);

    await emitToUsers([riderId, driverId], 'dispute:updated', {
        disputeId: dispute.id,
        bookingId: booking.id,
        rideId: booking.rideId,
        status: finalStatus,
        resolution: resolutionText,
        refundAmount,
        payoutAmount,
        updatedAt: now.toISOString(),
    });

    return updatedDispute;
};
