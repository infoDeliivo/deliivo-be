import { BookingStatus, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { isWithinGeofence } from './geofence.utils.js';
import {
    RIDE_TRANSITIONS,
    TERMINAL_BOOKING_STATES,
    NON_TERMINAL_BOOKING_STATES,
    WAIT_TIME_MINUTES,
    GEOFENCE_RADIUS_METERS,
    LocationInput,
    RideEventInput,
    DriverArrivedInput,
    MarkNoShowInput,
    ConfirmDropoffInput,
} from './ride-operations.types.js';

// ============================================================
//  HELPERS
// ============================================================

const assertRideTransition = (currentStatus: RideStatus, targetStatus: RideStatus) => {
    const allowed = RIDE_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
        throw new Error('INVALID_RIDE_STATE_TRANSITION');
    }
};

const recordEvent = async (
    rideId: string,
    bookingId: string | null,
    eventType: string,
    actorType: string,
    actorId: string,
    input: RideEventInput
) => {
    // Idempotency: if actionId already exists, skip
    const existing = await prisma.rideEvent.findUnique({
        where: { actionId: input.actionId },
    });
    if (existing) return existing;

    return prisma.rideEvent.create({
        data: {
            rideId,
            bookingId,
            actionId: input.actionId,
            eventType,
            actorType,
            actorId,
            lat: input.lat ?? null,
            lng: input.lng ?? null,
            clientTimestamp: new Date(input.clientTimestamp),
        },
    });
};

// ============================================================
//  START RIDE
// ============================================================

export const startRide = async (driverId: string, rideId: string, input: RideEventInput) => {
    const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: { bookings: { where: { status: { in: ['CONFIRMED', 'DRIVER_PENDING'] as BookingStatus[] } } } },
    });

    if (!ride) throw new Error('RIDE_NOT_FOUND');
    if (ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');

    // Allow starting from PUBLISHED or READY_TO_START
    if (ride.status !== RideStatus.PUBLISHED && ride.status !== RideStatus.READY_TO_START) {
        assertRideTransition(ride.status, RideStatus.IN_PROGRESS);
    }

    const now = new Date();

    const updatedRide = await prisma.ride.update({
        where: { id: rideId },
        data: {
            status: RideStatus.IN_PROGRESS,
            actualStartTime: now,
            currentStopSequence: 0,
        },
    });

    // Move all CONFIRMED bookings to WAITING_FOR_PICKUP
    await prisma.rideBooking.updateMany({
        where: {
            rideId,
            status: BookingStatus.CONFIRMED,
        },
        data: {
            status: BookingStatus.WAITING_FOR_PICKUP,
        },
    });

    // Record event
    await recordEvent(rideId, null, 'RIDE_STARTED', 'DRIVER', driverId, input);

    // Notify all passengers
    const bookings = ride.bookings;
    for (const booking of bookings) {
        await createNotification({
            userId: booking.passengerId,
            type: 'ride.started',
            title: 'Ride has started',
            body: 'Your driver has started the ride. Live tracking is now active.',
            data: {
                rideId,
                bookingId: booking.id,
                deepLink: `app://ride/${rideId}/live`,
            },
        });
    }

    return {
        rideId: updatedRide.id,
        status: updatedRide.status,
        actualStartTime: updatedRide.actualStartTime,
    };
};

// ============================================================
//  DRIVER ARRIVED AT PICKUP
// ============================================================

