import { prisma } from '../../config/index.js';
import { BookingStatus, RideStatus } from '@prisma/client';
import { ListRidesQuery } from './publish-ride.types.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { isBypassBookingPaymentMode } from '../ride-booking/booking-payment-mode.js';
import { createNotification } from '../notification/notification.service.js';

/* ============================================================
   PUBLISHED RIDE OPERATIONS — DB ONLY
   Draft operations have moved to draft-ride.service.ts (Redis)
   ============================================================ */

/* ================= GET USER RIDES ================= */
export const getUserRides = async (driverId: string, query: ListRidesQuery) => {
    const { status } = query;
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const where = {
        driverId,
        ...(status && { status }),
    };

    const [rides, total] = await Promise.all([
        prisma.ride.findMany({
            where,
            include: { 
                waypoints: { orderBy: { orderIndex: 'asc' } },
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
                bookings: {
                    where: {
                        status: {
                            in: [
                                'PAYMENT_PENDING',
                                'DRIVER_PENDING',
                                'CONFIRMED',
                                'IN_PROGRESS',
                                'COMPLETED',
                            ],
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    include: {
                        passenger: {
                            select: {
                                id: true,
                                name: true,
                                nickName: true,
                                phone: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
            skip,
            take: limit,
        }),
        prisma.ride.count({ where }),
    ]);

    // Enhance bookings with decision deadline info and stopover times
    const now = new Date();
    const enhancedRides = rides.map((ride: any) => {
        const enhancedBookings = ride.bookings.map((booking: any) => {
            const enhanced: any = { ...booking };

            // Add decision deadline info for DRIVER_PENDING bookings
            if (booking.status === 'DRIVER_PENDING' && booking.driverDecisionDeadlineAt) {
                const deadlineTime = new Date(booking.driverDecisionDeadlineAt).getTime();
                const currentTime = now.getTime();
                const timeRemainingMs = deadlineTime - currentTime;
                
                enhanced.decisionDeadline = {
                    deadlineAt: booking.driverDecisionDeadlineAt,
                    timeRemainingMs: Math.max(0, timeRemainingMs),
                    timeRemainingSeconds: Math.max(0, Math.floor(timeRemainingMs / 1000)),
                    isExpired: timeRemainingMs <= 0,
                };
            }

            // Add pickup/dropoff location info with arrival times
            if (booking.pickupWaypointId || booking.dropoffWaypointId) {
                const pickupWaypoint = ride.waypoints.find((w: any) => w.id === booking.pickupWaypointId);
                const dropoffWaypoint = ride.waypoints.find((w: any) => w.id === booking.dropoffWaypointId);

                enhanced.pickupLocation = pickupWaypoint ? {
                    address: pickupWaypoint.address,
                    placeId: pickupWaypoint.placeId,
                    estimatedArrivalTime: (pickupWaypoint as any).estimatedArrivalTime,
                } : {
                    address: ride.originAddress,
                    placeId: ride.originPlaceId,
                    estimatedArrivalTime: ride.departureTime,
                };

                enhanced.dropoffLocation = dropoffWaypoint ? {
                    address: dropoffWaypoint.address,
                    placeId: dropoffWaypoint.placeId,
                    estimatedArrivalTime: (dropoffWaypoint as any).estimatedArrivalTime,
                } : {
                    address: ride.destinationAddress,
                    placeId: ride.destinationPlaceId,
                    estimatedArrivalTime: ride.waypoints.find((w: any) => w.waypointType === 'DROPOFF')?.estimatedArrivalTime || null,
                };
            } else {
                enhanced.pickupLocation = {
                    address: ride.originAddress,
                    placeId: ride.originPlaceId,
                    estimatedArrivalTime: ride.departureTime,
                };
                enhanced.dropoffLocation = {
                    address: ride.destinationAddress,
                    placeId: ride.destinationPlaceId,
                    estimatedArrivalTime: ride.waypoints.find((w: any) => w.waypointType === 'DROPOFF')?.estimatedArrivalTime || null,
                };
            }

            return enhanced;
        });

        return {
            ...ride,
            bookings: enhancedBookings,
        };
    });

    return {
        rides: enhancedRides,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/* ================= GET RIDE BY ID ================= */
export const getRideById = async (driverId: string, rideId: string) => {
    const ride = await prisma.ride.findFirst({
        where: { id: rideId, driverId },
        include: { 
            waypoints: { orderBy: { orderIndex: 'asc' } },
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
            bookings: {
                where: {
                    status: {
                        in: [
                            'PAYMENT_PENDING',
                            'DRIVER_PENDING',
                            'CONFIRMED',
                            'IN_PROGRESS',
                            'COMPLETED',
                        ],
                    },
                },
                orderBy: { createdAt: 'desc' },
                include: {
                    passenger: {
                        select: {
                            id: true,
                            name: true,
                            nickName: true,
                            phone: true,
                            avatarUrl: true,
                        },
                    },
                },
            },
        },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
    }

    // Enhance bookings with decision deadline info and stopover times
    const now = new Date();
    const enhancedBookings = ride.bookings.map((booking: any) => {
        const enhanced: any = { ...booking };

        // Add decision deadline info for DRIVER_PENDING bookings
        if (booking.status === 'DRIVER_PENDING' && booking.driverDecisionDeadlineAt) {
            const deadlineTime = new Date(booking.driverDecisionDeadlineAt).getTime();
            const currentTime = now.getTime();
            const timeRemainingMs = deadlineTime - currentTime;
            
            enhanced.decisionDeadline = {
                deadlineAt: booking.driverDecisionDeadlineAt,
                timeRemainingMs: Math.max(0, timeRemainingMs),
                timeRemainingSeconds: Math.max(0, Math.floor(timeRemainingMs / 1000)),
                isExpired: timeRemainingMs <= 0,
            };
        }

        // Add pickup/dropoff location info with arrival times
        if (booking.pickupWaypointId || booking.dropoffWaypointId) {
            const pickupWaypoint = ride.waypoints.find((w: any) => w.id === booking.pickupWaypointId);
            const dropoffWaypoint = ride.waypoints.find((w: any) => w.id === booking.dropoffWaypointId);

            enhanced.pickupLocation = pickupWaypoint ? {
                address: pickupWaypoint.address,
                placeId: pickupWaypoint.placeId,
                estimatedArrivalTime: (pickupWaypoint as any).estimatedArrivalTime,
            } : {
                address: ride.originAddress,
                placeId: ride.originPlaceId,
                estimatedArrivalTime: ride.departureTime,
            };

            enhanced.dropoffLocation = dropoffWaypoint ? {
                address: dropoffWaypoint.address,
                placeId: dropoffWaypoint.placeId,
                estimatedArrivalTime: (dropoffWaypoint as any).estimatedArrivalTime,
            } : {
                address: ride.destinationAddress,
                placeId: ride.destinationPlaceId,
                estimatedArrivalTime: (ride.waypoints.find((w: any) => w.waypointType === 'DROPOFF') as any)?.estimatedArrivalTime || null,
            };
        } else {
            enhanced.pickupLocation = {
                address: ride.originAddress,
                placeId: ride.originPlaceId,
                estimatedArrivalTime: ride.departureTime,
            };
            enhanced.dropoffLocation = {
                address: ride.destinationAddress,
                placeId: ride.destinationPlaceId,
                estimatedArrivalTime: (ride.waypoints.find((w: any) => w.waypointType === 'DROPOFF') as any)?.estimatedArrivalTime || null,
            };
        }

        return enhanced;
    });

    return {
        ...ride,
        bookings: enhancedBookings,
    };
};

/* ================= CANCEL RIDE (with cascade) ================= */
export const cancelRide = async (driverId: string, rideId: string) => {
    const ride = await prisma.ride.findFirst({
        where: {
            id: rideId,
            driverId,
            status: { in: [RideStatus.PUBLISHED] },
        },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND_OR_CANNOT_CANCEL');
    }

    const activeBookings = await prisma.rideBooking.findMany({
        where: {
            rideId,
            status: { in: [BookingStatus.DRIVER_PENDING, BookingStatus.CONFIRMED] },
        },
        select: {
            id: true,
            passengerId: true,
            seatsBooked: true,
            totalPrice: true,
            paymentAmount: true,
            paymentCapturedAt: true,
            stripePaymentIntentId: true,
        },
    });

    const bypassPayment = isBypassBookingPaymentMode();

    // Cancel all active bookings, issue refunds, and mark ride cancelled
    await prisma.$transaction(async (tx) => {
        await tx.ride.update({
            where: { id: rideId },
            data: { status: RideStatus.CANCELLED },
        });

        // Batch update all active bookings at once
        const now = new Date();
        await tx.rideBooking.updateMany({
            where: { rideId, status: { in: ['CONFIRMED', 'DRIVER_PENDING'] } },
            data: {
                status: 'CANCELLED',
                cancelledAt: now,
                cancelledByRole: 'DRIVER',
                cancellationReason: 'DRIVER_CANCELLED_RIDE',
                refundPercent: 100,
            },
        });

        // Set refund amounts individually (updateMany can't use per-row computed values)
        for (const booking of activeBookings) {
            await tx.rideBooking.update({
                where: { id: booking.id },
                data: { refundAmount: booking.paymentAmount ?? booking.totalPrice },
            });
        }

        // Issue Stripe refunds (external API calls, must be individual)
        if (!bypassPayment) {
            for (const booking of activeBookings) {
                const isPaymentCaptured = !!(booking.paymentCapturedAt && booking.stripePaymentIntentId);
                if (isPaymentCaptured && booking.stripePaymentIntentId) {
                    const refundAmount = booking.paymentAmount ?? booking.totalPrice;
                    await refundPaymentIntent(
                        booking.stripePaymentIntentId,
                        toMinorCurrencyUnits(refundAmount)
                    );
                    await tx.rideBooking.update({
                        where: { id: booking.id },
                        data: { refundedAt: new Date() },
                    });
                }
            }
        }
    });

    // Notify all affected passengers (after transaction succeeds)
    await Promise.all(
        activeBookings.map((booking) =>
            createNotification({
                userId: booking.passengerId,
                type: 'booking.cancelled.driver_cancelled_ride',
                title: 'Ride cancelled by driver',
                body: 'Your driver cancelled the ride. A full refund has been initiated.',
                data: {
                    bookingId: booking.id,
                    rideId,
                    refundPercent: '100',
                    deepLink: `app://booking/${booking.id}`,
                },
            })
        )
    );
};

/* ================= START RIDE ================= */
export const startRide = async (driverId: string, rideId: string) => {
    const ride = await prisma.ride.findFirst({
        where: { id: rideId, driverId, status: RideStatus.PUBLISHED },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND_OR_CANNOT_START');
    }

    return prisma.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.IN_PROGRESS },
    });
};

/* ================= COMPLETE RIDE ================= */
export const completeRide = async (driverId: string, rideId: string) => {
    const ride = await prisma.ride.findFirst({
        where: { id: rideId, driverId, status: RideStatus.IN_PROGRESS },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND_OR_CANNOT_COMPLETE');
    }

    await prisma.$transaction(async (tx) => {
        await tx.ride.update({
            where: { id: rideId },
            data: { status: RideStatus.COMPLETED },
        });

        // Auto-complete all bookings still IN_PROGRESS (passenger didn't scan drop OTP)
        await tx.rideBooking.updateMany({
            where: {
                rideId,
                status: BookingStatus.IN_PROGRESS,
            },
            data: {
                status: BookingStatus.COMPLETED,
            },
        });
    });

    // Notify confirmed passengers to rate the driver
    const completedBookings = await prisma.rideBooking.findMany({
        where: {
            rideId,
            status: BookingStatus.COMPLETED,
        },
        select: { id: true, passengerId: true },
    });

    await Promise.all(
        completedBookings.map((booking) =>
            createNotification({
                userId: booking.passengerId,
                type: 'ride.completed',
                title: 'Ride completed',
                body: 'Your ride is complete. How was your journey?',
                data: {
                    bookingId: booking.id,
                    rideId,
                    deepLink: `app://booking/${booking.id}/rate`,
                },
            })
        )
    );
};
