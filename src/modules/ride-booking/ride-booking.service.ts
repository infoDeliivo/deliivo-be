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
import {
    CancelBookingResult,
    CreateBookingInput,
    BookingListResponse,
    BookingPaymentInfo,
    BookingResponse,
    ListBookingsQuery,
} from './ride-booking.types.js';
import {
    getRiderRefundAmount,
    getRiderRefundPercent,
    toMinorCurrencyUnits,
} from './booking-cancellation-policy.js';

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

const mapRideInfo = (ride: RideWithDetails) => ({
    id: ride.id,
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
    booking: BookingWithRideDetails,
    options?: {
        luggageCount?: number;
        notes?: string | null;
        payment?: BookingPaymentInfo | null;
    }
): BookingResponse => ({
    id: booking.id,
    rideId: booking.rideId,
    passengerId: booking.passengerId,
    seatsBooked: booking.seatsBooked,
    luggageCount: options?.luggageCount ?? 0,
    totalPrice: booking.totalPrice,
    status: booking.status,
    pickupWaypointId: booking.pickupWaypointId,
    dropoffWaypointId: booking.dropoffWaypointId,
    notes: options?.notes ?? null,
    createdAt: booking.createdAt,
    updatedAt: booking.updatedAt,
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
});

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

/* ================= CREATE BOOKING ================= */
export const createBooking = async (
    passengerId: string,
    input: CreateBookingInput
): Promise<BookingResponse> => {
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

        if (ride.availableSeats < seatsBooked) {
            throw new Error('INSUFFICIENT_SEATS');
        }

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
        const totalPrice = riderView.basePricePerSeat * seatsBooked;

        const booking = await tx.rideBooking.create({
            data: {
                rideId,
                passengerId,
                seatsBooked,
                totalPrice,
                pickupWaypointId: resolvedPickupWaypointId,
                dropoffWaypointId: resolvedDropoffWaypointId,
                status: BookingStatus.PAYMENT_PENDING,
                paymentCurrency: ride.currency,
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

        await tx.ride.update({
            where: { id: rideId },
            data: {
                availableSeats: { decrement: seatsBooked },
            },
        });

        return {
            booking,
            ride,
            totalPrice,
            resolvedPickupWaypointId,
            resolvedDropoffWaypointId,
        };
    });

    let paymentIntent: Awaited<ReturnType<typeof createBookingPaymentIntent>>;
    try {
        paymentIntent = await createBookingPaymentIntent({
            bookingId: bookingSeed.booking.id,
            rideId: bookingSeed.booking.rideId,
            passengerId,
            amountMajor: bookingSeed.totalPrice,
            currency: bookingSeed.ride.currency,
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
            paymentAmount: bookingSeed.totalPrice,
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
        payment: {
            provider: 'stripe',
            paymentIntentId: paymentIntent.paymentIntentId,
            clientSecret: paymentIntent.clientSecret,
            currency: paymentIntent.currency,
        },
    });
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

    const isPaymentCaptured = Boolean(booking.paymentCapturedAt && booking.stripePaymentIntentId);
    const refundPercent = isPaymentCaptured
        ? getRiderRefundPercent(departureAt, new Date())
        : 0;
    const refundAmount = isPaymentCaptured
        ? getRiderRefundAmount(booking.paymentAmount ?? booking.totalPrice, refundPercent)
        : 0;

    let refundInitiated = false;
    if (isPaymentCaptured && refundAmount > 0 && booking.stripePaymentIntentId) {
        await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(refundAmount)
        );
        refundInitiated = true;
    }

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
                cancellationReason: 'PASSENGER_CANCELLED',
                refundPercent,
                refundAmount,
                refundedAt: refundInitiated ? new Date() : undefined,
            },
        });

        await tx.ride.update({
            where: { id: current.rideId },
            data: {
                availableSeats: { increment: current.seatsBooked },
            },
        });

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
                    waypoints: {
                        orderBy: { orderIndex: 'asc' },
                    },
                },
            },
        },
    });

    if (!booking) return null;

    return mapBookingResponse(booking as unknown as BookingWithRideDetails);
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
                        waypoints: {
                            orderBy: { orderIndex: 'asc' },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
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
