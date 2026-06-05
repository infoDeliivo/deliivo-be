import { BookingStatus, Prisma, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import {
    buildSegmentPoints,
    resolveSegmentView,
    SegmentPointRef,
    SegmentRide,
} from '../search-ride/segment-view.utils.js';
import { decodeViewToken } from '../search-ride/view-token.utils.js';
import { createBookingPaymentIntent, refundPaymentIntent } from '../payments/stripe.service.js';
import { createNotification } from '../notification/notification.service.js';
import { DRIVER_DECISION_NOTIFICATION_TYPE, DRIVER_DECISION_WINDOW_MS } from '../payments/stripe.constants.js';
import { enqueueDeadlineCheck } from '../../queue/deadline.queue.js';
import {
    CancelBookingResult,
    CreateBookingInput,
    BookingListResponse,
    BookingPaymentInfo,
    BookingResponse,
    ListBookingsQuery,
    PriceBreakdown,
    PricePreviewInput,
    PricePreviewResponse,
} from './ride-booking.types.js';
import {
    getRiderRefundAmount,
    getRiderRefundPercent,
    toMinorCurrencyUnits,
} from './booking-cancellation-policy.js';
import { isBypassBookingPaymentMode } from './booking-payment-mode.js';

type RideWaypointDetails = {
    id: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: string;
    orderIndex: number;
    pricePerSeat: number | null;
};

type RideWithDetails = {
    id: string;
    driverId: string;
    status?: RideStatus;
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    routePolyline: string | null;
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;
    departureDate: Date;
    departureTime: string;
    totalSeats: number;
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;
    driver: {
        id: string;
        name: string | null;
        avatarUrl: string | null;
    };
    vehicle?: {
        id: string;
        brand: string | null;
        model_num: string | null;
        model_name: string | null;
        type: string | null;
        color: string | null;
        year: number | null;
        imageUrl: string | null;
        isVerified: boolean;
    } | null;
    waypoints?: RideWaypointDetails[];
};

type BookingWithRideDetails = {
    id: string;
    rideId: string;
    passengerId: string;
    seatsBooked: number;
    totalPrice: number;
    status: BookingStatus;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    createdAt: Date;
    updatedAt: Date;
    stripePaymentIntentId: string | null;
    paymentCurrency: string | null;
    ride: RideWithDetails;
};

const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
];

const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
];

// Pricing configuration
const LUGGAGE_FEE_PER_ITEM = 5.00; // £5 per luggage item
const MAX_SEATS_PER_BOOKING = 4;

/* ================= PRICE CALCULATION UTILITIES ================= */
const calculateBookingPrice = (
    basePricePerSeat: number,
    seatsBooked: number,
    luggageCount: number = 0,
    currency: string = 'GBP'
): PriceBreakdown => {
    const subtotal = basePricePerSeat * seatsBooked;
    const luggageFee = luggageCount * LUGGAGE_FEE_PER_ITEM;
    const platformFeePct = parseFloat(process.env.PLATFORM_FEE_PERCENT ?? '0');
    const serviceFee = platformFeePct > 0 ? Math.round(subtotal * (platformFeePct / 100) * 100) / 100 : 0;
    const totalPrice = subtotal + luggageFee + serviceFee;

    return {
        basePricePerSeat,
        seatsBooked,
        subtotal,
        luggageFee,
        serviceFee,
        totalPrice,
        currency,
    };
};

const validateBookingSeats = (seatsBooked: number) => {
    if (seatsBooked < 1) {
        throw new Error('MINIMUM_ONE_SEAT_REQUIRED');
    }

    if (seatsBooked > MAX_SEATS_PER_BOOKING) {
        throw new Error('MAXIMUM_SEATS_EXCEEDED');
    }
};

