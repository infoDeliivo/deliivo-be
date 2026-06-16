import { BookingStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { generateBookingOtp, hashOtp, isOtpValid } from '../ride-booking/booking-otp.utils.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { isBypassBookingPaymentMode } from '../ride-booking/booking-payment-mode.js';
import { releaseSegmentSeats } from '../ride-booking/segment-capacity.utils.js';
import { emitToUsers } from '../../socket/index.js';

const PICKUP_OTP_TTL_MS = 6 * 60 * 60 * 1000;
const DROP_OTP_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const DRIVER_PENALTY_PERCENT = 50;

type SegmentInfo = {
    pickupAddress: string;
    dropoffAddress: string;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    isPartialRoute: boolean;
};

type DriverBookingResult = {
    bookingId: string;
    rideId: string;
    passengerId: string;
    status: BookingStatus;
    segment?: SegmentInfo;
};

const fetchDriverBooking = async (bookingId: string) => {
    return prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            passenger: {
                select: {
                    id: true,
                    name: true,
                    avatarUrl: true,
                },
            },
            ride: {
                include: {
                    driver: {
                        select: {
                            id: true,
                            name: true,
                            avatarUrl: true,
                            dlVerified: true,
                        },
                    },
                    waypoints: {
                        orderBy: { orderIndex: 'asc' },
                        select: {
                            id: true,
                            address: true,
                            waypointType: true,
                        },
                    },
                },
            },
        },
    });
};

const resolveBookingSegment = (booking: DriverBookingRecord): SegmentInfo => {
    const isPartial = !!(booking.pickupWaypointId || booking.dropoffWaypointId);
    const waypoints = (booking.ride as any).waypoints ?? [];

    const pickupAddress = booking.pickupWaypointId
        ? (waypoints.find((w: any) => w.id === booking.pickupWaypointId)?.address ?? booking.ride.originAddress)
        : booking.ride.originAddress;
    const dropoffAddress = booking.dropoffWaypointId
        ? (waypoints.find((w: any) => w.id === booking.dropoffWaypointId)?.address ?? booking.ride.destinationAddress)
        : booking.ride.destinationAddress;

    return {
        pickupAddress,
        dropoffAddress,
        pickupWaypointId: booking.pickupWaypointId,
        dropoffWaypointId: booking.dropoffWaypointId,
        isPartialRoute: isPartial,
    };
};

type DriverBookingRecord = NonNullable<Awaited<ReturnType<typeof fetchDriverBooking>>>;

const requireDriverBooking = (
    driverId: string,
    booking: Awaited<ReturnType<typeof fetchDriverBooking>>
): DriverBookingRecord => {
    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    return booking;
};

const assertDecisionWindowOpen = (deadlineAt: Date | null) => {
    if (!deadlineAt) return;
    if (deadlineAt.getTime() < Date.now()) {
        throw new Error('BOOKING_DECISION_DEADLINE_PASSED');
    }
};

export const acceptBooking = async (driverId: string, bookingId: string): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));

    if (!(booking.ride.driver as any).dlVerified && process.env.SKIP_DL_VERIFICATION !== 'true') {
        throw new Error('DRIVER_NOT_VERIFIED');
    }

    if (booking.status !== BookingStatus.DRIVER_PENDING) {
        throw new Error('BOOKING_NOT_DRIVER_PENDING');
    }

    assertDecisionWindowOpen(booking.driverDecisionDeadlineAt);

    const now = new Date();
    const pickupOtp = generateBookingOtp();
    const dropOtp = generateBookingOtp();

    const updated = await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.CONFIRMED,
            driverDecisionAt: now,
            pickupOtp,
            dropOtp,
            pickupOtpHash: hashOtp(pickupOtp),
            pickupOtpExpiresAt: new Date(now.getTime() + PICKUP_OTP_TTL_MS),
            dropOtpHash: hashOtp(dropOtp),
            dropOtpExpiresAt: new Date(now.getTime() + DROP_OTP_TTL_MS),
            otpAttemptCount: 0,
        },
        select: {
            id: true,
            rideId: true,
            passengerId: true,
            status: true,
        },
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.accepted',
        title: 'Ride confirmed',
        body: `${booking.ride.driver.name ?? 'Your driver'} accepted your booking`,
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            departureDate: booking.ride.departureDate.toISOString(),
            departureTime: booking.ride.departureTime,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([booking.passengerId, booking.ride.driverId], 'booking:updated', {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: updated.status,
        previousStatus: BookingStatus.DRIVER_PENDING,
        actor: 'driver',
        action: 'driver.accepted',
        updatedAt: now.toISOString(),
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: updated.status,
        segment: resolveBookingSegment(booking),
    };
};

