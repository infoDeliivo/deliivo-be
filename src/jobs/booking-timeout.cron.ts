import { BookingStatus, Prisma } from '@prisma/client';
import cron from 'node-cron';
import { prisma } from '../config/index.js';
import logger from '../utils/logger.js';
import { createNotification } from '../modules/notification/notification.service.js';
import { refundPaymentIntent } from '../modules/payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../modules/ride-booking/booking-cancellation-policy.js';

let timeoutSweepRunning = false;
let timeoutSweepDisabledByMissingMigration = false;

const isMissingColumnError = (error: unknown): boolean => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2022') {
        return true;
    }

    return (
        error instanceof Error &&
        error.message.includes('driverDecisionDeadlineAt') &&
        error.message.toLowerCase().includes('does not exist')
    );
};

const processTimedOutBooking = async (bookingId: string) => {
    const cancelled = await prisma.$transaction(async (tx) => {
        const booking = await tx.rideBooking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                rideId: true,
                passengerId: true,
                seatsBooked: true,
                status: true,
                stripePaymentIntentId: true,
                paymentCapturedAt: true,
                paymentAmount: true,
                totalPrice: true,
            },
        });

        if (!booking || booking.status !== BookingStatus.DRIVER_PENDING) {
            return null;
        }

        await tx.rideBooking.update({
            where: { id: booking.id },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'SYSTEM',
                cancellationReason: 'DRIVER_DECISION_TIMEOUT',
            },
        });

        await tx.ride.update({
            where: { id: booking.rideId },
            data: {
                availableSeats: { increment: booking.seatsBooked },
            },
        });

        return booking;
    });

    if (!cancelled) return;

    let refundInitiated = false;
    if (cancelled.paymentCapturedAt && cancelled.stripePaymentIntentId) {
        try {
            const refundAmount = cancelled.paymentAmount ?? cancelled.totalPrice;
            const refund = await refundPaymentIntent(
                cancelled.stripePaymentIntentId,
                toMinorCurrencyUnits(refundAmount)
            );
            refundInitiated = true;

            await prisma.rideBooking.update({
                where: { id: cancelled.id },
                data: {
                    refundId: refund.id,
                    refundPercent: 100,
                    refundAmount,
                    refundedAt: new Date(),
                },
            });
        } catch (error) {
            logger.error('Timeout refund failed', { bookingId: cancelled.id, error });
        }
    }

    await createNotification({
        userId: cancelled.passengerId,
        type: 'booking.driver.timeout',
        title: 'Ride request expired',
        body: 'Driver did not respond in time. Your booking was cancelled.',
        data: {
            bookingId: cancelled.id,
            rideId: cancelled.rideId,
            refundInitiated: refundInitiated ? 'true' : 'false',
            refundPercent: '100',
            deepLink: `app://booking/${cancelled.id}`,
        },
    });
};

export const runBookingTimeoutSweep = async () => {
    if (timeoutSweepRunning || timeoutSweepDisabledByMissingMigration) return;
    timeoutSweepRunning = true;

    try {
        const expired = await prisma.rideBooking.findMany({
            where: {
                status: BookingStatus.DRIVER_PENDING,
                driverDecisionDeadlineAt: { lt: new Date() },
            },
            select: { id: true },
        });

        for (const booking of expired) {
            await processTimedOutBooking(booking.id);
        }
    } catch (error) {
        if (isMissingColumnError(error)) {
            timeoutSweepDisabledByMissingMigration = true;
            logger.error(
                'Booking timeout sweep disabled: database migration missing (run `npx prisma migrate deploy`).',
                error
            );
            return;
        }

        logger.error('Booking timeout sweep failed', error);
    } finally {
        timeoutSweepRunning = false;
    }
};

export const startBookingTimeoutCron = () => {
    cron.schedule('* * * * *', () => {
        void runBookingTimeoutSweep();
    });
};
