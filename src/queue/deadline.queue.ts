// @ts-ignore — bullmq types not resolved by moduleResolution:"Node"; runtime works fine
import { Queue, Worker } from 'bullmq';
import { logError } from '../utils/logger.js';
import { bullRedis } from './redisConnection.js';
import { prisma } from '../config/index.js';
import { BookingStatus } from '@prisma/client';
import { createNotification } from '../modules/notification/notification.service.js';
import { cancelPaymentIntent, refundPaymentIntent } from '../modules/payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../modules/ride-booking/booking-cancellation-policy.js';
import { isBypassBookingPaymentMode } from '../modules/ride-booking/booking-payment-mode.js';
import { releaseBookingSeats } from '../modules/ride-booking/segment-capacity.utils.js';

const QUEUE_NAME = 'booking-deadline';
const EXTENDED_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

/** How long a rider gets to finish paying before the booking is closed out. */
export const bookingPaymentWindowMs = (): number =>
    Number(process.env.BOOKING_PAYMENT_WINDOW_MINUTES || '15') * 60 * 1000;

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

    // Enqueue reminder 1 hour before deadline (if deadline is > 1 hour away)
    const reminderDelayMs = delayMs - (60 * 60 * 1000);
    if (reminderDelayMs > 0) {
        await deadlineQueue.add(
            'reminder',
            { bookingId },
            {
                delay: reminderDelayMs,
                jobId: `deadline:reminder:${bookingId}`,
                removeOnComplete: true,
                removeOnFail: 1000,
            }
        );
    }
};

/**
 * Enqueue the payment deadline for a booking that is waiting on Stripe.
 *
 * An unpaid booking holds no seats, so nothing is at stake for other riders — but its
 * PaymentIntent stays live and payable, which is why it still has to be closed out.
 */
export const enqueuePaymentExpiryCheck = async (bookingId: string, delayMs: number) => {
    await deadlineQueue.add(
        'payment-expiry',
        { bookingId },
        {
            delay: delayMs,
            jobId: `deadline:payment-expiry:${bookingId}`,
            removeOnComplete: true,
            removeOnFail: 1000,
        }
    );
};

/**
 * Restart the payment window for a booking the rider has come back to.
 *
 * The delayed job is keyed on the booking id, so re-adding it alone is a no-op — BullMQ keeps the
 * original delay. Without removing it first, a rider who resumes checkout near the end of the
 * window gets expired mid-payment. Failing to reschedule must not fail the resume: the worst case
 * is the original deadline standing, which is the behaviour we already had.
 */
export const reschedulePaymentExpiryCheck = async (bookingId: string, delayMs: number) => {
    const jobId = `deadline:payment-expiry:${bookingId}`;
    try {
        const existing = await deadlineQueue.getJob(jobId);
        if (existing) await existing.remove();
        await enqueuePaymentExpiryCheck(bookingId, delayMs);
        // Touch the row so the sweeper, which is the backstop for a job that never ran, measures the
        // grace period from the restarted window rather than from booking creation.
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { updatedAt: new Date() },
        });
    } catch (error) {
        logError('Could not reschedule the payment expiry check', error, { bookingId });
    }
};

export const deadlineWorker = new Worker(
    QUEUE_NAME,
    async (job: any) => {
        const { bookingId } = job.data as { bookingId: string };

        if (job.name === 'initial') {
            await handleInitialDeadline(bookingId);
        } else if (job.name === 'extended') {
            await handleExtendedDeadline(bookingId);
        } else if (job.name === 'reminder') {
            await handleDeadlineReminder(bookingId);
        } else if (job.name === 'payment-expiry') {
            await expireUnpaidBooking(bookingId);
        }
    },
    { connection: bullRedis, concurrency: 5 }
);

deadlineWorker.on('failed', (job: any, err: any) => {
    logError('DeadlineQueue job failed', err, { jobId: job?.id });
});

/**
 * Closes out a booking the rider never paid for.
 *
 * Shared by the delayed job and the maintenance sweeper, so the two cannot disagree.
 * The status guard makes it safe to run twice: a booking that has since been paid for,
 * cancelled, or already expired is left exactly as it is. Returns whether it acted.
 */
export const expireUnpaidBooking = async (bookingId: string): Promise<boolean> => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        select: {
            id: true,
            status: true,
            rideId: true,
            passengerId: true,
            seatsBooked: true,
            pickupPosition: true,
            dropoffPosition: true,
            stripePaymentIntentId: true,
            ride: { select: { totalSeats: true, originAddress: true, destinationAddress: true } },
        },
    });

    if (!booking || booking.status !== BookingStatus.PAYMENT_PENDING) return false;

    const expired = await prisma.$transaction(async (tx) => {
        const claimed = await tx.rideBooking.updateMany({
            where: { id: bookingId, status: BookingStatus.PAYMENT_PENDING },
            data: {
                status: BookingStatus.PAYMENT_FAILED,
                cancellationReason: 'PAYMENT_NOT_COMPLETED',
            },
        });

        if (claimed.count === 0) return false;

        // Normally a no-op: in stripe mode an unpaid booking holds no seats. Bypass-mode
        // bookings never sit in PAYMENT_PENDING, so this only matters for rows written
        // before seats moved to payment time.
        await releaseBookingSeats(tx, {
            bookingId,
            rideId: booking.rideId,
            seatsBooked: booking.seatsBooked,
            pickupPosition: booking.pickupPosition,
            dropoffPosition: booking.dropoffPosition,
            totalSeats: booking.ride.totalSeats,
        });

        return true;
    });

    if (!expired) return false;

    // After the commit: the intent must not stay payable, or the rider could authorise it
    // later and be charged for a booking that no longer exists.
    if (booking.stripePaymentIntentId) {
        try {
            await cancelPaymentIntent(booking.stripePaymentIntentId);
        } catch (error) {
            logError('Could not cancel the PaymentIntent of an expired unpaid booking', error, {
                bookingId,
                paymentIntentId: booking.stripePaymentIntentId,
            });
        }
    }

    try {
        await createNotification({
            userId: booking.passengerId,
            type: 'booking.payment.expired',
            title: 'Booking not completed',
            body: 'Your payment was not completed in time, so the booking was closed. You can book this ride again.',
            data: {
                bookingId,
                rideId: booking.rideId,
                originAddress: booking.ride.originAddress,
                destinationAddress: booking.ride.destinationAddress,
                deepLink: `app://ride/${booking.rideId}`,
            },
        });
    } catch (error) {
        logError('Unpaid-booking expiry notification failed', error, { bookingId });
    }

    return true;
};

const handleDeadlineReminder = async (bookingId: string) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            ride: { select: { id: true, driverId: true, originAddress: true, destinationAddress: true } },
        },
    });

    if (!booking || booking.status !== BookingStatus.DRIVER_PENDING) return;
    if (booking.reminderSentAt) return; // already sent

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: { reminderSentAt: new Date() },
    });

    // Notify driver: respond soon
    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.driver.deadline_reminder',
        title: 'Respond to booking request',
        body: 'A booking request will expire in 1 hour. Please accept or reject.',
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });
};

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

        await releaseBookingSeats(tx, {
            bookingId,
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