export const rejectBooking = async (driverId: string, bookingId: string, reason: string): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));

    if (booking.status !== BookingStatus.DRIVER_PENDING) {
        throw new Error('BOOKING_NOT_DRIVER_PENDING');
    }

    assertDecisionWindowOpen(booking.driverDecisionDeadlineAt);

    const bypassPayment = isBypassBookingPaymentMode();
    const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
    let refundId: string | null = null;
    let refundInitiated = false;

    if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        const refund = await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(fullRefundAmount)
        );
        refundId = refund.id;
        refundInitiated = true;
    }
    if (bypassPayment && fullRefundAmount > 0) {
        refundInitiated = true;
    }

    const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.rideBooking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                status: true,
                rideId: true,
                passengerId: true,
                seatsBooked: true,
                pickupPosition: true,
                dropoffPosition: true,
                ride: { select: { totalSeats: true } },
            },
        });

        if (!current) throw new Error('BOOKING_NOT_FOUND');
        if (current.status !== BookingStatus.DRIVER_PENDING) {
            throw new Error('BOOKING_NOT_DRIVER_PENDING');
        }

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                driverDecisionAt: new Date(),
                cancelledAt: new Date(),
                cancelledByRole: 'DRIVER',
                cancellationReason: 'DRIVER_REJECTED',
                driverRejectionReason: reason,
                refundPercent: 100,
                refundAmount: fullRefundAmount,
                refundId: refundId ?? null,
                refundedAt: refundInitiated ? new Date() : undefined,
            },
        });

        await releaseSegmentSeats(tx as any, {
            rideId: current.rideId,
            seatsBooked: current.seatsBooked,
            pickupPosition: current.pickupPosition,
            dropoffPosition: current.dropoffPosition,
            totalSeats: (current as any).ride.totalSeats,
        });

        return current;
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.rejected',
        title: 'Booking declined',
        body: `The driver declined this ride request: ${reason}`,
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            departureDate: booking.ride.departureDate.toISOString(),
            departureTime: booking.ride.departureTime,
            rejectionReason: reason,
            refundInitiated: refundInitiated ? 'true' : 'false',
            refundPercent: '100',
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([booking.passengerId, booking.ride.driverId], 'booking:updated', {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: BookingStatus.CANCELLED,
        previousStatus: BookingStatus.DRIVER_PENDING,
        actor: 'driver',
        action: 'driver.rejected',
        updatedAt: new Date().toISOString(),
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: BookingStatus.CANCELLED,
        segment: resolveBookingSegment(booking),
    };
};

export const cancelAfterAccept = async (driverId: string, bookingId: string, reason: string): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));

    if (booking.status !== BookingStatus.CONFIRMED) {
        throw new Error('BOOKING_NOT_CONFIRMED');
    }

    const bypassPayment = isBypassBookingPaymentMode();
    const fullRefundAmount = booking.paymentAmount ?? booking.totalPrice;
    let refundId: string | null = null;
    let refundInitiated = false;

    if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        const refund = await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(fullRefundAmount)
        );
        refundId = refund.id;
        refundInitiated = true;
    }
    if (bypassPayment && fullRefundAmount > 0) {
        refundInitiated = true;
    }

    const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.rideBooking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                status: true,
                rideId: true,
                passengerId: true,
                seatsBooked: true,
                pickupPosition: true,
                dropoffPosition: true,
                ride: { select: { totalSeats: true } },
            },
        });

        if (!current) throw new Error('BOOKING_NOT_FOUND');
        if (current.status !== BookingStatus.CONFIRMED) {
            throw new Error('BOOKING_NOT_CONFIRMED');
        }

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'DRIVER',
                cancellationReason: 'DRIVER_CANCELLED_AFTER_ACCEPT',
                driverCancellationReason: reason,
                refundPercent: 100,
                refundAmount: fullRefundAmount,
                refundId: refundId ?? null,
                refundedAt: refundInitiated ? new Date() : undefined,
                driverPenaltyAppliedAt: new Date(),
                driverPenaltyValue: DRIVER_PENALTY_PERCENT,
            },
        });

        await releaseSegmentSeats(tx as any, {
            rideId: current.rideId,
            seatsBooked: current.seatsBooked,
            pickupPosition: current.pickupPosition,
            dropoffPosition: current.dropoffPosition,
            totalSeats: (current as any).ride.totalSeats,
        });

        await tx.driverPenaltyEvent.create({
            data: {
                driverId,
                bookingId: current.id,
                penaltyPercent: DRIVER_PENALTY_PERCENT,
                reason: 'DRIVER_CANCELLED_AFTER_ACCEPT',
            },
        });

        return current;
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver.cancelled',
        title: 'Ride cancelled by driver',
        body: `Your driver cancelled this ride: ${reason}. Refund has been initiated.`,
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            departureDate: booking.ride.departureDate.toISOString(),
            departureTime: booking.ride.departureTime,
            cancellationReason: reason,
            refundInitiated: refundInitiated ? 'true' : 'false',
            refundPercent: '100',
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([booking.passengerId, booking.ride.driverId], 'booking:updated', {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: BookingStatus.CANCELLED,
        previousStatus: BookingStatus.CONFIRMED,
        actor: 'driver',
        action: 'driver.cancelled',
        updatedAt: new Date().toISOString(),
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: BookingStatus.CANCELLED,
        segment: resolveBookingSegment(booking),
    };
};

