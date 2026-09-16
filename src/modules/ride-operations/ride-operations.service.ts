import { BookingStatus, Prisma, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import logger from '../../utils/logger.js';
import { isRideStartTooEarly } from '../../utils/ride-start-window.js';
import { sendMail } from '../mail/mail.service.js';
import { sendSms } from '../sms/sms.service.js';
import { createTrackingLink } from '../tracking/tracking.service.js';
import { isOtpValid } from '../ride-booking/booking-otp.utils.js';
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
import { haversineDistance } from './geofence.utils.js';
import {
    createForceContext,
    assertForceAllowedOnRide,
    type ForceContext,
} from './force-override.js';
import { handleForcedAction } from './force-override.effects.js';
import { emitToRide, emitToUsers } from '../../socket/index.js';
import { awardBookingCompletionRewards, awardRideCompletionRewards } from '../rewards/rewards.service.js';

// ============================================================
//  HELPERS
// ============================================================

const assertRideTransition = (currentStatus: RideStatus, targetStatus: RideStatus) => {
    const allowed = RIDE_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(targetStatus)) {
        throw new Error('INVALID_RIDE_STATE_TRANSITION');
    }
};

export const recordEvent = async (
    rideId: string,
    bookingId: string | null,
    eventType: string,
    actorType: string,
    actorId: string,
    input: RideEventInput,
    options?: {
        metadataJson?: Record<string, unknown>;
        validationStatus?: 'VALID' | 'WARNING' | 'SUSPICIOUS';
        force?: ForceContext;
    }
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
            metadataJson: {
                ...(options?.metadataJson ?? {}),
                ...(options?.force?.metadata() ?? {}),
            } as Prisma.InputJsonValue,
            // A forced step is always suspicious: it reached the admin review queue by design.
            validationStatus: options?.force?.forced ? 'SUSPICIOUS' : (options?.validationStatus ?? 'VALID'),
        },
    });
};

const buildAppUrl = (path: string) => {
    const base = process.env.APP_BASE_URL || process.env.WEB_APP_URL || 'http://localhost:3000';
    return new URL(path, base).toString();
};

const resolvePickupPoint = (booking: {
    pickupWaypointId: string | null;
    ride: {
        originLat: number;
        originLng: number;
        waypoints: Array<{ id: string; lat: number; lng: number; address: string }>;
    };
}) => {
    if (booking.pickupWaypointId) {
        const waypoint = booking.ride.waypoints.find((w) => w.id === booking.pickupWaypointId);
        if (waypoint) {
            return {
                lat: waypoint.lat,
                lng: waypoint.lng,
                address: waypoint.address,
                source: 'waypoint' as const,
            };
        }
    }

    return {
        lat: booking.ride.originLat,
        lng: booking.ride.originLng,
        address: 'Origin pickup point',
        source: 'origin' as const,
    };
};

const resolveDropoffPoint = (booking: {
    dropoffWaypointId: string | null;
    ride: {
        destinationLat: number;
        destinationLng: number;
        waypoints: Array<{ id: string; lat: number; lng: number; address: string }>;
    };
}) => {
    if (booking.dropoffWaypointId) {
        const waypoint = booking.ride.waypoints.find((w) => w.id === booking.dropoffWaypointId);
        if (waypoint) {
            return {
                lat: waypoint.lat,
                lng: waypoint.lng,
                address: waypoint.address,
                source: 'waypoint' as const,
            };
        }
    }

    return {
        lat: booking.ride.destinationLat,
        lng: booking.ride.destinationLng,
        address: 'Destination drop-off point',
        source: 'destination' as const,
    };
};

const combineDepartureDateTimeUtc = (departureDate: Date, departureTime: string): Date => {
    const [hoursRaw, minutesRaw] = departureTime.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        throw new Error('INVALID_RIDE_DEPARTURE_TIME');
    }

    return new Date(
        Date.UTC(
            departureDate.getUTCFullYear(),
            departureDate.getUTCMonth(),
            departureDate.getUTCDate(),
            hours,
            minutes,
            0,
            0
        )
    );
};

// ============================================================
//  START RIDE
// ============================================================