const mapRideInfo = (ride: RideWithDetails) => ({
    id: ride.id,
    status: ride.status,
    originPlaceId: ride.originPlaceId,
    originAddress: ride.originAddress,
    originLat: ride.originLat,
    originLng: ride.originLng,
    destinationPlaceId: ride.destinationPlaceId,
    destinationAddress: ride.destinationAddress,
    destinationLat: ride.destinationLat,
    destinationLng: ride.destinationLng,
    routePolyline: ride.routePolyline,
    routeDistanceMeters: ride.routeDistanceMeters,
    routeDurationSeconds: ride.routeDurationSeconds,
    departureDate: ride.departureDate,
    departureTime: ride.departureTime,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    basePricePerSeat: ride.basePricePerSeat,
    currency: ride.currency,
    waypoints: (ride.waypoints || []).map((waypoint) => ({
        id: waypoint.id,
        placeId: waypoint.placeId,
        address: waypoint.address,
        lat: waypoint.lat,
        lng: waypoint.lng,
        waypointType: waypoint.waypointType,
        orderIndex: waypoint.orderIndex,
        pricePerSeat: waypoint.pricePerSeat,
    })),
    driver: ride.driver,
    vehicle: ride.vehicle ? {
        id: ride.vehicle.id,
        brand: ride.vehicle.brand,
        model_num: ride.vehicle.model_num,
        model_name: ride.vehicle.model_name,
        type: ride.vehicle.type,
        color: ride.vehicle.color,
        year: ride.vehicle.year,
        imageUrl: ride.vehicle.imageUrl,
        isVerified: ride.vehicle.isVerified,
    } : null,
});

const mapSegmentRideInfo = (
    ride: RideWithDetails,
    pickupWaypointId: string | null,
    dropoffWaypointId: string | null
) => {
    if (!ride.waypoints) {
        return null;
    }

    const pickupRef: SegmentPointRef = pickupWaypointId
        ? `waypoint:${pickupWaypointId}`
        : 'origin';
    const dropRef: SegmentPointRef = dropoffWaypointId
        ? `waypoint:${dropoffWaypointId}`
        : 'destination';

    const rideForSegment: SegmentRide = {
        ...ride,
        waypoints: ride.waypoints,
    };

    const points = buildSegmentPoints(rideForSegment);
    const riderView = resolveSegmentView(rideForSegment, points, pickupRef, dropRef);
    if (!riderView) {
        return null;
    }

    return {
        ...mapRideInfo(ride),
        originPlaceId: riderView.originPlaceId,
        originAddress: riderView.originAddress,
        originLat: riderView.originLat,
        originLng: riderView.originLng,
        destinationPlaceId: riderView.destinationPlaceId,
        destinationAddress: riderView.destinationAddress,
        destinationLat: riderView.destinationLat,
        destinationLng: riderView.destinationLng,
        basePricePerSeat: riderView.basePricePerSeat,
        bookingContext: riderView.bookingContext,
        segment: riderView.segment,
    };
};

