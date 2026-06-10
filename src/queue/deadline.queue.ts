// @ts-ignore — bullmq types not resolved by moduleResolution:"Node"; runtime works fine
import { Queue, Worker } from 'bullmq';
import { logError } from '../utils/logger.js';
import { bullRedis } from './redisConnection.js';
import { prisma } from '../config/index.js';
import { BookingStatus } from '@prisma/client';
import { createNotification } from '../modules/notification/notification.service.js';
import { refundPaymentIntent } from '../modules/payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../modules/ride-booking/booking-cancellation-policy.js';
import { isBypassBookingPaymentMode } from '../modules/ride-booking/booking-payment-mode.js';
import { releaseSegmentSeats } from '../modules/ride-booking/segment-capacity.utils.js';

const QUEUE_NAME = 'booking-deadline';
const EXTENDED_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

export const deadlineQueue = new Queue(QUEUE_NAME, { connection: bullRedis });

/**
 * Enqueue the initial deadline check for a booking.
 * Called immediately after a booking is created with DRIVER_PENDING status.
 */
export const enqueueDeadlineCheck = async (bookingId: string, delayMs: number) => {
    await deadlineQueue.add(
        'initial',
        { bookingId },
        {
            delay: delayMs,
            jobId: `deadline:initial:${bookingId}`,
            removeOnComplete: true,
            removeOnFail: 1000,
        }
    );
};

export const deadlineWorker = new Worker(
    QUEUE_NAME,
    async (job: any) => {
        const { bookingId } = job.data as { bookingId: string };

        if (job.name === 'initial') {
            await handleInitialDeadline(bookingId);
        } else if (job.name === 'extended') {
            await handleExtendedDeadline(bookingId);
        }
    },
    { connection: bullRedis, concurrency: 5 }
);

deadlineWorker.on('failed', (job: any, err: any) => {
    logError('DeadlineQueue job failed', err, { jobId: job?.id });
});

const handleInitialDeadline = async (bookingId: string) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            ride: { select: { id: true, originAddress: true, destinationAddress: true } },
        },
    });

    if (!booking || booking.status !== BookingStatus.DRIVER_PENDING) return;
    if (booking.deadlineExpiredNotifiedAt) return; // already handled

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: { deadlineExpiredNotifiedAt: new Date() },
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.deadline_expired',
        title: "Driver hasn't responded yet",
        body: "The driver hasn't confirmed your booking. You can wait 1 more hour or cancel to find a new ride.",
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            action: 'deadline_expired',
            deepLink: `app://booking/${booking.id}/deadline-expired`,
        },
    });

    // Enqueue the auto-cancel job for 1 hour from now
    await deadlineQueue.add(
        'extended',
        { bookingId },
        {
            delay: EXTENDED_DEADLINE_MS,
            jobId: `deadline:extended:${bookingId}`,
            removeOnComplete: true,
            removeOnFail: 1000,
        }
    );
};

const handleExtendedDeadline = async (bookingId: string) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: { select: { totalSeats: true } } },
    });

    if (!booking || booking.status !== BookingStatus.DRIVER_PENDING) return;
    if (booking.autoCancelledAt) return; // already cancelled

    const bypassPayment = isBypassBookingPaymentMode();
    const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
    let refundId: string | null = null;
    let refundInitiated = false;

    await prisma.$transaction(async (tx) => {
        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                autoCancelledAt: new Date(),
                cancelledByRole: 'SYSTEM',
                cancellationReason: 'DRIVER_NO_RESPONSE_EXTENDED',
                refundPercent: 100,
                refundAmount: fullRefundAmount,
            },
        });

        await releaseSegmentSeats(tx as any, {
            rideId: booking.rideId,
            seatsBooked: booking.seatsBooked,
            pickupPosition: booking.pickupPosition,
            dropoffPosition: booking.dropoffPosition,
            totalSeats: booking.ride.totalSeats,
        });

        if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
            const refund = await refundPaymentIntent(
                booking.stripePaymentIntentId,
                toMinorCurrencyUnits(fullRefundAmount)
            );
            refundId = refund.id;
            refundInitiated = true;
        } else if (bypassPayment && fullRefundAmount > 0) {
            refundInitiated = true;
        }

        if (refundId || refundInitiated) {
            await tx.rideBooking.update({
                where: { id: bookingId },
                data: { refundId, refundedAt: new Date() },
            });
        }
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.cancelled.no_driver_response',
        title: 'Booking cancelled',
        body: 'Your booking was cancelled due to no driver response. Full refund initiated.',
        data: {
            bookingId: booking.id,
            rideId: booking.rideId,
            refundAmount: String(fullRefundAmount),
            refundInitiated: refundInitiated ? 'true' : 'false',
            deepLink: 'app://search-rides',
        },
    });
};