export const startRide = async (driverId: string, rideId: string, input: RideEventInput) => {
    const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: {
            bookings: {
                where: { status: { in: ['CONFIRMED', 'DRIVER_PENDING'] as BookingStatus[] } },
                select: {
                    id: true,
                    passengerId: true,
                    status: true,
                    rideId: true,
                    pickupWaypointId: true,
                    dropoffWaypointId: true,
                    passenger: {
                        select: {
                            id: true,
                            firstName: true,
                            email: true,
                            phone: true,
                        },
                    },
                },
            },
        },
    });

    if (!ride) throw new Error('RIDE_NOT_FOUND');
    if (ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');

    // Allow starting from PUBLISHED or READY_TO_START
    if (ride.status !== RideStatus.PUBLISHED && ride.status !== RideStatus.READY_TO_START) {
        assertRideTransition(ride.status, RideStatus.IN_PROGRESS);
    }

    const allowRideSimulation = process.env.ALLOW_RIDE_SIMULATION === 'true';
    if (!allowRideSimulation) {
        const departureAt = combineDepartureDateTimeUtc(ride.departureDate, ride.departureTime);
        if (isRideStartTooEarly(departureAt)) {
            throw new Error('RIDE_TOO_EARLY');
        }
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
    const passengerIds = bookings.map((booking) => booking.passengerId);

    const rideUpdatedPayload = {
        rideId,
        status: updatedRide.status,
        previousStatus: ride.status,
        actor: 'driver',
        action: 'ride.started',
        updatedAt: now.toISOString(),
    };

    emitToRide(rideId, 'ride:updated', rideUpdatedPayload);
    await emitToUsers([driverId, ...passengerIds], 'ride:updated', rideUpdatedPayload);

    for (const booking of bookings) {
        let trackingLink;
        try {
            trackingLink = await createTrackingLink({
                bookingId: booking.id,
                createdBy: booking.passengerId,
                allowSystemCreation: true,
                ttlHours: 24,
                accessScope: 'LOCATION_AND_ETA',
            });
        } catch (error) {
            logger.warn('Failed to create auto live tracking link on ride start', {
                rideId,
                bookingId: booking.id,
                error: error instanceof Error ? error.message : String(error),
            });
        }

        const liveTrackingUrl = trackingLink ? buildAppUrl(trackingLink.trackingUrl || `/tracking/${trackingLink.token}`) : buildAppUrl(`/rides/${rideId}?bookingId=${booking.id}`);

        if (booking.status === BookingStatus.CONFIRMED) {
            await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
                bookingId: booking.id,
                rideId,
                passengerId: booking.passengerId,
                status: BookingStatus.WAITING_FOR_PICKUP,
                previousStatus: BookingStatus.CONFIRMED,
                actor: 'driver',
                action: 'ride.started',
                updatedAt: now.toISOString(),
            });
        }

        await createNotification({
            userId: booking.passengerId,
            type: 'ride.started',
            title: 'Ride has started',
            body: 'Your driver has started the ride. Live tracking is now active.',
            data: {
                rideId,
                bookingId: booking.id,
                deepLink: `app://ride/${rideId}/live`,
                liveTrackingUrl,
                trackingToken: trackingLink?.token,
            },
        });

        const routeLabel = `${ride.originAddress.split(',')[0]} to ${ride.destinationAddress.split(',')[0]}`;
        const subject = `Live tracking started for ${routeLabel}`;
        const text = `Your driver has started the ride. Live tracking: ${liveTrackingUrl}`;
        const html = `
            <div style="font-family: Arial, sans-serif; padding: 20px">
              <h2>Ride started</h2>
              <p>Your driver has started the ride for ${routeLabel}.</p>
              <p><a href="${liveTrackingUrl}">Open live tracking</a></p>
            </div>
        `;

        if (booking.passenger?.email) {
            sendMail({ to: booking.passenger.email, subject, html, text }).catch(() => {});
        }
        if (booking.passenger?.phone) {
            sendSms(booking.passenger.phone, `Ride started. Live tracking: ${liveTrackingUrl}`).catch(() => {});
        }
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

    const force = createForceContext(input);
    assertForceAllowedOnRide(force, booking.ride.status);

    force.assertOrForce(
        booking.status !== BookingStatus.WAITING_FOR_PICKUP,
        'BOOKING_NOT_WAITING_FOR_PICKUP'
    );

    const pickupPoint = resolvePickupPoint(booking);
    const distanceMeters = input.lat != null && input.lng != null
        ? Math.round(Math.max(0, haversineDistance(input.lat, input.lng, pickupPoint.lat, pickupPoint.lng)))
        : null;
    const geofenceValid = distanceMeters == null ? true : distanceMeters <= GEOFENCE_RADIUS_METERS;
    const validationStatus = geofenceValid ? 'VALID' : 'WARNING';
    if (!geofenceValid) force.noteSkip('GEOFENCE_OUT_OF_RANGE');

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: input.bookingId },
        data: {
            status: BookingStatus.DRIVER_ARRIVED,
            driverArrivedAt: now,
            waitTimerStartedAt: now,
        },
    });

    const arrivedLocation = input.lat != null && input.lng != null
        ? await prisma.locationUpdate.create({
            data: {
                rideId: booking.rideId,
                driverId,
                lat: input.lat,
                lng: input.lng,
                timestamp: now,
            },
        })
        : null;

    if (arrivedLocation) {
        emitToRide(booking.rideId, 'ride:location', {
            rideId: booking.rideId,
            lat: arrivedLocation.lat,
            lng: arrivedLocation.lng,
            speed: arrivedLocation.speed,
            heading: arrivedLocation.heading,
            accuracy: arrivedLocation.accuracy,
            timestamp: arrivedLocation.timestamp,
            source: 'driver_arrived',
        });
    }

    await recordEvent(
        booking.rideId,
        input.bookingId,
        'DRIVER_ARRIVED',
        'DRIVER',
        driverId,
        input,
        {
            validationStatus,
            force,
            metadataJson: {
                pickupPoint,
                pickupRadiusMeters: GEOFENCE_RADIUS_METERS,
                distanceMeters,
                geofenceValid,
                actor: 'driver',
            },
        }
    );

    await handleForcedAction({
        context: force,
        action: 'DRIVER_ARRIVED',
        rideId: booking.rideId,
        bookingId: booking.id,
        passengerId: booking.passengerId,
        actorId: driverId,
    });

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

    await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
        bookingId: booking.id,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        status: BookingStatus.DRIVER_ARRIVED,
        previousStatus: BookingStatus.WAITING_FOR_PICKUP,
        actor: 'driver',
        action: 'driver.arrived',
        updatedAt: now.toISOString(),
    });

    return {
        bookingId: booking.id,
        rideId: booking.rideId,
        status: BookingStatus.DRIVER_ARRIVED,
        driverArrivedAt: now,
        geofenceValid,
        distanceMeters,
        pickupPoint,
        waitTimerStartedAt: now,
        ...force.summary(),
        location: arrivedLocation ? {
            rideId: arrivedLocation.rideId,
            lat: arrivedLocation.lat,
            lng: arrivedLocation.lng,
            timestamp: arrivedLocation.timestamp,
        } : null,
    };
};