const mapBookingResponse = (
    booking: BookingWithRideDetails & { 
        driverDecisionDeadlineAt?: Date | null;
        deadlineExtendedAt?: Date | null;
    },
    options?: {
        luggageCount?: number;
        notes?: string | null;
        payment?: BookingPaymentInfo | null;
        priceBreakdown?: PriceBreakdown;
    }
): BookingResponse => {
    const now = new Date();
    let decisionDeadline = null;

    // Add decision deadline info for DRIVER_PENDING bookings
    if (booking.status === BookingStatus.DRIVER_PENDING && booking.driverDecisionDeadlineAt) {
        const deadlineTime = new Date(booking.driverDecisionDeadlineAt).getTime();
        const currentTime = now.getTime();
        const timeRemainingMs = deadlineTime - currentTime;
        const isExpired = timeRemainingMs <= 0;
        
        // Calculate auto-cancel time (1 hour after initial deadline if extended, or at deadline if not extended)
        const hasBeenExtended = booking.deadlineExtendedAt !== null && booking.deadlineExtendedAt !== undefined;
        const autoCancelAt = hasBeenExtended 
            ? booking.driverDecisionDeadlineAt  // If extended, auto-cancel at the extended deadline
            : null;  // If not extended, no auto-cancel yet (rider can extend)
        
        const autoCancelTimeRemainingMs = autoCancelAt 
            ? Math.max(0, autoCancelAt.getTime() - currentTime)
            : null;
        
        decisionDeadline = {
            deadlineAt: booking.driverDecisionDeadlineAt,
            timeRemainingMs: Math.max(0, timeRemainingMs),
            timeRemainingSeconds: Math.max(0, Math.floor(timeRemainingMs / 1000)),
            isExpired,
            canExtend: isExpired && !hasBeenExtended,  // Can extend only if expired and not yet extended
            hasBeenExtended,
            autoCancelAt,
            autoCancelTimeRemainingMs,
            autoCancelTimeRemainingSeconds: autoCancelTimeRemainingMs !== null 
                ? Math.floor(autoCancelTimeRemainingMs / 1000) 
                : null,
        };
    }

    // Calculate display status for RIDER perspective
    let displayStatus: string | undefined;
    
    if (booking.status === BookingStatus.DRIVER_PENDING) {
        displayStatus = 'PENDING_DRIVER_DECISION';  // Rider is waiting for driver decision
    } else if (booking.status === BookingStatus.CONFIRMED) {
        displayStatus = 'UPCOMING';
    } else if (booking.status === BookingStatus.IN_PROGRESS) {
        displayStatus = 'ONGOING';
    } else if (booking.status === BookingStatus.COMPLETED) {
        displayStatus = 'COMPLETED';
    } else if (booking.status === BookingStatus.CANCELLED) {
        displayStatus = 'CANCELLED';
    } else if (booking.status === BookingStatus.PAYMENT_PENDING) {
        displayStatus = 'PAYMENT_PENDING';
    } else if (booking.status === BookingStatus.PAYMENT_FAILED) {
        displayStatus = 'PAYMENT_FAILED';
    }

    return {
        id: booking.id,
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        seatsBooked: booking.seatsBooked,
        luggageCount: options?.luggageCount ?? 0,
        totalPrice: booking.totalPrice,
        priceBreakdown: options?.priceBreakdown,
        status: booking.status,
        displayStatus,
        pickupWaypointId: booking.pickupWaypointId,
        dropoffWaypointId: booking.dropoffWaypointId,
        notes: options?.notes ?? null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        decisionDeadline,
        payment: options?.payment
            ?? (booking.stripePaymentIntentId
                ? {
                    provider: 'stripe',
                    paymentIntentId: booking.stripePaymentIntentId,
                    currency: booking.paymentCurrency ?? booking.ride.currency,
                }
                : null),
        ride: mapRideInfo(booking.ride),
        fullRide: mapRideInfo(booking.ride),
        segmentRide: mapSegmentRideInfo(
            booking.ride,
            booking.pickupWaypointId,
            booking.dropoffWaypointId
        ),
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

const resolveSegmentAddress = (
    defaultAddress: string,
    waypointId: string | null,
    waypoints: Array<{ id: string; address: string }>
): string => {
    if (!waypointId) return defaultAddress;
    return waypoints.find((waypoint) => waypoint.id === waypointId)?.address ?? defaultAddress;
};

/* ================= CREATE BOOKING ================= */
export const createBooking = async (
    passengerId: string,
    input: CreateBookingInput
): Promise<BookingResponse> => {
    // Guard: passenger must have accepted ToS and must not be banned
    const passenger = await prisma.user.findUnique({
        where: { id: passengerId },
        select: { tosAcceptedAt: true, isBanned: true },
    });

    if (!passenger?.tosAcceptedAt) {
        throw new Error('TOS_NOT_ACCEPTED');
    }

    if (passenger.isBanned) {
        throw new Error('USER_BANNED');
    }

    const bypassBookingPaymentMode = isBypassBookingPaymentMode();
    const now = new Date();
    const paymentCapturedAt = bypassBookingPaymentMode ? now : null;
    const driverDecisionDeadlineAt = bypassBookingPaymentMode
        ? new Date(now.getTime() + DRIVER_DECISION_WINDOW_MS)
        : null;
    const {
        rideId,
        segmentId,
        seatsBooked,
        luggageCount = 0,
        pickupWaypointId,
        dropoffWaypointId,
        notes,
    } = input;

    const bookingSeed = await prisma.$transaction(async (tx) => {
        const ride = await tx.ride.findFirst({
            where: {
                id: rideId,
                status: RideStatus.PUBLISHED,
            },
            include: {
                driver: {
                    select: {
                        id: true,
                        name: true,
                        avatarUrl: true,
                        stripeAccountId: true,
                        stripeOnboardingComplete: true,
                    },
                },
                waypoints: {
                    orderBy: { orderIndex: 'asc' },
                },
            },
        });

        if (!ride) {
            throw new Error('RIDE_NOT_FOUND');
        }

        if (ride.driverId === passengerId) {
            throw new Error('CANNOT_BOOK_OWN_RIDE');
        }

        // Check if either party has blocked the other
        const block = await tx.userBlock.findFirst({
            where: {
                OR: [
                    { blockerId: passengerId, blockedId: ride.driverId },
                    { blockerId: ride.driverId, blockedId: passengerId },
                ],
            },
        });
        if (block) {
            throw new Error('USER_BLOCKED');
        }

        // Validate seat count (min/max)
        validateBookingSeats(seatsBooked);

        const existingBooking = await tx.rideBooking.findFirst({
            where: {
                rideId,
                passengerId,
                status: { in: ACTIVE_BOOKING_STATUSES },
            },
        });

        if (existingBooking) {
            throw new Error('BOOKING_ALREADY_EXISTS');
        }

        const passenger = await tx.user.findUnique({
            where: { id: passengerId },
            select: {
                name: true,
                avatarUrl: true,
                salutation: true,
            },
        });

        if (ride.femaleOnly) {
            const allowed = ['MS', 'MRS', 'MX'];
            if (!passenger?.salutation || !allowed.includes(passenger.salutation)) {
                throw new Error('FEMALE_ONLY_RIDE');
            }
        }

        let pickupRef: SegmentPointRef;
        let dropRef: SegmentPointRef;

        if (segmentId) {
            try {
                const payload = decodeViewToken(segmentId);
                if (payload.rideId !== rideId) {
                    throw new Error('INVALID_BOOKING_SEGMENT');
                }

                pickupRef = payload.pickupRef;
                dropRef = payload.dropRef;
            } catch {
                throw new Error('INVALID_BOOKING_SEGMENT');
            }
        } else {
            pickupRef = pickupWaypointId
                ? `waypoint:${pickupWaypointId}`
                : 'origin';
            dropRef = dropoffWaypointId
                ? `waypoint:${dropoffWaypointId}`
                : 'destination';
        }

        const points = buildSegmentPoints(ride);
        const riderView = resolveSegmentView(ride, points, pickupRef, dropRef);
        if (!riderView) {
            throw new Error('INVALID_BOOKING_SEGMENT');
        }

        const resolvedPickupWaypointId = riderView.bookingContext.pickupWaypointId;
        const resolvedDropoffWaypointId = riderView.bookingContext.dropoffWaypointId;
        
        // Calculate price with breakdown
        const priceBreakdown = calculateBookingPrice(
            riderView.basePricePerSeat,
            seatsBooked,
            luggageCount,
            ride.currency
        );

        const booking = await tx.rideBooking.create({
            data: {
                rideId,
                passengerId,
                seatsBooked,
                totalPrice: priceBreakdown.totalPrice,
                pickupWaypointId: resolvedPickupWaypointId,
                dropoffWaypointId: resolvedDropoffWaypointId,
                status: bypassBookingPaymentMode
                    ? BookingStatus.DRIVER_PENDING
                    : BookingStatus.PAYMENT_PENDING,
                paymentAmount: bypassBookingPaymentMode ? priceBreakdown.totalPrice : undefined,
                paymentCurrency: ride.currency,
                paymentCapturedAt: paymentCapturedAt ?? undefined,
                driverDecisionDeadlineAt: driverDecisionDeadlineAt ?? undefined,
            },
            include: {
                ride: {
                    include: {
                        driver: {
                            select: {
                                id: true,
                                name: true,
                                avatarUrl: true,
                            },
                        },
                        waypoints: {
                            orderBy: { orderIndex: 'asc' },
                        },
                    },
                },
            },
        });

        const seatUpdate = await tx.ride.updateMany({
            where: {
                id: rideId,
                availableSeats: { gte: seatsBooked },
                status: RideStatus.PUBLISHED,
            },
            data: {
                availableSeats: { decrement: seatsBooked },
            },
        });

        if (seatUpdate.count === 0) {
            throw new Error('INSUFFICIENT_SEATS');
        }

        return {
            booking,
            ride,
            priceBreakdown,
            resolvedPickupWaypointId,
            resolvedDropoffWaypointId,
            passenger,
        };
    });

    if (bypassBookingPaymentMode) {
        const passengerName = bookingSeed.passenger?.name ?? 'Rider';
        const originAddress = resolveSegmentAddress(
            bookingSeed.ride.originAddress,
            bookingSeed.resolvedPickupWaypointId,
            bookingSeed.ride.waypoints ?? []
        );
        const destinationAddress = resolveSegmentAddress(
            bookingSeed.ride.destinationAddress,
            bookingSeed.resolvedDropoffWaypointId,
            bookingSeed.ride.waypoints ?? []
        );

        await createNotification({
            userId: bookingSeed.ride.driverId,
            type: DRIVER_DECISION_NOTIFICATION_TYPE,
            title: 'New ride request',
            body: `${passengerName} wants ${originAddress} to ${destinationAddress}`,
            data: {
                bookingId: bookingSeed.booking.id,
                rideId: bookingSeed.booking.rideId,
                passengerName,
                passengerAvatarUrl: bookingSeed.passenger?.avatarUrl ?? '',
                originAddress,
                destinationAddress,
                seatsBooked: String(bookingSeed.booking.seatsBooked),
                totalPrice: String(bookingSeed.booking.totalPrice),
                currency: bookingSeed.booking.paymentCurrency ?? bookingSeed.ride.currency,
                decisionDeadlineAt: driverDecisionDeadlineAt?.toISOString() ?? '',
                decisionTimeRemainingSeconds: driverDecisionDeadlineAt
                    ? String(Math.max(0, Math.floor((driverDecisionDeadlineAt.getTime() - Date.now()) / 1000)))
                    : '0',
                deepLink: `app://driver/booking-request/${bookingSeed.booking.id}`,
            },
        });

        // Enqueue deadline check — replaces the cron job (BullMQ fires once per booking)
        await enqueueDeadlineCheck(bookingSeed.booking.id, DRIVER_DECISION_WINDOW_MS);

        return mapBookingResponse(bookingSeed.booking as unknown as BookingWithRideDetails, {
            luggageCount,
            notes: notes ?? null,
            priceBreakdown: bookingSeed.priceBreakdown,
        });
    }

    let paymentIntent: Awaited<ReturnType<typeof createBookingPaymentIntent>>;
    try {
        const driverStripeAccountId =
            (bookingSeed.ride.driver as any).stripeOnboardingComplete
                ? (bookingSeed.ride.driver as any).stripeAccountId ?? null
                : null;

        paymentIntent = await createBookingPaymentIntent({
            bookingId: bookingSeed.booking.id,
            rideId: bookingSeed.booking.rideId,
            passengerId,
            amountMajor: bookingSeed.priceBreakdown.totalPrice,
            currency: bookingSeed.ride.currency,
            driverStripeAccountId,
        });
    } catch {
        await prisma.$transaction(async (tx) => {
            const existing = await tx.rideBooking.findUnique({
                where: { id: bookingSeed.booking.id },
                select: {
                    id: true,
                    status: true,
                    rideId: true,
                    seatsBooked: true,
                },
            });

            if (!existing || existing.status !== BookingStatus.PAYMENT_PENDING) {
                return;
            }

            await tx.rideBooking.update({
                where: { id: bookingSeed.booking.id },
                data: { status: BookingStatus.PAYMENT_FAILED },
            });

            await tx.ride.update({
                where: { id: existing.rideId },
                data: {
                    availableSeats: { increment: existing.seatsBooked },
                },
            });
        });

        throw new Error('PAYMENT_INITIALIZATION_FAILED');
    }

    const booking = await prisma.rideBooking.update({
        where: { id: bookingSeed.booking.id },
        data: {
            stripePaymentIntentId: paymentIntent.paymentIntentId,
            paymentAmount: bookingSeed.priceBreakdown.totalPrice,
            paymentCurrency: paymentIntent.currency,
        },
        include: {
            ride: {
                include: {
                    driver: {
                        select: {
                            id: true,
                            name: true,
                            avatarUrl: true,
                        },
                    },
                    waypoints: {
                        orderBy: { orderIndex: 'asc' },
                    },
                },
            },
        },
    });

    return mapBookingResponse(booking as unknown as BookingWithRideDetails, {
        luggageCount,
        notes: notes ?? null,
        priceBreakdown: bookingSeed.priceBreakdown,
        payment: {
            provider: 'stripe',
            paymentIntentId: paymentIntent.paymentIntentId,
            clientSecret: paymentIntent.clientSecret,
            currency: paymentIntent.currency,
        },
    });
};

/* ================= EXTEND WAIT FOR DRIVER ================= */
const EXTENDED_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

export const extendWaitForDriver = async (
    passengerId: string,
    bookingId: string
) => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: BookingStatus.DRIVER_PENDING,
        },
        include: {
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    originAddress: true,
                    destinationAddress: true,
                },
            },
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    if (booking.status !== BookingStatus.DRIVER_PENDING) {
        throw new Error('BOOKING_NOT_DRIVER_PENDING');
    }

    // Check if deadline has expired
    if (!booking.driverDecisionDeadlineAt || booking.driverDecisionDeadlineAt > new Date()) {
        throw new Error('DEADLINE_NOT_EXPIRED');
    }

    // Check if already extended
    if (booking.deadlineExtendedAt) {
        throw new Error('ALREADY_EXTENDED');
    }

    const newDeadline = new Date(Date.now() + EXTENDED_DEADLINE_MS);

    const updated = await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            driverDecisionDeadlineAt: newDeadline,
            deadlineExtendedAt: new Date(),
        },
        select: {
            id: true,
            driverDecisionDeadlineAt: true,
            status: true,
        },
    });

    // Notify driver again
    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.rider.extended_wait',
        title: 'Rider is still waiting',
        body: 'The rider extended the waiting period. Please respond within 1 hour.',
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            newDeadline: newDeadline.toISOString(),
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });

    return {
        bookingId: updated.id,
        status: updated.status,
        newDeadline: updated.driverDecisionDeadlineAt,
        extendedBy: 'rider',
    };
};

