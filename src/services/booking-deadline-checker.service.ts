import { prisma } from '../config/index.js';
import { BookingStatus } from '@prisma/client';
import { createNotification } from '../modules/notification/notification.service.js';
import { refundPaymentIntent } from '../modules/payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../modules/ride-booking/booking-cancellation-policy.js';
import { isBypassBookingPaymentMode } from '../modules/ride-booking/booking-payment-mode.js';

const EXTENDED_DEADLINE_HOURS = 1;

export const checkExpiredDeadlines = async () => {
    const now = new Date();

    // 1. Find initial expired deadlines (not yet notified)
    const expiredBookings = await prisma.rideBooking.findMany({
        where: {
            status: BookingStatus.DRIVER_PENDING,
            driverDecisionDeadlineAt: { lte: now },
            deadlineExpiredNotifiedAt: null,
        },
        include: {
            passenger: {
                select: {
                    id: true,
                    name: true,
                },
            },
            ride: {
                select: {
                    id: true,
                    originAddress: true,
                    destinationAddress: true,
                    driverId: true,
                },
            },
        },
    });

    for (const booking of expiredBookings) {
        await handleExpiredDeadline(booking);
    }

    // 2. Find extended deadlines that expired (auto-cancel)
    const extendedExpiredBookings = await prisma.rideBooking.findMany({
        where: {
            status: BookingStatus.DRIVER_PENDING,
            driverDecisionDeadlineAt: { lte: now },
            deadlineExtendedAt: { not: null },
            autoCancelledAt: null,
        },
        include: {
            passenger: {
                select: {
                    id: true,
                    name: true,
                },
            },
            ride: {
                select: {
                    id: true,
                    driverId: true,
                },
            },
        },
    });

    for (const booking of extendedExpiredBookings) {
        await autoCancelBooking(booking);
    }

    return {
        initialExpired: expiredBookings.length,
        extendedExpired: extendedExpiredBookings.length,
        timestamp: now,
    };
};

const handleExpiredDeadline = async (booking: any) => {
    // Mark as notified
    await prisma.rideBooking.update({
        where: { id: booking.id },
        data: {
            deadlineExpiredNotifiedAt: new Date(),
        },
    });

    // Send notification to rider
    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.deadline_expired',
        title: "Driver hasn't responded yet",
        body: "The driver hasn't confirmed your booking. You can wait 1 more hour or cancel to search for a new ride.",
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            action: 'deadline_expired',
            deepLink: `app://booking/${booking.id}/deadline-expired`,
        },
    });

    console.log(`[Deadline Expired] Booking ${booking.id} - Notified rider ${booking.passengerId}`);
};

const autoCancelBooking = async (booking: any) => {
    const bypassPayment = isBypassBookingPaymentMode();
    const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
    let refundId: string | null = null;
    let refundInitiated = false;

    // Process refund
    if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        try {
            const refund = await refundPaymentIntent(
                booking.stripePaymentIntentId,
                toMinorCurrencyUnits(fullRefundAmount)
            );
            refundId = refund.id;
            refundInitiated = true;
        } catch (error) {
            console.error(`[Auto-Cancel] Failed to refund booking ${booking.id}:`, error);
        }
    }
    if (bypassPayment && fullRefundAmount > 0) {
        refundInitiated = true;
    }

    // Cancel booking and restore seats
    await prisma.$transaction(async (tx) => {
        await tx.rideBooking.update({
            where: { id: booking.id },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                autoCancelledAt: new Date(),
                cancelledByRole: 'SYSTEM',
                cancellationReason: 'DRIVER_NO_RESPONSE_EXTENDED',
                refundPercent: 100,
                refundAmount: fullRefundAmount,
                refundId: refundId ?? null,
                refundedAt: refundInitiated ? new Date() : undefined,
            },
        });

        await tx.ride.update({
            where: { id: booking.rideId },
            data: {
                availableSeats: { increment: booking.seatsBooked },
            },
        });
    });

    // Notify rider
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

    console.log(`[Auto-Cancel] Booking ${booking.id} - Extended deadline expired`);
};