// ============================================================
//  RIDER ARRIVED AT PICKUP
// ============================================================

export const riderArrivedAtPickup = async (passengerId: string, bookingId: string, input: RideEventInput) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            ride: {
                include: { waypoints: true },
            },
        },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.passengerId !== passengerId) throw new Error('FORBIDDEN_PASSENGER');

    if (booking.status !== BookingStatus.WAITING_FOR_PICKUP && booking.status !== BookingStatus.DRIVER_ARRIVED) {
        throw new Error('BOOKING_NOT_AT_PICKUP');
    }

    const pickupPoint = resolvePickupPoint(booking);
    const distanceMeters = input.lat != null && input.lng != null
        ? Math.round(Math.max(0, haversineDistance(input.lat, input.lng, pickupPoint.lat, pickupPoint.lng)))
        : null;
    const geofenceValid = distanceMeters == null ? true : distanceMeters <= GEOFENCE_RADIUS_METERS;

    await recordEvent(
        booking.rideId,
        bookingId,
        'RIDER_ARRIVED_AT_PICKUP',
        'RIDER',
        passengerId,
        input,
        {
            validationStatus: geofenceValid ? 'VALID' : 'WARNING',
            metadataJson: {
                pickupPoint,
                pickupRadiusMeters: GEOFENCE_RADIUS_METERS,
                distanceMeters,
                geofenceValid,
                actor: 'rider',
            },
        }
    );

    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.rider_arrived',
        title: 'Rider is at pickup',
        body: 'Your rider marked that they are at the pickup point.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });

    await emitToUsers([booking.ride.driverId, passengerId], 'booking:updated', {
        bookingId,
        rideId: booking.rideId,
        passengerId,
        status: booking.status,
        actor: 'rider',
        action: 'rider.arrived_at_pickup',
        updatedAt: new Date().toISOString(),
    });

    return {
        bookingId,
        rideId: booking.rideId,
        status: booking.status,
        geofenceValid,
        distanceMeters,
        pickupPoint,
    };
};