/* ================= RIDER CANCEL BOOKING ================= */
export const cancelBooking = async (
    passengerId: string,
    bookingId: string
): Promise<CancelBookingResult> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: { in: CANCELLABLE_BOOKING_STATUSES },
        },
        include: {
            ride: {
                select: {
                    id: true,
                    departureDate: true,
                    departureTime: true,
                },
            },
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    const departureAt = combineDepartureDateTimeUtc(
        booking.ride.departureDate,
        booking.ride.departureTime
    );

    // Check if deadline expired (driver didn't respond)
    const isDeadlineExpired = booking.driverDecisionDeadlineAt 
        && booking.driverDecisionDeadlineAt < new Date()
        && booking.status === BookingStatus.DRIVER_PENDING;

    const isPaymentCaptured = Boolean(booking.paymentCapturedAt && booking.stripePaymentIntentId);
    
    // If deadline expired, give 100% refund regardless of time
    const refundPercent = isDeadlineExpired 
        ? 100 
        : (isPaymentCaptured ? getRiderRefundPercent(departureAt, new Date()) : 0);
    
    const refundAmount = isPaymentCaptured
        ? getRiderRefundAmount(booking.paymentAmount ?? booking.totalPrice, refundPercent)
        : 0;

    const cancellationReason = isDeadlineExpired
        ? 'DRIVER_NO_RESPONSE'
        : 'PASSENGER_CANCELLED';

    let refundInitiated = false;

    const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.rideBooking.findFirst({
            where: {
                id: bookingId,
                passengerId,
                status: { in: CANCELLABLE_BOOKING_STATUSES },
            },
            select: {
                id: true,
                rideId: true,
                seatsBooked: true,
            },
        });

        if (!current) {
            throw new Error('BOOKING_NOT_CANCELLABLE');
        }

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'PASSENGER',
                cancellationReason,
                refundPercent,
                refundAmount,
            },
        });

        await tx.ride.update({
            where: { id: current.rideId },
            data: {
                availableSeats: { increment: current.seatsBooked },
            },
        });

        // Issue refund last — DB writes above must succeed before we charge Stripe
        if (isPaymentCaptured && refundAmount > 0 && booking.stripePaymentIntentId) {
            await refundPaymentIntent(
                booking.stripePaymentIntentId,
                toMinorCurrencyUnits(refundAmount)
            );
            refundInitiated = true;
            await tx.rideBooking.update({
                where: { id: bookingId },
                data: { refundedAt: new Date() },
            });
        }

        return current;
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        refundPercent,
        refundAmount,
        refundInitiated,
    };
};