export const driverArrived = async (driverId: string, input: DriverArrivedInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: input.bookingId },
        include: {
            ride: {
                include: { waypoints: true },
            },
        },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    if (booking.ride.status !== RideStatus.IN_PROGRESS) throw new Error('RIDE_NOT_IN_PROGRESS');

    if (booking.status !== BookingStatus.WAITING_FOR_PICKUP) {
        throw new Error('BOOKING_NOT_WAITING_FOR_PICKUP');
    }

    // Geofence validation (warning only, don't block)
    let geofenceValid = true;
    if (input.lat != null && input.lng != null) {
        // Find the pickup point coordinates
        let pickupLat: number;
        let pickupLng: number;
        if (booking.pickupWaypointId) {
            const wp = booking.ride.waypoints.find(w => w.id === booking.pickupWaypointId);
            pickupLat = wp?.lat ?? booking.ride.originLat;
            pickupLng = wp?.lng ?? booking.ride.originLng;
        } else {
            pickupLat = booking.ride.originLat;
            pickupLng = booking.ride.originLng;
        }
        geofenceValid = isWithinGeofence(input.lat, input.lng, pickupLat, pickupLng, GEOFENCE_RADIUS_METERS);
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: input.bookingId },
        data: {
            status: BookingStatus.DRIVER_ARRIVED,
            driverArrivedAt: now,
            waitTimerStartedAt: now,
        },
    });

    await recordEvent(
        booking.rideId,
        input.bookingId,
        'DRIVER_ARRIVED',
        'DRIVER',
        driverId,
        { ...input, ...(geofenceValid ? {} : { }) }
    );

    // Notify passenger
    await createNotification({
        userId: booking.passengerId,
        type: 'booking.driver_arrived',
        title: 'Driver has arrived',
        body: 'Your driver is at the pickup point. Please share your OTP.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://booking/${booking.id}/otp`,
        },
    });

    return {
        bookingId: booking.id,
        status: BookingStatus.DRIVER_ARRIVED,
        driverArrivedAt: now,
        geofenceValid,
        waitTimerStartedAt: now,
    };
};

// ============================================================
//  VERIFY PICKUP OTP (operational — extends existing flow)
// ============================================================

export const verifyPickupAndBoard = async (driverId: string, bookingId: string, otp: string, input: RideEventInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');

    if (booking.status !== BookingStatus.DRIVER_ARRIVED && booking.status !== BookingStatus.WAITING_FOR_PICKUP) {
        throw new Error('BOOKING_NOT_READY_FOR_OTP');
    }

    if (!booking.pickupOtpHash) throw new Error('PICKUP_OTP_NOT_AVAILABLE');
    if (booking.pickupOtpExpiresAt && booking.pickupOtpExpiresAt < new Date()) {
        throw new Error('PICKUP_OTP_EXPIRED');
    }
    if (booking.otpAttemptCount >= 5) throw new Error('OTP_ATTEMPT_LIMIT_EXCEEDED');

    const expectedHash = `hash-${otp}`; // Matches hashOtp() from booking-otp.utils
    const isValid = booking.pickupOtpHash === expectedHash;

    if (!isValid) {
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { otpAttemptCount: { increment: 1 } },
        });
        throw new Error('INVALID_PICKUP_OTP');
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.ONBOARD,
            pickupOtpVerifiedAt: now,
            onboardedAt: now,
        },
    });

    await recordEvent(booking.rideId, bookingId, 'PICKUP_OTP_VERIFIED', 'DRIVER', driverId, input);

    return {
        bookingId,
        status: BookingStatus.ONBOARD,
        onboardedAt: now,
    };
};

// ============================================================
//  MARK NO-SHOW
// ============================================================

export const markNoShow = async (driverId: string, input: MarkNoShowInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: input.bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');

    if (booking.status !== BookingStatus.DRIVER_ARRIVED && booking.status !== BookingStatus.WAITING_FOR_PICKUP) {
        throw new Error('BOOKING_NOT_AT_PICKUP');
    }

    // Validate wait time: driver must have waited at least WAIT_TIME_MINUTES
    if (booking.waitTimerStartedAt) {
        const waitedMs = Date.now() - booking.waitTimerStartedAt.getTime();
        const waitedMinutes = waitedMs / 60_000;
        if (waitedMinutes < WAIT_TIME_MINUTES) {
            throw new Error('WAIT_TIME_NOT_ELAPSED');
        }
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: input.bookingId },
        data: {
            status: BookingStatus.NO_SHOW,
            noShowMarkedAt: now,
        },
    });

    await recordEvent(booking.rideId, input.bookingId, 'NO_SHOW_MARKED', 'DRIVER', driverId, input);

    // Notify passenger
    await createNotification({
        userId: booking.passengerId,
        type: 'booking.no_show',
        title: 'Marked as no-show',
        body: 'The driver marked you as a no-show at the pickup point.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    return {
        bookingId: booking.id,
        status: BookingStatus.NO_SHOW,
        noShowMarkedAt: now,
    };
};