const assertOtpGuard = (booking: DriverBookingRecord, expectedStatus: BookingStatus) => {
    if (booking.status !== expectedStatus) throw new Error('INVALID_BOOKING_STATUS');
};

export const verifyPickupOtp = async (
    driverId: string,
    bookingId: string,
    otp: string
): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));
    assertOtpGuard(booking, BookingStatus.CONFIRMED);

    if (!booking.pickupOtpHash || !booking.pickupOtpExpiresAt) {
        throw new Error('PICKUP_OTP_NOT_AVAILABLE');
    }
    if (booking.pickupOtpExpiresAt.getTime() < Date.now()) {
        throw new Error('PICKUP_OTP_EXPIRED');
    }
    if (booking.otpAttemptCount >= MAX_OTP_ATTEMPTS) {
        throw new Error('OTP_ATTEMPT_LIMIT_EXCEEDED');
    }

    if (!isOtpValid(otp, booking.pickupOtpHash)) {
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { otpAttemptCount: { increment: 1 } },
        });
        throw new Error('INVALID_PICKUP_OTP');
    }

    const updated = await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.IN_PROGRESS,
            pickupOtpVerifiedAt: new Date(),
            otpAttemptCount: 0,
        },
        select: {
            id: true,
            rideId: true,
            passengerId: true,
            status: true,
        },
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.trip.started',
        title: 'Trip started',
        body: 'Your trip is now in progress',
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: updated.status,
        segment: resolveBookingSegment(booking),
    };
};

export const verifyDropOtp = async (
    driverId: string,
    bookingId: string,
    otp: string
): Promise<DriverBookingResult> => {
    const booking = requireDriverBooking(driverId, await fetchDriverBooking(bookingId));
    assertOtpGuard(booking, BookingStatus.IN_PROGRESS);

    if (!booking.dropOtpHash || !booking.dropOtpExpiresAt) {
        throw new Error('DROP_OTP_NOT_AVAILABLE');
    }
    if (booking.dropOtpExpiresAt.getTime() < Date.now()) {
        throw new Error('DROP_OTP_EXPIRED');
    }
    if (booking.otpAttemptCount >= MAX_OTP_ATTEMPTS) {
        throw new Error('OTP_ATTEMPT_LIMIT_EXCEEDED');
    }

    if (!isOtpValid(otp, booking.dropOtpHash)) {
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { otpAttemptCount: { increment: 1 } },
        });
        throw new Error('INVALID_DROP_OTP');
    }

    const updated = await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.COMPLETED,
            dropOtpVerifiedAt: new Date(),
            otpAttemptCount: 0,
        },
        select: {
            id: true,
            rideId: true,
            passengerId: true,
            status: true,
        },
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.trip.completed',
        title: 'Trip completed',
        body: 'Your trip has been completed successfully',
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        passengerId: updated.passengerId,
        status: updated.status,
        segment: resolveBookingSegment(booking),
    };
};