/* ================= GET BOOKING BY ID ================= */
export const getBookingById = async (
    passengerId: string,
    bookingId: string
): Promise<BookingResponse | null> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
        },
        include: {
            ride: {
                include: {
                    driver: {
                        select: {
                            id: true,
                            name: true,
                            avatarUrl: true,
                        },
                    },
                    vehicle: {
                        select: {
                            id: true,
                            brand: true,
                            model_num: true,
                            model_name: true,
                            type: true,
                            color: true,
                            year: true,
                            imageUrl: true,
                            isVerified: true,
                        },
                    },
                    waypoints: {
                        orderBy: { orderIndex: 'asc' },
                    },
                },
            },
        },
    });

    if (!booking) return null;

    const response = mapBookingResponse(booking as unknown as BookingWithRideDetails);

    return {
        ...response,
        pickupOtp: (booking as any).pickupOtp ?? null,
        dropOtp: (booking as any).dropOtp ?? null,
        pickupOtpVerifiedAt: booking.pickupOtpVerifiedAt,
        dropOtpVerifiedAt: booking.dropOtpVerifiedAt,
    };
};

export const getBookingPaymentStatus = async (
    passengerId: string,
    bookingId: string
): Promise<BookingResponse | null> => {
    return getBookingById(passengerId, bookingId);
};

