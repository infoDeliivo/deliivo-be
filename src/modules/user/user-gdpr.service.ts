import { BookingStatus, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { logError } from '../../utils/logger.js';

/* ====================== DATA EXPORT ====================== */
export const exportUserData = async (userId: string) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            firstName: true,
            lastName: true,
            salutation: true,
            gender: true,
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
            firstName: user.firstName,
            lastName: user.lastName,
            salutation: user.salutation,
            gender: user.gender,
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
            firstName: null,
            lastName: null,
            salutation: null,
            gender: null,
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

export const hardDeleteUserAccount = async (userId: string) => {
    await deleteUserAccount(userId);

    try {
        const [rideRows, passengerBookingRows, payoutBatchRows, referralRows] = await Promise.all([
            prisma.ride.findMany({
                where: { driverId: userId },
                select: { id: true },
            }),
            prisma.rideBooking.findMany({
                where: { passengerId: userId },
                select: { id: true },
            }),
            prisma.payoutBatch.findMany({
                where: { driverId: userId },
                select: { id: true },
            }),
            prisma.rewardReferral.findMany({
                where: {
                    OR: [
                        { referrerUserId: userId },
                        { referredUserId: userId },
                    ],
                },
                select: { id: true },
            }),
        ]);

        const rideIds = rideRows.map((ride) => ride.id);
        const passengerBookingIds = passengerBookingRows.map((booking) => booking.id);
        const driverBookingRows = rideIds.length > 0
            ? await prisma.rideBooking.findMany({
                where: { rideId: { in: rideIds } },
                select: { id: true },
            })
            : [];
        const driverBookingIds = driverBookingRows.map((booking) => booking.id);
        const bookingIds = Array.from(new Set([...passengerBookingIds, ...driverBookingIds]));

        const paymentRecords = await prisma.payment.findMany({
            where: {
                OR: [
                    { riderId: userId },
                    ...(rideIds.length > 0 ? [{ rideId: { in: rideIds } }] : []),
                    ...(bookingIds.length > 0 ? [{ bookingId: { in: bookingIds } }] : []),
                ],
            },
            select: { id: true, bookingId: true, stripePaymentIntentId: true },
        });

        const paymentIds = paymentRecords.map((payment) => payment.id);
        const paymentIntentIds = paymentRecords.map((payment) => payment.stripePaymentIntentId).filter((value): value is string => Boolean(value));
        const payoutBatchIdList = payoutBatchRows.map((batch) => batch.id);
        const referralIdList = referralRows.map((row) => row.id);

        await prisma.$transaction(async (tx) => {
            if (paymentIds.length > 0) {
                await tx.payoutItem.deleteMany({ where: { paymentId: { in: paymentIds } } });
            }

            if (payoutBatchIdList.length > 0) {
                await tx.payoutItem.deleteMany({ where: { payoutBatchId: { in: payoutBatchIdList } } });
                await tx.payoutBatch.deleteMany({ where: { id: { in: payoutBatchIdList } } });
            }

            if (paymentIntentIds.length > 0) {
                await tx.stripeWebhookEvent.deleteMany({ where: { paymentIntentId: { in: paymentIntentIds } } });
            }

            if (paymentIds.length > 0) {
                await tx.paymentEventOutbox.deleteMany({
                    where: {
                        OR: [
                            { aggregateType: 'PAYMENT', aggregateId: { in: paymentIds } },
                        ],
                    },
                });
                await tx.reconciliationIssue.deleteMany({ where: { paymentId: { in: paymentIds } } });
                await tx.ledgerEntry.deleteMany({ where: { paymentId: { in: paymentIds } } });
                await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
            }

            if (bookingIds.length > 0) {
                await tx.trackingLink.deleteMany({ where: { bookingId: { in: bookingIds } } });
                await tx.dispute.deleteMany({ where: { bookingId: { in: bookingIds } } });
                await tx.paymentEventOutbox.deleteMany({
                    where: {
                        OR: [
                            { aggregateType: 'BOOKING', aggregateId: { in: bookingIds } },
                        ],
                    },
                });
                await tx.reconciliationIssue.deleteMany({ where: { bookingId: { in: bookingIds } } });
                await tx.ledgerEntry.deleteMany({ where: { bookingId: { in: bookingIds } } });
                await tx.rideBooking.deleteMany({ where: { id: { in: bookingIds } } });
            }

            if (rideIds.length > 0) {
                await tx.ridePricingSnapshot.deleteMany({ where: { rideId: { in: rideIds } } });
                await tx.paymentEventOutbox.deleteMany({
                    where: {
                        OR: [
                            { aggregateType: 'PAYOUT', aggregateId: { in: payoutBatchIdList } },
                        ],
                    },
                });
                await tx.ride.deleteMany({ where: { id: { in: rideIds } } });
            }

            if (referralIdList.length > 0) {
                await tx.rewardWalletEntry.deleteMany({ where: { referralId: { in: referralIdList } } });
                await tx.rewardReferral.deleteMany({ where: { id: { in: referralIdList } } });
            }

            await tx.user.updateMany({ where: { referredByUserId: userId }, data: { referredByUserId: null } });
            await tx.rewardCampaign.updateMany({ where: { createdById: userId }, data: { createdById: null } });
            await tx.rewardCampaign.updateMany({ where: { updatedById: userId }, data: { updatedById: null } });
            await tx.rewardWalletEntry.updateMany({ where: { createdById: userId }, data: { createdById: null } });
            await tx.$executeRaw`UPDATE "RewardSettlementBatch" SET "createdById" = NULL WHERE "createdById" = ${userId}`;

            await tx.rewardWalletEntry.deleteMany({ where: { userId } });
            await tx.paymentMethod.deleteMany({ where: { userId } });
            await tx.userReport.deleteMany({ where: { OR: [{ reporterId: userId }, { reportedId: userId }] } });
            await tx.userBlock.deleteMany({ where: { OR: [{ blockerId: userId }, { blockedId: userId }] } });

            await tx.user.delete({ where: { id: userId } });
        });
    } catch (error) {
        logError('[USER] hard delete cleanup failed after anonymization', error, { userId });
    }

    return { deleted: true, hardDeleted: true };
};