// ============================================================
//  CONFIRM DROP-OFF (driver)
// ============================================================

export const confirmDropoff = async (driverId: string, input: ConfirmDropoffInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: input.bookingId },
        include: {
            ride: { include: { waypoints: true } },
        },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');

    if (booking.status !== BookingStatus.ONBOARD && booking.status !== BookingStatus.IN_PROGRESS) {
        throw new Error('BOOKING_NOT_ONBOARD');
    }

    // Geofence check (warning only)
    let geofenceValid = true;
    if (input.lat != null && input.lng != null) {
        let dropLat: number;
        let dropLng: number;
        if (booking.dropoffWaypointId) {
            const wp = booking.ride.waypoints.find(w => w.id === booking.dropoffWaypointId);
            dropLat = wp?.lat ?? booking.ride.destinationLat;
            dropLng = wp?.lng ?? booking.ride.destinationLng;
        } else {
            dropLat = booking.ride.destinationLat;
            dropLng = booking.ride.destinationLng;
        }
        geofenceValid = isWithinGeofence(input.lat, input.lng, dropLat, dropLng, GEOFENCE_RADIUS_METERS);
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: input.bookingId },
        data: {
            status: BookingStatus.DROP_PENDING,
            dropoffConfirmedAt: now,
        },
    });

    await recordEvent(booking.rideId, input.bookingId, 'DROPOFF_CONFIRMED_DRIVER', 'DRIVER', driverId, input);

    // Notify rider to confirm
    await createNotification({
        userId: booking.passengerId,
        type: 'booking.dropoff_pending',
        title: 'Dropped off',
        body: 'The driver marked you as dropped off. Please confirm.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://booking/${booking.id}/confirm-dropoff`,
        },
    });

    return {
        bookingId: booking.id,
        status: BookingStatus.DROP_PENDING,
        dropoffConfirmedAt: now,
        geofenceValid,
    };
};

// ============================================================
//  RIDER CONFIRMS DROP-OFF
// ============================================================

export const riderConfirmDropoff = async (passengerId: string, bookingId: string, input: RideEventInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.passengerId !== passengerId) throw new Error('FORBIDDEN_PASSENGER');
    if (booking.status !== BookingStatus.DROP_PENDING) {
        throw new Error('BOOKING_NOT_DROP_PENDING');
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.COMPLETED,
            riderDropoffConfirmedAt: now,
            completedAt: now,
        },
    });

    await recordEvent(booking.rideId, bookingId, 'DROPOFF_CONFIRMED_RIDER', 'RIDER', passengerId, input);

    return {
        bookingId,
        status: BookingStatus.COMPLETED,
        completedAt: now,
    };
};

// ============================================================
//  RIDER REPORTS MISSED PICKUP
// ============================================================

export const reportMissedPickup = async (passengerId: string, bookingId: string, input: RideEventInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.passengerId !== passengerId) throw new Error('FORBIDDEN_PASSENGER');

    if (booking.status !== BookingStatus.WAITING_FOR_PICKUP && booking.status !== BookingStatus.CONFIRMED) {
        throw new Error('BOOKING_NOT_WAITING_FOR_PICKUP');
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.DRIVER_MISSED_PICKUP,
        },
    });

    await recordEvent(booking.rideId, bookingId, 'MISSED_PICKUP_REPORTED', 'RIDER', passengerId, input);

    return {
        bookingId,
        status: BookingStatus.DRIVER_MISSED_PICKUP,
    };
};