/* ================= LIST USER BOOKINGS ================= */
export const listUserBookings = async (
    passengerId: string,
    query: ListBookingsQuery
): Promise<BookingListResponse> => {
    const { status, page = 1, limit = 10 } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.RideBookingWhereInput = {
        passengerId,
        ...(status ? { status } : {}),
    };

    const [bookings, total] = await Promise.all([
        prisma.rideBooking.findMany({
            where,
            include: {
                ride: {
                    include: {
                        driver: {
                            select: {
                                id: true,
                                name: true,
                                avatarUrl: true,
                            },
                        },
                        vehicle: {
                            select: {
                                id: true,
                                brand: true,
                                model_num: true,
                                model_name: true,
                                type: true,
                                color: true,
                                year: true,
                                imageUrl: true,
                                isVerified: true,
                            },
                        },
                        waypoints: {
                            orderBy: { orderIndex: 'asc' },
                        },
                    },
                },
            },
            orderBy: [
                { ride: { departureDate: 'asc' } },  // Sort by departure date first (upcoming rides first)
                { createdAt: 'desc' },  // Then by creation date
            ],
            skip,
            take: limit,
        }),
        prisma.rideBooking.count({ where }),
    ]);

    return {
        bookings: bookings.map((booking) =>
            mapBookingResponse(booking as unknown as BookingWithRideDetails)
        ),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/* ================= PRICE PREVIEW ================= */
export const getBookingPricePreview = async (
    passengerId: string,
    input: PricePreviewInput
): Promise<PricePreviewResponse> => {
    const {
        rideId,
        segmentId,
        seatsBooked,
        luggageCount = 0,
        pickupWaypointId,
        dropoffWaypointId,
    } = input;

    const ride = await prisma.ride.findFirst({
        where: {
            id: rideId,
            status: RideStatus.PUBLISHED,
        },
        include: {
            waypoints: {
                orderBy: { orderIndex: 'asc' },
            },
        },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
    }

    if (ride.driverId === passengerId) {
        throw new Error('CANNOT_BOOK_OWN_RIDE');
    }

    // Validate seat count (min/max) and availability
    validateBookingSeats(seatsBooked);
    if (seatsBooked > ride.availableSeats) {
        throw new Error('INSUFFICIENT_SEATS');
    }

    let pickupRef: SegmentPointRef;
    let dropRef: SegmentPointRef;
    let segmentRide: { originAddress: string; destinationAddress: string; basePricePerSeat: number } | null = null;

    if (segmentId) {
        try {
            const payload = decodeViewToken(segmentId);
            if (payload.rideId !== rideId) {
                throw new Error('INVALID_BOOKING_SEGMENT');
            }

            pickupRef = payload.pickupRef;
            dropRef = payload.dropRef;
        } catch {
            throw new Error('INVALID_BOOKING_SEGMENT');
        }
    } else {
        pickupRef = pickupWaypointId
            ? `waypoint:${pickupWaypointId}`
            : 'origin';
        dropRef = dropoffWaypointId
            ? `waypoint:${dropoffWaypointId}`
            : 'destination';
    }

    const points = buildSegmentPoints(ride);
    const riderView = resolveSegmentView(ride, points, pickupRef, dropRef);
    if (!riderView) {
        throw new Error('INVALID_BOOKING_SEGMENT');
    }

    // Calculate price breakdown
    const priceBreakdown = calculateBookingPrice(
        riderView.basePricePerSeat,
        seatsBooked,
        luggageCount,
        ride.currency
    );

    // If it's a segment booking, provide segment details
    if (riderView.basePricePerSeat !== ride.basePricePerSeat) {
        segmentRide = {
            originAddress: riderView.originAddress,
            destinationAddress: riderView.destinationAddress,
            basePricePerSeat: riderView.basePricePerSeat,
        };
    }

    return {
        priceBreakdown,
        ride: {
            id: ride.id,
            originAddress: ride.originAddress,
            destinationAddress: ride.destinationAddress,
            basePricePerSeat: ride.basePricePerSeat,
            currency: ride.currency,
            availableSeats: ride.availableSeats,
        },
        segmentRide,
    };
};
