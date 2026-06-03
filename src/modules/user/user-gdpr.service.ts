import { BookingStatus, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';

/* ====================== DATA EXPORT ====================== */
export const exportUserData = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            name: true,
            nickName: true,
            salutation: true,
            dob: true,
            email: true,
            phone: true,
            emailVerified: true,
            phoneVerified: true,
            role: true,
            onboardingStatus: true,
            isVerified: true,
            dlVerified: true,
            tosAcceptedAt: true,
            tosVersion: true,
            privacyAcceptedAt: true,
            privacyVersion: true,
            createdAt: true,
            updatedAt: true,
            travelPreference: {
                select: { chattiness: true, pets: true, createdAt: true },
            },
            vehicles: {
                select: {
                    id: true,
                    licenseCountry: true,
                    licenseNumber: true,
                    brand: true,
                    model_num: true,
                    model_name: true,
                    type: true,
                    color: true,
                    year: true,
                    isVerified: true,
                    createdAt: true,
                },
            },
            rides: {
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: {
                    id: true,
                    status: true,
                    originAddress: true,
                    destinationAddress: true,
                    departureDate: true,
                    departureTime: true,
                    totalSeats: true,
                    basePricePerSeat: true,
                    currency: true,
                    createdAt: true,
                },
            },
            bookings: {
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: {
                    id: true,
                    rideId: true,
                    seatsBooked: true,
                    totalPrice: true,
                    status: true,
                    paymentCurrency: true,
                    createdAt: true,
                },
            },
            ratingsGiven: {
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: {
                    id: true,
                    stars: true,
                    reviewText: true,
                    rideId: true,
                    createdAt: true,
                },
            },
            ratingsReceived: {
                orderBy: { createdAt: 'desc' },
                take: 200,
                select: {
                    id: true,
                    stars: true,
                    reviewText: true,
                    rideId: true,
                    createdAt: true,
                },
            },
            reportsMade: {
                orderBy: { createdAt: 'desc' },
                take: 100,
                select: {
                    id: true,
                    reportedId: true,
                    reason: true,
                    createdAt: true,
                },
            },
            blocksInitiated: {
                orderBy: { createdAt: 'desc' },
                take: 100,
                select: { blockedId: true, createdAt: true },
            },
        },
    });

    if (!user) throw new Error('USER_NOT_FOUND');

    return {
        exportedAt: new Date().toISOString(),
        profile: {
            id: user.id,
            name: user.name,
            nickName: user.nickName,
            salutation: user.salutation,
            dob: user.dob,
            email: user.email,
            phone: user.phone,
            emailVerified: user.emailVerified,
            phoneVerified: user.phoneVerified,
            role: user.role,
            onboardingStatus: user.onboardingStatus,
            isVerified: user.isVerified,
            dlVerified: user.dlVerified,
            tosAcceptedAt: user.tosAcceptedAt,
            tosVersion: user.tosVersion,
            privacyAcceptedAt: user.privacyAcceptedAt,
            privacyVersion: user.privacyVersion,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        },
        travelPreferences: user.travelPreference,
        vehicles: user.vehicles,
        ridesAsDriver: user.rides,
        bookingsAsPassenger: user.bookings,
        ratingsGiven: user.ratingsGiven,
        ratingsReceived: user.ratingsReceived,
        reportsMade: user.reportsMade,
        usersBlocked: user.blocksInitiated,
    };
};

/* ====================== ACCOUNT DELETION ====================== */
const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
];

const CANCELLABLE_RIDE_STATUSES: RideStatus[] = [
    RideStatus.PUBLISHED,
    RideStatus.IN_PROGRESS,
];

export const deleteUserAccount = async (userId: string) => {
    // 1. Cancel active rides as driver + refund all their bookings
    const activeRides = await prisma.ride.findMany({
        where: { driverId: userId, status: { in: CANCELLABLE_RIDE_STATUSES } },
        include: {
            bookings: {
                where: { status: { in: ACTIVE_BOOKING_STATUSES } },
                select: {
                    id: true,
                    status: true,
                    stripePaymentIntentId: true,
                    paymentAmount: true,
                    paymentCurrency: true,
                    seatsBooked: true,
                    rideId: true,
                },
            },
        },
    });

    for (const ride of activeRides) {
        await prisma.$transaction(async (tx) => {
            await tx.ride.update({
                where: { id: ride.id },
                data: { status: RideStatus.CANCELLED },
            });

            for (const booking of ride.bookings) {
                await tx.rideBooking.update({
                    where: { id: booking.id },
                    data: {
                        status: BookingStatus.CANCELLED,
                        cancelledAt: new Date(),
                        cancelledByRole: 'SYSTEM',
                        refundAmount: booking.paymentAmount,
                        refundPercent: 100,
                    },
                });

                await tx.ride.update({
                    where: { id: booking.rideId },
                    data: { availableSeats: { increment: booking.seatsBooked } },
                });

                if (booking.stripePaymentIntentId && booking.paymentAmount) {
                    const amountMinor = toMinorCurrencyUnits(booking.paymentAmount ?? 0);
                    await refundPaymentIntent(booking.stripePaymentIntentId, amountMinor);
                    await tx.rideBooking.update({
                        where: { id: booking.id },
                        data: { refundedAt: new Date() },
                    });
                }
            }
        });
    }

    // 2. Cancel active bookings as passenger + issue refunds
    const activeBookings = await prisma.rideBooking.findMany({
        where: { passengerId: userId, status: { in: ACTIVE_BOOKING_STATUSES } },
        select: {
            id: true,
            status: true,
            stripePaymentIntentId: true,
            paymentAmount: true,
            paymentCurrency: true,
            seatsBooked: true,
            rideId: true,
        },
    });

    for (const booking of activeBookings) {
        await prisma.$transaction(async (tx) => {
            await tx.rideBooking.update({
                where: { id: booking.id },
                data: {
                    status: BookingStatus.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledByRole: 'SYSTEM',
                    refundAmount: booking.paymentAmount,
                    refundPercent: 100,
                },
            });

            await tx.ride.update({
                where: { id: booking.rideId },
                data: { availableSeats: { increment: booking.seatsBooked } },
            });

            if (booking.stripePaymentIntentId && booking.paymentAmount) {
                const amountMinor = toMinorCurrencyUnits(booking.paymentAmount ?? 0);
                await refundPaymentIntent(booking.stripePaymentIntentId, amountMinor);
                await tx.rideBooking.update({
                    where: { id: booking.id },
                    data: { refundedAt: new Date() },
                });
            }
        });
    }

    // 3. Revoke all refresh tokens
    await prisma.refreshToken.deleteMany({ where: { userId } });

    // 4. Anonymise the user record (zero out PII; keep ID + timestamps for referential integrity)
    await prisma.user.update({
        where: { id: userId },
        data: {
            name: null,
            nickName: null,
            salutation: null,
            dob: null,
            email: null,
            phone: null,
            avatarUrl: null,
            emailVerified: false,
            phoneVerified: false,
            isVerified: false,
            isBanned: true,
            stripeAccountId: null,
            tosAcceptedAt: null,
            tosVersion: null,
            privacyAcceptedAt: null,
            privacyVersion: null,
        },
    });

    return { deleted: true };
};