// ============================================================
//  FINISH RIDE
// ============================================================

export const finishRide = async (driverId: string, rideId: string, input: RideEventInput) => {
    const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: {
            bookings: {
                select: { id: true, status: true },
            },
        },
    });

    if (!ride) throw new Error('RIDE_NOT_FOUND');
    if (ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    if (ride.status !== RideStatus.IN_PROGRESS) throw new Error('RIDE_NOT_IN_PROGRESS');

    // Check if any bookings are still non-terminal
    const nonTerminalBookings = ride.bookings.filter(
        b => NON_TERMINAL_BOOKING_STATES.includes(b.status)
    );

    if (nonTerminalBookings.length > 0) {
        throw new Error('BOOKINGS_NOT_ALL_TERMINAL');
    }

    const now = new Date();

    const updatedRide = await prisma.ride.update({
        where: { id: rideId },
        data: {
            status: RideStatus.COMPLETED,
            actualEndTime: now,
        },
    });

    await recordEvent(rideId, null, 'RIDE_FINISHED', 'DRIVER', driverId, input);

    return {
        rideId: updatedRide.id,
        status: updatedRide.status,
        actualEndTime: updatedRide.actualEndTime,
    };
};

// ============================================================
//  LOCATION TRACKING
// ============================================================

export const submitLocation = async (driverId: string, rideId: string, input: LocationInput) => {
    const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        select: { id: true, driverId: true, status: true },
    });

    if (!ride) throw new Error('RIDE_NOT_FOUND');
    if (ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    if (ride.status !== RideStatus.IN_PROGRESS) throw new Error('RIDE_NOT_IN_PROGRESS');

    await prisma.locationUpdate.create({
        data: {
            rideId,
            driverId,
            lat: input.lat,
            lng: input.lng,
            speed: input.speed ?? null,
            heading: input.heading ?? null,
            accuracy: input.accuracy ?? null,
            timestamp: new Date(input.timestamp),
        },
    });

    return { rideId, recorded: true };
};

export const getLatestLocation = async (rideId: string) => {
    const location = await prisma.locationUpdate.findFirst({
        where: { rideId },
        orderBy: { timestamp: 'desc' },
    });

    if (!location) return null;

    return {
        rideId: location.rideId,
        lat: location.lat,
        lng: location.lng,
        speed: location.speed,
        heading: location.heading,
        accuracy: location.accuracy,
        timestamp: location.timestamp,
    };
};

// ============================================================
//  OFFLINE SYNC
// ============================================================

export const syncOfflineActions = async (
    actorId: string,
    actions: Array<{ actionId: string; eventType: string; rideId: string; bookingId?: string; lat?: number; lng?: number; clientTimestamp: string }>
) => {
    const results: Array<{ actionId: string; status: 'processed' | 'duplicate' | 'error'; error?: string }> = [];

    for (const action of actions) {
        const existing = await prisma.rideEvent.findUnique({
            where: { actionId: action.actionId },
        });

        if (existing) {
            results.push({ actionId: action.actionId, status: 'duplicate' });
            continue;
        }

        try {
            await prisma.rideEvent.create({
                data: {
                    rideId: action.rideId,
                    bookingId: action.bookingId ?? null,
                    actionId: action.actionId,
                    eventType: action.eventType,
                    actorType: 'DRIVER',
                    actorId,
                    lat: action.lat ?? null,
                    lng: action.lng ?? null,
                    clientTimestamp: new Date(action.clientTimestamp),
                },
            });
            results.push({ actionId: action.actionId, status: 'processed' });
        } catch (err: any) {
            results.push({ actionId: action.actionId, status: 'error', error: err.message });
        }
    }

    return { processed: results.filter(r => r.status === 'processed').length, duplicates: results.filter(r => r.status === 'duplicate').length, results };
};