// ============================================================
//  VERIFY PICKUP OTP (operational — extends existing flow)
// ============================================================

export const verifyPickupAndBoard = async (
    driverId: string,
    bookingId: string,
    otp: string | undefined,
    input: RideEventInput
) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');

    const force = createForceContext(input);
    assertForceAllowedOnRide(force, booking.ride.status);

    force.assertOrForce(
        booking.status !== BookingStatus.DRIVER_ARRIVED && booking.status !== BookingStatus.WAITING_FOR_PICKUP,
        'BOOKING_NOT_READY_FOR_OTP'
    );

    force.assertOrForce(!booking.pickupOtpHash, 'PICKUP_OTP_NOT_AVAILABLE');
    force.assertOrForce(
        Boolean(booking.pickupOtpExpiresAt && booking.pickupOtpExpiresAt < new Date()),
        'PICKUP_OTP_EXPIRED'
    );
    force.assertOrForce(booking.otpAttemptCount >= 5, 'OTP_ATTEMPT_LIMIT_EXCEEDED');

    const isValid = booking.pickupOtpHash && otp ? isOtpValid(otp, booking.pickupOtpHash) : false;

    if (!isValid && !force.forced) {
        // Only a genuine failed guess burns an attempt; a forced boarding is not a guess.
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { otpAttemptCount: { increment: 1 } },
        });
        throw new Error('INVALID_PICKUP_OTP');
    }
    force.assertOrForce(!isValid, 'INVALID_PICKUP_OTP');

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.ONBOARD,
            pickupOtpVerifiedAt: now,
            onboardedAt: now,
        },
    });

    await recordEvent(booking.rideId, bookingId, 'PICKUP_OTP_VERIFIED', 'DRIVER', driverId, input, {
        validationStatus: isValid ? 'VALID' : 'WARNING',
        force,
        metadataJson: {
            otpValidated: isValid,
        },
    });

    await handleForcedAction({
        context: force,
        action: 'PICKUP_OTP_VERIFIED',
        rideId: booking.rideId,
        bookingId,
        passengerId: booking.passengerId,
        actorId: driverId,
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.pickup_verified',
        title: 'Pickup confirmed',
        body: 'Your pickup OTP was verified and you are now onboard.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
        bookingId,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        status: BookingStatus.ONBOARD,
        previousStatus: booking.status,
        actor: 'driver',
        action: 'pickup.verified',
        updatedAt: now.toISOString(),
    });

    return {
        bookingId,
        rideId: booking.rideId,
        status: BookingStatus.ONBOARD,
        onboardedAt: now,
        ...force.summary(),
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

    const force = createForceContext(input);
    assertForceAllowedOnRide(force, booking.ride.status);

    force.assertOrForce(
        booking.status !== BookingStatus.DRIVER_ARRIVED && booking.status !== BookingStatus.WAITING_FOR_PICKUP,
        'BOOKING_NOT_AT_PICKUP'
    );

    // Validate wait time: driver must have waited at least WAIT_TIME_MINUTES.
    // Local simulations can bypass this so the full lifecycle is testable from one session.
    const allowRideSimulation = process.env.ALLOW_RIDE_SIMULATION === 'true';
    if (!allowRideSimulation && booking.waitTimerStartedAt) {
        const waitedMs = Date.now() - booking.waitTimerStartedAt.getTime();
        const waitedMinutes = waitedMs / 60_000;
        force.assertOrForce(waitedMinutes < WAIT_TIME_MINUTES, 'WAIT_TIME_NOT_ELAPSED');
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: input.bookingId },
        data: {
            status: BookingStatus.NO_SHOW,
            noShowMarkedAt: now,
        },
    });

    await recordEvent(booking.rideId, input.bookingId, 'NO_SHOW_MARKED', 'DRIVER', driverId, input, { force });

    await handleForcedAction({
        context: force,
        action: 'NO_SHOW_MARKED',
        rideId: booking.rideId,
        bookingId: booking.id,
        passengerId: booking.passengerId,
        actorId: driverId,
    });

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

    await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
        bookingId: booking.id,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        status: BookingStatus.NO_SHOW,
        previousStatus: booking.status,
        actor: 'driver',
        action: 'booking.no_show',
        updatedAt: now.toISOString(),
    });

    return {
        bookingId: booking.id,
        rideId: booking.rideId,
        status: BookingStatus.NO_SHOW,
        noShowMarkedAt: now,
        ...force.summary(),
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

    const force = createForceContext(input);
    assertForceAllowedOnRide(force, booking.ride.status);

    force.assertOrForce(
        booking.status !== BookingStatus.ONBOARD && booking.status !== BookingStatus.IN_PROGRESS,
        'BOOKING_NOT_ONBOARD'
    );

    // Geofence check (warning only)
    const dropoffPoint = resolveDropoffPoint(booking);
    const distanceMeters = input.lat != null && input.lng != null
        ? Math.round(Math.max(0, haversineDistance(input.lat, input.lng, dropoffPoint.lat, dropoffPoint.lng)))
        : null;
    const geofenceValid = distanceMeters == null ? true : distanceMeters <= GEOFENCE_RADIUS_METERS;
    if (!geofenceValid) force.noteSkip('GEOFENCE_OUT_OF_RANGE');

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: input.bookingId },
        data: {
            status: BookingStatus.DROP_PENDING,
            dropoffConfirmedAt: now,
        },
    });

    const dropoffLocation = input.lat != null && input.lng != null
        ? await prisma.locationUpdate.create({
            data: {
                rideId: booking.rideId,
                driverId,
                lat: input.lat,
                lng: input.lng,
                timestamp: now,
            },
        })
        : null;

    if (dropoffLocation) {
        emitToRide(booking.rideId, 'ride:location', {
            rideId: booking.rideId,
            lat: dropoffLocation.lat,
            lng: dropoffLocation.lng,
            speed: dropoffLocation.speed,
            heading: dropoffLocation.heading,
            accuracy: dropoffLocation.accuracy,
            timestamp: dropoffLocation.timestamp,
            source: 'driver_dropoff',
        });
    }

    await recordEvent(booking.rideId, input.bookingId, 'DROPOFF_CONFIRMED_DRIVER', 'DRIVER', driverId, input, {
        validationStatus: geofenceValid ? 'VALID' : 'WARNING',
        force,
        metadataJson: {
            dropoffPoint,
            distanceMeters,
            geofenceValid,
            actor: 'driver',
        },
    });

    await handleForcedAction({
        context: force,
        action: 'DROPOFF_CONFIRMED_DRIVER',
        rideId: booking.rideId,
        bookingId: booking.id,
        passengerId: booking.passengerId,
        actorId: driverId,
    });

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

    await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
        bookingId: booking.id,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        status: BookingStatus.DROP_PENDING,
        previousStatus: booking.status,
        actor: 'driver',
        action: 'driver.confirmed_dropoff',
        updatedAt: now.toISOString(),
    });

    return {
        bookingId: booking.id,
        rideId: booking.rideId,
        status: BookingStatus.DROP_PENDING,
        dropoffConfirmedAt: now,
        geofenceValid,
        distanceMeters,
        dropoffPoint,
        ...force.summary(),
        location: dropoffLocation ? {
            rideId: dropoffLocation.rideId,
            lat: dropoffLocation.lat,
            lng: dropoffLocation.lng,
            timestamp: dropoffLocation.timestamp,
        } : null,
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

    const force = createForceContext(input);
    assertForceAllowedOnRide(force, booking.ride.status);

    force.assertOrForce(booking.status !== BookingStatus.DROP_PENDING, 'BOOKING_NOT_DROP_PENDING');

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.COMPLETED,
            riderDropoffConfirmedAt: now,
            completedAt: now,
        },
    });
    await awardBookingCompletionRewards(bookingId);

    await recordEvent(booking.rideId, bookingId, 'DROPOFF_CONFIRMED_RIDER', 'RIDER', passengerId, input, { force });

    await handleForcedAction({
        context: force,
        action: 'DROPOFF_CONFIRMED_RIDER',
        rideId: booking.rideId,
        bookingId,
        passengerId: booking.ride.driverId,
        actorId: passengerId,
    });

    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.dropoff_confirmed',
        title: 'Drop-off confirmed',
        body: 'The rider confirmed they were dropped off.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });

    await emitToUsers([booking.ride.driverId, passengerId], 'booking:updated', {
        bookingId,
        rideId: booking.rideId,
        passengerId,
        status: BookingStatus.COMPLETED,
        previousStatus: BookingStatus.DROP_PENDING,
        actor: 'rider',
        action: 'rider.confirmed_dropoff',
        updatedAt: now.toISOString(),
    });

    return {
        bookingId,
        rideId: booking.rideId,
        status: BookingStatus.COMPLETED,
        completedAt: now,
        ...force.summary(),
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
        rideId: booking.rideId,
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
                select: { id: true, status: true, passengerId: true },
            },
        },
    });

    if (!ride) throw new Error('RIDE_NOT_FOUND');
    if (ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    if (ride.status !== RideStatus.IN_PROGRESS) throw new Error('RIDE_NOT_IN_PROGRESS');

    const force = createForceContext(input);
    assertForceAllowedOnRide(force, ride.status);

    // Check if any bookings are still non-terminal
    const nonTerminalBookings = ride.bookings.filter(
        b => NON_TERMINAL_BOOKING_STATES.includes(b.status)
    );

    force.assertOrForce(nonTerminalBookings.length > 0, 'BOOKINGS_NOT_ALL_TERMINAL');

    const now = new Date();

    const updatedRide = await prisma.ride.update({
        where: { id: rideId },
        data: {
            status: RideStatus.COMPLETED,
            actualEndTime: now,
        },
    });
    await awardRideCompletionRewards(rideId);

    await recordEvent(rideId, null, 'RIDE_FINISHED', 'DRIVER', driverId, input, {
        force,
        // Forcing does not close these bookings — their refunds and payouts are
        // settled elsewhere — so name them for the admin who picks this up.
        metadataJson: nonTerminalBookings.length > 0
            ? { danglingBookings: nonTerminalBookings.map((b) => ({ bookingId: b.id, status: b.status })) }
            : {},
    });

    // Each rider left mid-flight gets warned and their booking flagged for review.
    for (const dangling of force.forced ? nonTerminalBookings : []) {
        await handleForcedAction({
            context: force,
            action: 'RIDE_FINISHED',
            rideId,
            bookingId: dangling.id,
            passengerId: dangling.passengerId,
            actorId: driverId,
        });
    }

    const rideUpdatedPayload = {
        rideId,
        status: updatedRide.status,
        previousStatus: ride.status,
        actor: 'driver',
        action: 'ride.finished',
        updatedAt: now.toISOString(),
    };

    emitToRide(rideId, 'ride:updated', rideUpdatedPayload);
    await emitToUsers([driverId], 'ride:updated', rideUpdatedPayload);

    return {
        rideId: updatedRide.id,
        status: updatedRide.status,
        actualEndTime: updatedRide.actualEndTime,
        ...force.summary(),
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

    const location = await prisma.locationUpdate.create({
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

    return {
        rideId: location.rideId,
        lat: location.lat,
        lng: location.lng,
        speed: location.speed,
        heading: location.heading,
        accuracy: location.accuracy,
        timestamp: location.timestamp,
        recorded: true,
    };
};

const assertDevSimulationEnabled = () => {
    if (process.env.ALLOW_RIDE_SIMULATION !== 'true') {
        throw new Error('DEV_SIMULATION_DISABLED');
    }
};

export const devSimulatePickup = async (driverId: string, bookingId: string, input: RideEventInput) => {
    assertDevSimulationEnabled();

    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    if (booking.ride.status !== RideStatus.IN_PROGRESS) throw new Error('RIDE_NOT_IN_PROGRESS');
    const pickupSimulationStatuses: BookingStatus[] = [BookingStatus.WAITING_FOR_PICKUP, BookingStatus.DRIVER_ARRIVED];
    if (!pickupSimulationStatuses.includes(booking.status)) {
        throw new Error('BOOKING_NOT_READY_FOR_OTP');
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.ONBOARD,
            driverArrivedAt: booking.driverArrivedAt ?? now,
            waitTimerStartedAt: booking.waitTimerStartedAt ?? now,
            pickupOtpVerifiedAt: now,
            onboardedAt: now,
        },
    });

    await recordEvent(booking.rideId, bookingId, 'DEV_PICKUP_SIMULATED', 'DRIVER', driverId, input, {
        validationStatus: 'WARNING',
        metadataJson: { simulation: true, reason: 'ALLOW_RIDE_SIMULATION' },
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.pickup_simulated',
        title: 'Pickup simulated in dev mode',
        body: 'Your pickup was simulated for local testing.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
        bookingId,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        status: BookingStatus.ONBOARD,
        previousStatus: booking.status,
        actor: 'driver',
        action: 'dev.pickup_simulated',
        updatedAt: now.toISOString(),
    });

    return { bookingId, rideId: booking.rideId, status: BookingStatus.ONBOARD, onboardedAt: now };
};

export const devSimulateDropoff = async (driverId: string, bookingId: string, input: RideEventInput) => {
    assertDevSimulationEnabled();

    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: { ride: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.ride.driverId !== driverId) throw new Error('FORBIDDEN_DRIVER');
    if (booking.ride.status !== RideStatus.IN_PROGRESS) throw new Error('RIDE_NOT_IN_PROGRESS');
    const dropoffSimulationStatuses: BookingStatus[] = [BookingStatus.ONBOARD, BookingStatus.DROP_PENDING];
    if (!dropoffSimulationStatuses.includes(booking.status)) {
        throw new Error('BOOKING_NOT_ONBOARD');
    }

    const now = new Date();

    await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            status: BookingStatus.COMPLETED,
            dropoffConfirmedAt: booking.dropoffConfirmedAt ?? now,
            riderDropoffConfirmedAt: now,
            completedAt: now,
        },
    });
    await awardBookingCompletionRewards(bookingId);

    await recordEvent(booking.rideId, bookingId, 'DEV_DROPOFF_SIMULATED', 'DRIVER', driverId, input, {
        validationStatus: 'WARNING',
        metadataJson: { simulation: true, reason: 'ALLOW_RIDE_SIMULATION' },
    });

    await createNotification({
        userId: booking.passengerId,
        type: 'booking.dropoff_simulated',
        title: 'Drop-off simulated in dev mode',
        body: 'Your drop-off was simulated for local testing.',
        data: {
            rideId: booking.rideId,
            bookingId: booking.id,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([driverId, booking.passengerId], 'booking:updated', {
        bookingId,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        status: BookingStatus.COMPLETED,
        previousStatus: booking.status,
        actor: 'driver',
        action: 'dev.dropoff_simulated',
        updatedAt: now.toISOString(),
    });

    return { bookingId, rideId: booking.rideId, status: BookingStatus.COMPLETED, completedAt: now };
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
    actions: Array<{ actionId: string; eventType: string; rideId: string; bookingId?: string; lat?: number; lng?: number; clientTimestamp: string; force?: boolean; overrideReason?: string }>
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
            const ride = await prisma.ride.findUnique({ where: { id: action.rideId }, select: { driverId: true } });
            const booking = action.bookingId
                ? await prisma.rideBooking.findUnique({ where: { id: action.bookingId }, select: { passengerId: true, rideId: true } })
                : null;
            if (!ride || (booking && booking.rideId !== action.rideId)) throw new Error('RIDE_OR_BOOKING_NOT_FOUND');
            const actorType = ride.driverId === actorId ? 'DRIVER' : booking?.passengerId === actorId ? 'RIDER' : null;
            if (!actorType) throw new Error('FORBIDDEN_ACTOR');

            if (!action.eventType.startsWith('MANUAL_')) {
                await prisma.rideEvent.create({
                    data: {
                        rideId: action.rideId,
                        bookingId: action.bookingId ?? null,
                        actionId: action.actionId,
                        eventType: action.eventType,
                        actorType,
                        actorId,
                        lat: action.lat ?? null,
                        lng: action.lng ?? null,
                        clientTimestamp: new Date(action.clientTimestamp),
                    },
                });
                results.push({ actionId: action.actionId, status: 'processed' });
                continue;
            }

            const overrideReason = action.overrideReason || 'Manual recovery requested';

            // Replaying a queued action always forces: the guards it would hit
            // describe the present, not the moment the driver actually acted.
            const eventInput: RideEventInput = {
                actionId: action.actionId,
                clientTimestamp: action.clientTimestamp,
                lat: action.lat,
                lng: action.lng,
                force: true,
                overrideReason,
            };
            let autoRepaired = false;
            let recoveryError: string | null = null;

            try {
                if (action.eventType === 'MANUAL_START_RIDE' && actorType === 'DRIVER') {
                    await startRide(actorId, action.rideId, eventInput);
                    autoRepaired = true;
                } else if (action.eventType === 'MANUAL_FINISH_RIDE' && actorType === 'DRIVER') {
                    await finishRide(actorId, action.rideId, eventInput);
                    autoRepaired = true;
                } else if (action.eventType === 'MANUAL_DRIVER_ARRIVED' && actorType === 'DRIVER' && action.bookingId) {
                    await driverArrived(actorId, { ...eventInput, bookingId: action.bookingId });
                    autoRepaired = true;
                } else if (action.eventType === 'MANUAL_PICKUP_APPROVAL' && actorType === 'DRIVER' && action.bookingId) {
                    await verifyPickupAndBoard(actorId, action.bookingId, undefined, eventInput);
                    autoRepaired = true;
                } else if (action.eventType === 'MANUAL_CONFIRM_DROPOFF' && actorType === 'DRIVER' && action.bookingId) {
                    await confirmDropoff(actorId, { ...eventInput, bookingId: action.bookingId });
                    autoRepaired = true;
                }
            } catch (error) {
                recoveryError = error instanceof Error ? error.message : String(error);
            }

            if (!autoRepaired) {
                await prisma.rideEvent.create({
                    data: {
                        rideId: action.rideId,
                        bookingId: action.bookingId ?? null,
                        actionId: action.actionId,
                        eventType: action.eventType,
                        actorType,
                        actorId,
                        lat: action.lat ?? null,
                        lng: action.lng ?? null,
                        clientTimestamp: new Date(action.clientTimestamp),
                        validationStatus: 'WARNING',
                        metadataJson: {
                            source: 'OFFLINE_MANUAL_RECOVERY',
                            overrideReason,
                            requiresReconciliation: true,
                            recoveryError,
                        },
                    },
                });
            }
            await prisma.reconciliationIssue.create({
                data: {
                    bookingId: action.bookingId ?? null,
                    issueType: 'OFFLINE_MANUAL_RECOVERY',
                    severity: autoRepaired ? 'LOW' : 'HIGH',
                    description: `${actorType} queued ${action.eventType} while the normal server path was unavailable.`,
                    internalState: autoRepaired ? 'AUTO_RECONCILED' : 'PENDING_RECONCILIATION',
                    autoRepaired,
                    repairedAt: autoRepaired ? new Date() : null,
                    resolvedAt: autoRepaired ? new Date() : null,
                    resolution: autoRepaired ? 'Queued recovery action was applied automatically.' : null,
                    metadataJson: {
                        actionId: action.actionId,
                        rideId: action.rideId,
                        bookingId: action.bookingId ?? null,
                        actorId,
                        actorType,
                        eventType: action.eventType,
                        overrideReason,
                        clientTimestamp: action.clientTimestamp,
                        recoveryError,
                    },
                },
            });
            results.push({ actionId: action.actionId, status: 'processed' });
        } catch (err: any) {
            results.push({ actionId: action.actionId, status: 'error', error: err.message });
        }
    }

    return { processed: results.filter(r => r.status === 'processed').length, duplicates: results.filter(r => r.status === 'duplicate').length, results };
};
