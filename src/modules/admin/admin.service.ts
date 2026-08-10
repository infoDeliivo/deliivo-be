import { randomUUID } from 'crypto';
import { BookingStatus, Prisma, RideStatus, UserRole, VehicleVerificationStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { PAYMENT_STATUSES, markBookingPaymentRefunded } from '../payments/payment.service.js';
import redis from '../../cache/redis.js';
import { getContentSummary } from '../content/content.service.js';
import { DISPUTE_STATUSES, OPEN_DISPUTE_STATUSES } from '../dispute/dispute.constants.js';
import { manualSessionId } from '../dl-verification/dl-review.service.js';

const emergencyAlertSelect = {
    id: true,
    userId: true,
    rideId: true,
    bookingId: true,
    role: true,
    status: true,
    message: true,
    lat: true,
    lng: true,
    createdAt: true,
    acknowledgedAt: true,
    resolvedAt: true,
    resolvedBy: true,
    user: { select: { id: true, firstName: true, email: true, phone: true, avatarUrl: true } },
    ride: {
        select: {
            id: true,
            originAddress: true,
            destinationAddress: true,
            departureDate: true,
            departureTime: true,
            status: true,
        },
    },
    booking: {
        select: {
            id: true,
            passengerId: true,
            status: true,
            seatsBooked: true,
            totalPrice: true,
        },
    },
} satisfies Prisma.EmergencyAlertSelect;

/* ================= LIST USERS ================= */
export const listUsers = async (query: {
    page?: number;
    limit?: number;
    search?: string;
    isBanned?: boolean;
    role?: string;
    dlVerified?: boolean;
}) => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    // Typed rather than `any`: an untyped where silently compiles against columns that
    // no longer exist and only fails at runtime.
    const where: Prisma.UserWhereInput = {};
    if (query.search) {
        where.OR = [
            { firstName: { contains: query.search, mode: 'insensitive' } },
            { lastName: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
        ];
    }
    if (typeof query.isBanned === 'boolean') {
        where.isBanned = query.isBanned;
    }
    if (query.role) {
        // Only a real role reaches the query; an unknown value is ignored rather than
        // handed to Prisma, which would throw on an invalid enum member.
        const role = query.role.toUpperCase();
        if (role in UserRole) {
            where.role = role as UserRole;
        }
    }
    if (typeof query.dlVerified === 'boolean') {
        where.dlVerified = query.dlVerified;
    }

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                firstName: true,
                salutation: true,
                gender: true,
                email: true,
                phone: true,
                role: true,
                isBanned: true,
                isVerified: true,
                dlVerified: true,
                onboardingStatus: true,
                createdAt: true,
            },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        users,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

const PAID_PAYMENT_STATUSES = [
    PAYMENT_STATUSES.PAID,
    PAYMENT_STATUSES.HELD_IN_ESCROW,
    PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
    PAYMENT_STATUSES.TRANSFER_CREATED,
    PAYMENT_STATUSES.PAYOUT_COMPLETED,
    PAYMENT_STATUSES.REFUND_PENDING,
    PAYMENT_STATUSES.REFUNDED,
];

const EARNING_PAYMENT_STATUSES = [
    PAYMENT_STATUSES.HELD_IN_ESCROW,
    PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
    PAYMENT_STATUSES.TRANSFER_CREATED,
    PAYMENT_STATUSES.PAYOUT_COMPLETED,
];

const adminUserDetailRideSelect = {
    id: true,
    status: true,
    originAddress: true,
    destinationAddress: true,
    departureDate: true,
    departureTime: true,
    totalSeats: true,
    availableSeats: true,
    basePricePerSeat: true,
    currency: true,
    routeDistanceMeters: true,
    routeDurationSeconds: true,
    actualStartTime: true,
    actualEndTime: true,
    createdAt: true,
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
            verificationStatus: true,
        },
    },
    bookings: {
        select: {
            id: true,
            status: true,
            passengerId: true,
            seatsBooked: true,
            totalPrice: true,
            paymentAmount: true,
            paymentCapturedAt: true,
            refundedAt: true,
            refundAmount: true,
            completedAt: true,
            createdAt: true,
            passenger: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
            payment: {
                select: {
                    id: true,
                    status: true,
                    amountTotal: true,
                    fareAmount: true,
                    platformFeeAmount: true,
                    currency: true,
                    payoutEligibleAt: true,
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    },
    disputes: { select: { id: true, status: true, reason: true, createdAt: true } },
} satisfies Prisma.RideSelect;

const adminUserDetailBookingSelect = {
    id: true,
    rideId: true,
    passengerId: true,
    status: true,
    seatsBooked: true,
    totalPrice: true,
    paymentAmount: true,
    paymentCurrency: true,
    paymentCapturedAt: true,
    refundedAt: true,
    refundAmount: true,
    completedAt: true,
    cancelledAt: true,
    createdAt: true,
    pickupAddress: true,
    dropoffAddress: true,
    payment: {
        select: {
            id: true,
            status: true,
            amountTotal: true,
            fareAmount: true,
            platformFeeAmount: true,
            currency: true,
            payoutEligibleAt: true,
        },
    },
    disputes: { select: { id: true, status: true, reason: true, createdAt: true } },
    ride: {
        select: {
            id: true,
            status: true,
            originAddress: true,
            destinationAddress: true,
            departureDate: true,
            departureTime: true,
            currency: true,
            driver: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, avatarUrl: true } },
        },
    },
} satisfies Prisma.RideBookingSelect;

export const getUserDetails = async (userId: string) => {
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
            avatarUrl: true,
            role: true,
            isBanned: true,
            onboardingStatus: true,
            isVerified: true,
            dlVerified: true,
            stripeAccountId: true,
            stripeOnboardingComplete: true,
            stripeAccountName: true,
            stripeNameMatch: true,
            stripeDobMatch: true,
            tosAcceptedAt: true,
            tosVersion: true,
            privacyAcceptedAt: true,
            privacyVersion: true,
            createdAt: true,
            updatedAt: true,
            travelPreference: { select: { chattiness: true, pets: true } },
            ratingStats: { select: { totalRatings: true, totalStars: true, averageRating: true } },
            vehicles: {
                where: { deletedAt: null },
                orderBy: { createdAt: 'desc' },
                select: adminVehicleSelect,
            },
            dlVerifications: {
                orderBy: { createdAt: 'desc' },
                take: 5,
                select: {
                    id: true,
                    status: true,
                    veriffSessionId: true,
                    verifiedName: true,
                    verifiedDob: true,
                    verifiedGender: true,
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                    documentImageKey: true,
                    declineReason: true,
                    reviewedById: true,
                    reviewedAt: true,
                    createdAt: true,
                    updatedAt: true,
                },
            },
            paymentMethods: {
                orderBy: { createdAt: 'desc' },
                select: {
                    id: true,
                    brand: true,
                    last4: true,
                    expMonth: true,
                    expYear: true,
                    isDefault: true,
                    status: true,
                    createdAt: true,
                },
            },
        },
    });

    if (!user) throw new Error('USER_NOT_FOUND');

    const [
        publishedRides,
        bookedRides,
        publishedRideCount,
        completedPublishedRideCount,
        bookingCount,
        completedBookingCount,
        riderPayments,
        riderRefunds,
        driverEarnings,
        payoutEligible,
        paidOut,
        approvedVeriffChecks,
        approvedManualChecks,
        openDisputes,
        reportsMade,
        reportsReceived,
        blocksMade,
        blocksReceived,
    ] = await Promise.all([
        prisma.ride.findMany({
            where: { driverId: userId },
            orderBy: [{ departureDate: 'desc' }, { departureTime: 'desc' }],
            take: 10,
            select: adminUserDetailRideSelect,
        }),
        prisma.rideBooking.findMany({
            where: { passengerId: userId },
            orderBy: { createdAt: 'desc' },
            take: 10,
            select: adminUserDetailBookingSelect,
        }),
        prisma.ride.count({ where: { driverId: userId } }),
        prisma.ride.count({ where: { driverId: userId, status: RideStatus.COMPLETED } }),
        prisma.rideBooking.count({ where: { passengerId: userId } }),
        prisma.rideBooking.count({ where: { passengerId: userId, status: BookingStatus.COMPLETED } }),
        prisma.payment.aggregate({
            where: { riderId: userId, status: { in: PAID_PAYMENT_STATUSES } },
            _sum: { amountTotal: true, platformFeeAmount: true },
            _count: { _all: true },
        }),
        prisma.rideBooking.aggregate({
            where: { passengerId: userId, refundedAt: { not: null } },
            _sum: { refundAmount: true },
            _count: { _all: true },
        }),
        prisma.payment.aggregate({
            where: {
                status: { in: EARNING_PAYMENT_STATUSES },
                booking: { ride: { driverId: userId } },
            },
            _sum: { fareAmount: true, amountTotal: true, platformFeeAmount: true },
            _count: { _all: true },
        }),
        prisma.payment.aggregate({
            where: {
                status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
                booking: { ride: { driverId: userId } },
            },
            _sum: { fareAmount: true },
            _count: { _all: true },
        }),
        prisma.payoutBatch.aggregate({
            where: { driverId: userId, status: 'COMPLETED' },
            _sum: { amountTotal: true },
            _count: { _all: true },
        }),
        prisma.dlVerification.count({
            where: {
                userId,
                status: 'APPROVED',
                veriffSessionId: { not: manualSessionId(userId) },
            },
        }),
        prisma.dlVerification.count({
            where: {
                userId,
                status: 'APPROVED',
                veriffSessionId: manualSessionId(userId),
            },
        }),
        prisma.dispute.count({
            where: {
                resolvedAt: null,
                OR: [
                    { raisedBy: userId },
                    { booking: { passengerId: userId } },
                    { ride: { driverId: userId } },
                ],
            },
        }),
        prisma.userReport.count({ where: { reporterId: userId } }),
        prisma.userReport.count({ where: { reportedId: userId } }),
        prisma.userBlock.count({ where: { blockerId: userId } }),
        prisma.userBlock.count({ where: { blockedId: userId } }),
    ]);

    const { vehicles, dlVerifications, paymentMethods, ...profile } = user;
    const verificationFlags = {
        completeOnboardingVerified: profile.onboardingStatus === 'COMPLETED',
        veriffVerified: approvedVeriffChecks > 0,
        manualLicenseApproved: approvedManualChecks > 0,
        licenseVerified: Boolean(profile.dlVerified),
        vehicleVerified: vehicles.some((vehicle) => vehicle.verificationStatus === VehicleVerificationStatus.APPROVED),
        canRequireVeriff: approvedManualChecks > 0 && approvedVeriffChecks === 0 && Boolean(profile.dlVerified),
    };

    return {
        user: {
            ...profile,
            verificationFlags,
        },
        vehicles: vehicles.map(mapAdminVehicle),
        dlVerifications: dlVerifications.map((record) => {
            const { documentImageKey, ...rest } = record;
            return {
                ...rest,
                previewKey: documentImageKey ?? null,
            };
        }),
        paymentMethods,
        summary: {
            publishedRideCount,
            completedPublishedRideCount,
            bookingCount,
            completedBookingCount,
            openDisputes,
            reportsMade,
            reportsReceived,
            blocksMade,
            blocksReceived,
            payments: {
                totalPaid: riderPayments._sum.amountTotal ?? 0,
                platformFeesPaid: riderPayments._sum.platformFeeAmount ?? 0,
                paymentCount: riderPayments._count._all,
                totalRefunded: riderRefunds._sum.refundAmount ?? 0,
                refundCount: riderRefunds._count._all,
            },
            earnings: {
                totalEarned: driverEarnings._sum.fareAmount ?? 0,
                grossRideRevenue: driverEarnings._sum.amountTotal ?? 0,
                platformFeesFromRides: driverEarnings._sum.platformFeeAmount ?? 0,
                earningPaymentCount: driverEarnings._count._all,
                payoutEligible: payoutEligible._sum.fareAmount ?? 0,
                payoutEligibleCount: payoutEligible._count._all,
                paidOut: paidOut._sum.amountTotal ?? 0,
                payoutCount: paidOut._count._all,
            },
        },
        publishedRides,
        bookedRides,
    };
};

export const requireVeriffForUser = async (userId: string, adminId: string | null) => {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, dlVerified: true },
    });
    if (!user) throw new Error('USER_NOT_FOUND');

    const manualApprovedRow = await prisma.dlVerification.findUnique({
        where: { veriffSessionId: manualSessionId(userId) },
        select: { id: true, status: true },
    });

    if (!manualApprovedRow || manualApprovedRow.status !== 'APPROVED') {
        throw new Error('MANUAL_APPROVAL_NOT_FOUND');
    }

    const existingVeriffApproval = await prisma.dlVerification.findFirst({
        where: {
            userId,
            status: 'APPROVED',
            veriffSessionId: { not: manualSessionId(userId) },
        },
        select: { id: true },
    });
    if (existingVeriffApproval) {
        throw new Error('ALREADY_VERIFF_VERIFIED');
    }

    await prisma.$transaction([
        prisma.dlVerification.update({
            where: { veriffSessionId: manualSessionId(userId) },
            data: {
                status: 'SUPERSEDED',
                decisionPayload: {
                    source: 'ADMIN',
                    action: 'REQUIRE_VERIFF',
                    at: new Date().toISOString(),
                    adminId,
                } as Prisma.InputJsonValue,
            },
        }),
        prisma.user.update({
            where: { id: userId },
            data: { dlVerified: false },
        }),
    ]);

    return {
        id: userId,
        dlVerified: false,
        requiresVeriff: true,
    };
};

/* ================= BAN / UNBAN USER ================= */
export const setBanStatus = async (userId: string, isBanned: boolean) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user) throw new Error('USER_NOT_FOUND');
    if (user.role === 'ADMIN') throw new Error('CANNOT_BAN_ADMIN');

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { isBanned },
        select: { id: true, isBanned: true },
    });

    // Sync ban status to Redis for auth middleware check
    if (isBanned) {
        await redis.set(`banned:${userId}`, '1');
    } else {
        await redis.del(`banned:${userId}`);
    }

    return updated;
};

/* ================= PLATFORM STATS ================= */
export const getStats = async () => {
    const [totalUsers, totalRides, totalBookings, totalRevenue] = await Promise.all([
        prisma.user.count(),
        prisma.ride.count(),
        prisma.rideBooking.count(),
        prisma.rideBooking.aggregate({
            where: { status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS] } },
            _sum: { paymentAmount: true },
        }),
    ]);

    return {
        totalUsers,
        totalRides,
        totalBookings,
        totalRevenue: totalRevenue._sum.paymentAmount ?? 0,
    };
};

export const getMonitoringTrends = async (days = 7) => {
    const safeDays = Math.min(14, Math.max(3, Math.floor(days)));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const points = await Promise.all(
        Array.from({ length: safeDays }, async (_, index) => {
            const start = new Date(today);
            start.setDate(today.getDate() - (safeDays - 1 - index));
            const end = new Date(start);
            end.setDate(start.getDate() + 1);

            const [ridesPublished, bookingsCreated, webhookEvents, revenue] = await Promise.all([
                prisma.ride.count({
                    where: {
                        createdAt: { gte: start, lt: end },
                    },
                }),
                prisma.rideBooking.count({
                    where: {
                        createdAt: { gte: start, lt: end },
                    },
                }),
                prisma.stripeWebhookEvent.count({
                    where: {
                        processedAt: { gte: start, lt: end },
                    },
                }),
                prisma.rideBooking.aggregate({
                    where: {
                        createdAt: { gte: start, lt: end },
                        status: { in: [BookingStatus.CONFIRMED, BookingStatus.COMPLETED, BookingStatus.IN_PROGRESS] },
                    },
                    _sum: { paymentAmount: true },
                }),
            ]);

            return {
                date: start.toISOString().slice(0, 10),
                ridesPublished,
                bookingsCreated,
                webhookEvents,
                revenue: revenue._sum.paymentAmount ?? 0,
            };
        })
    );

    return { points };
};

/* ================= VEHICLE REVIEW QUEUE ================= */

const adminVehicleSelect = {
    id: true,
    userId: true,
    licenseCountry: true,
    licenseNumber: true,
    brand: true,
    model_num: true,
    model_name: true,
    type: true,
    color: true,
    year: true,
    imageUrl: true,
    isVerified: true,
    verificationStatus: true,
    rejectionReason: true,
    reviewedAt: true,
    reviewedById: true,
    createdAt: true,
    user: { select: { id: true, firstName: true, email: true, phone: true, dlVerified: true } },
    documents: {
        select: { id: true, documentType: true, image: true, imageKey: true, createdAt: true },
    },
} satisfies Prisma.VehicleSelect;

type AdminVehicle = Prisma.VehicleGetPayload<{ select: typeof adminVehicleSelect }>;

const ACTIVE_RIDE_RESOLUTION_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.CONFIRMED,
    BookingStatus.WAITING_FOR_PICKUP,
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.OTP_PENDING,
    BookingStatus.ONBOARD,
    BookingStatus.DROP_PENDING,
    BookingStatus.IN_PROGRESS,
];

const TERMINAL_RIDE_RESOLUTION_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_FAILED,
    BookingStatus.CANCELLED,
    BookingStatus.COMPLETED,
    BookingStatus.NO_SHOW,
    BookingStatus.DRIVER_MISSED_PICKUP,
    BookingStatus.DISPUTED,
];

const FORCE_COMPLETABLE_RIDE_STATUSES: RideStatus[] = [
    RideStatus.IN_PROGRESS,
    RideStatus.COMPLETION_PENDING,
];

const adminRideEventData = (
    rideId: string,
    bookingId: string,
    adminId: string,
    eventType: string,
    reason: string,
): Prisma.RideEventUncheckedCreateInput => ({
    rideId,
    bookingId,
    actionId: randomUUID(),
    eventType,
    actorType: 'ADMIN',
    actorId: adminId,
    clientTimestamp: new Date(),
    validationStatus: 'WARNING',
    metadataJson: {
        supportOverride: true,
        bookingId,
        reason,
    } as Prisma.InputJsonValue,
});

/**
 * Private documents are exposed as `previewKey`, never as a URL — the admin exchanges the
 * key for a short-lived signed URL via GET /uploads/read. Mirrors how the driver-facing
 * vehicle response is shaped.
 */
const mapAdminVehicle = (vehicle: AdminVehicle) => {
    const { documents, ...rest } = vehicle;
    return {
        ...rest,
        documents: documents.map((doc) => ({
            id: doc.id,
            documentType: doc.documentType,
            image: doc.image ?? null,
            previewKey: doc.imageKey ?? null,
            createdAt: doc.createdAt,
        })),
    };
};

export const listVehicles = async (query: {
    page?: number;
    limit?: number;
    status?: VehicleVerificationStatus;
}) => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.VehicleWhereInput = { deletedAt: null };
    if (query.status) {
        where.verificationStatus = query.status;
    }

    const [vehicles, total] = await Promise.all([
        prisma.vehicle.findMany({
            where,
            skip,
            take: limit,
            // Oldest first: a review queue should be worked front to back.
            orderBy: { createdAt: 'asc' },
            select: adminVehicleSelect,
        }),
        prisma.vehicle.count({ where }),
    ]);

    return {
        vehicles: vehicles.map(mapAdminVehicle),
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/* ================= VERIFY VEHICLE ================= */
export const verifyVehicle = async (vehicleId: string, reviewedById?: string) => {
    const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, userId: true },
    });
    if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');

    const updated = await prisma.vehicle.update({
        where: { id: vehicleId },
        data: {
            // isVerified is kept in sync with verificationStatus for existing readers.
            isVerified: true,
            verificationStatus: VehicleVerificationStatus.APPROVED,
            rejectionReason: null,
            reviewedAt: new Date(),
            reviewedById: reviewedById ?? null,
        },
        select: { id: true, isVerified: true, verificationStatus: true, reviewedAt: true },
    });

    await createNotification({
        userId: vehicle.userId,
        type: 'vehicle.approved',
        title: 'Vehicle approved',
        body: 'Your vehicle has been approved. You can now publish rides.',
        data: { vehicleId },
    });

    return updated;
};

/* ================= REJECT VEHICLE ================= */
export const rejectVehicle = async (
    vehicleId: string,
    reason: string,
    reviewedById?: string,
) => {
    const vehicle = await prisma.vehicle.findUnique({
        where: { id: vehicleId },
        select: { id: true, userId: true },
    });
    if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');

    const updated = await prisma.vehicle.update({
        where: { id: vehicleId },
        data: {
            isVerified: false,
            verificationStatus: VehicleVerificationStatus.REJECTED,
            rejectionReason: reason,
            reviewedAt: new Date(),
            reviewedById: reviewedById ?? null,
        },
        select: {
            id: true,
            isVerified: true,
            verificationStatus: true,
            rejectionReason: true,
            reviewedAt: true,
        },
    });

    // The reason travels with the notification so the driver knows what to re-upload.
    await createNotification({
        userId: vehicle.userId,
        type: 'vehicle.rejected',
        title: 'Vehicle rejected',
        body: reason,
        data: { vehicleId, reason },
    });

    return updated;
};

/* ================= ADMIN REFUND BOOKING ================= */
export const adminRefundBooking = async (bookingId: string) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        select: {
            id: true,
            status: true,
            stripePaymentIntentId: true,
            paymentAmount: true,
            paymentCurrency: true,
            refundedAt: true,
        },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.refundedAt) throw new Error('ALREADY_REFUNDED');
    if (!booking.stripePaymentIntentId || !booking.paymentAmount) {
        throw new Error('NO_PAYMENT_TO_REFUND');
    }

    const amountMinor = toMinorCurrencyUnits(booking.paymentAmount);

    await prisma.$transaction(async (tx) => {
        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                refundAmount: booking.paymentAmount,
                refundPercent: 100,
                cancelledAt: new Date(),
                cancelledByRole: 'ADMIN',
            },
        });

        await refundPaymentIntent(booking.stripePaymentIntentId!, amountMinor);

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: { refundedAt: new Date() },
        });
    });

    try {
        const updated = await prisma.rideBooking.findUnique({
            where: { id: bookingId },
            select: { ride: { select: { driverId: true } } },
        });
        if (updated?.ride.driverId) {
            await markBookingPaymentRefunded(bookingId, updated.ride.driverId, booking.paymentAmount);
        }
    } catch (error) {
        console.warn('Admin refund succeeded, but local payment refund sync failed', error);
    }

    return { bookingId, refunded: true };
};

export const adminForceCompleteBooking = async (
    bookingId: string,
    adminId: string,
    reason: string,
) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            payment: true,
            disputes: { where: { status: { in: OPEN_DISPUTE_STATUSES } }, select: { id: true } },
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    status: true,
                    originAddress: true,
                    destinationAddress: true,
                    actualEndTime: true,
                },
            },
            passenger: { select: { id: true } },
        },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (!ACTIVE_RIDE_RESOLUTION_BOOKING_STATUSES.includes(booking.status)) {
        throw new Error('BOOKING_NOT_FORCE_COMPLETABLE');
    }
    if (!FORCE_COMPLETABLE_RIDE_STATUSES.includes(booking.ride.status)) {
        throw new Error('RIDE_NOT_FORCE_COMPLETABLE');
    }
    if (booking.disputes.length > 0) {
        throw new Error('OPEN_DISPUTE_EXISTS');
    }

    const now = new Date();
    let rideCompleted = false;
    let paymentMarkedEligible = false;

    await prisma.$transaction(async (tx) => {
        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.COMPLETED,
                completedAt: now,
                riderDropoffConfirmedAt: booking.riderDropoffConfirmedAt ?? now,
            },
        });

        const remainingActiveBookings = await tx.rideBooking.count({
            where: {
                rideId: booking.rideId,
                id: { not: bookingId },
                status: { in: ACTIVE_RIDE_RESOLUTION_BOOKING_STATUSES },
            },
        });

        if (remainingActiveBookings === 0) {
            await tx.ride.update({
                where: { id: booking.rideId },
                data: {
                    status: RideStatus.COMPLETED,
                    actualEndTime: booking.ride.actualEndTime ?? now,
                },
            });
            rideCompleted = true;
        }

        if (booking.payment?.status === PAYMENT_STATUSES.HELD_IN_ESCROW) {
            await tx.payment.update({
                where: { id: booking.payment.id },
                data: {
                    status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
                    payoutEligibleAt: now,
                },
            });
            paymentMarkedEligible = true;
        }

        await tx.rideEvent.create({
            data: adminRideEventData(
                booking.rideId,
                bookingId,
                adminId,
                'ADMIN_FORCE_COMPLETED_BOOKING',
                reason,
            ),
        });

        await tx.reconciliationIssue.updateMany({
            where: {
                resolvedAt: null,
                OR: [
                    { bookingId },
                    { paymentId: booking.payment?.id ?? '__none__' },
                    {
                        metadataJson: {
                            path: ['rideId'],
                            equals: booking.rideId,
                        } as any,
                    },
                ],
            },
            data: {
                resolvedBy: adminId,
                resolvedAt: now,
                resolution: `Admin force-completed booking: ${reason}`,
            },
        });
    });

    await Promise.all([
        createNotification({
            userId: booking.passengerId,
            type: 'booking.admin_force_completed',
            title: 'Ride completed by support',
            body: 'Support reviewed this ride and marked your booking complete.',
            data: { rideId: booking.rideId, bookingId, reason, deepLink: `app://booking/${bookingId}` },
        }),
        createNotification({
            userId: booking.ride.driverId,
            type: 'booking.admin_force_completed',
            title: 'Ride completed by support',
            body: 'Support reviewed this ride and marked the booking complete.',
            data: { rideId: booking.rideId, bookingId, reason, deepLink: `app://rides/${booking.rideId}` },
        }),
    ]);

    return {
        bookingId,
        rideId: booking.rideId,
        bookingStatus: BookingStatus.COMPLETED,
        rideCompleted,
        paymentMarkedEligible,
    };
};

export const adminOpenBookingDispute = async (
    bookingId: string,
    adminId: string,
    reason: string,
    description?: string,
) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            payment: true,
            disputes: {
                where: { status: { in: OPEN_DISPUTE_STATUSES } },
                orderBy: { createdAt: 'desc' },
            },
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    status: true,
                    originAddress: true,
                    destinationAddress: true,
                },
            },
            passenger: { select: { id: true } },
        },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.disputes[0]) {
        return { dispute: booking.disputes[0], created: false };
    }
    if (TERMINAL_RIDE_RESOLUTION_BOOKING_STATUSES.includes(booking.status)) {
        throw new Error('BOOKING_ALREADY_TERMINAL');
    }

    const now = new Date();
    const route = `${booking.ride.originAddress.split(',')[0]} to ${booking.ride.destinationAddress.split(',')[0]}`;
    const disputeDescription = description?.trim()
        || `Support opened a money-resolution dispute for a stuck ride. ${reason}`;

    const dispute = await prisma.$transaction(async (tx) => {
        const created = await tx.dispute.create({
            data: {
                rideId: booking.rideId,
                bookingId,
                raisedBy: adminId,
                reason,
                description: disputeDescription,
                status: DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW,
            },
        });

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: { status: BookingStatus.DISPUTED },
        });

        if (FORCE_COMPLETABLE_RIDE_STATUSES.includes(booking.ride.status)) {
            await tx.ride.update({
                where: { id: booking.rideId },
                data: { status: RideStatus.DISPUTED },
            });
        }

        await tx.rideEvent.create({
            data: adminRideEventData(
                booking.rideId,
                bookingId,
                adminId,
                'ADMIN_OPENED_MONEY_DISPUTE',
                reason,
            ),
        });

        await tx.reconciliationIssue.create({
            data: {
                paymentId: booking.payment?.id ?? null,
                bookingId,
                issueType: 'ADMIN_MONEY_DISPUTE',
                severity: 'HIGH',
                description: `Admin opened a money-resolution dispute for ${route}. ${reason}`,
                internalState: booking.payment?.status ?? booking.status,
                metadataJson: {
                    rideId: booking.rideId,
                    bookingId,
                    paymentId: booking.payment?.id ?? null,
                    adminId,
                },
            },
        });

        await tx.reconciliationIssue.updateMany({
            where: {
                resolvedAt: null,
                issueType: { in: ['OVERDUE_RIDE_COMPLETION', 'STALE_ESCROW'] },
                OR: [
                    { bookingId },
                    { paymentId: booking.payment?.id ?? '__none__' },
                    {
                        metadataJson: {
                            path: ['rideId'],
                            equals: booking.rideId,
                        } as any,
                    },
                ],
            },
            data: {
                resolvedBy: adminId,
                resolvedAt: now,
                resolution: `Superseded by admin dispute ${created.id}: ${reason}`,
            },
        });

        return created;
    });

    await Promise.all([
        createNotification({
            userId: booking.passengerId,
            type: 'dispute.admin_opened',
            title: 'Support opened a ride review',
            body: 'Support is reviewing this ride and the payment will remain held until the case is resolved.',
            data: { disputeId: dispute.id, rideId: booking.rideId, bookingId, deepLink: `app://booking/${bookingId}` },
        }),
        createNotification({
            userId: booking.ride.driverId,
            type: 'dispute.admin_opened',
            title: 'Support opened a ride review',
            body: 'Support is reviewing this ride and the payment will remain held until the case is resolved.',
            data: { disputeId: dispute.id, rideId: booking.rideId, bookingId, deepLink: `app://rides/${booking.rideId}` },
        }),
    ]);

    return { dispute, created: true };
};

export const getOperationsSummary = async () => {
    const checks = { database: false, redis: false };
    try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = true;
    } catch {}
    try {
        await redis.ping();
        checks.redis = true;
    } catch {}

    const firebaseConfigured = Boolean(
        process.env.FIREBASE_SERVICE_ACCOUNT_JSON
        || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
        || process.env.FIREBASE_SERVICE_ACCOUNT
        || process.env.FIREBASE_SERVICE_ACCOUNT_PATH
        || process.env.GOOGLE_APPLICATION_CREDENTIALS
    );

    const [openReconciliationIssues, payoutEligiblePayments, pendingPaymentRecords, webhookEvents24h, pendingVehicles, content] = await Promise.all([
        prisma.reconciliationIssue.count({ where: { resolvedAt: null } }),
        prisma.payment.count({ where: { status: 'PAYOUT_ELIGIBLE' } }),
        prisma.payment.count({ where: { status: { in: ['CREATED', 'PAYMENT_PENDING', 'REFUND_PENDING'] } } }),
        prisma.stripeWebhookEvent.count({ where: { processedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        prisma.vehicle.count({ where: { deletedAt: null, verificationStatus: VehicleVerificationStatus.PENDING } }),
        getContentSummary(),
    ]);

    return {
        uptimeSeconds: Math.floor(process.uptime()),
        checks,
        configuration: {
            stripeSecretConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
            stripeWebhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
            firebaseConfigured,
        },
        operations: {
            openReconciliationIssues,
            payoutEligiblePayments,
            pendingPaymentRecords,
            webhookEvents24h,
            pendingVehicles,
        },
        content,
    };
};

/* ================= RIDE HISTORY ================= */
export const listRides = async (query: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
    searchBy?: string;
}) => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Prisma.RideWhereInput = {};

    if (query.status && query.status !== 'ALL') {
        where.status = query.status as RideStatus;
    }
    if (query.search) {
        const search = query.search;
        const scope = query.searchBy || 'all';
        const conditions: Prisma.RideWhereInput[] = [];
        const pushAll = () => {
            conditions.push(
                { id: { contains: search, mode: 'insensitive' } },
                { originAddress: { contains: search, mode: 'insensitive' } },
                { destinationAddress: { contains: search, mode: 'insensitive' } },
                { driver: { firstName: { contains: search, mode: 'insensitive' } } },
                { driver: { email: { contains: search, mode: 'insensitive' } } },
                { driver: { phone: { contains: search, mode: 'insensitive' } } },
                { bookings: { some: { id: { contains: search, mode: 'insensitive' } } } },
                { bookings: { some: { passengerId: { contains: search, mode: 'insensitive' } } } },
                { bookings: { some: { passenger: { firstName: { contains: search, mode: 'insensitive' } } } } },
                { bookings: { some: { passenger: { email: { contains: search, mode: 'insensitive' } } } } },
                { bookings: { some: { passenger: { phone: { contains: search, mode: 'insensitive' } } } } },
            );
        };

        switch (scope) {
            case 'rideId':
                conditions.push({ id: { contains: search, mode: 'insensitive' } });
                break;
            case 'bookingId':
                conditions.push({ bookings: { some: { id: { contains: search, mode: 'insensitive' } } } });
                break;
            case 'route':
                conditions.push(
                    { originAddress: { contains: search, mode: 'insensitive' } },
                    { destinationAddress: { contains: search, mode: 'insensitive' } },
                );
                break;
            case 'driverId':
                conditions.push({ driverId: { contains: search, mode: 'insensitive' } });
                break;
            case 'driverName':
                conditions.push({ driver: { firstName: { contains: search, mode: 'insensitive' } } });
                break;
            case 'driverEmail':
                conditions.push({ driver: { email: { contains: search, mode: 'insensitive' } } });
                break;
            case 'driverPhone':
                conditions.push({ driver: { phone: { contains: search, mode: 'insensitive' } } });
                break;
            case 'riderId':
                conditions.push({ bookings: { some: { passengerId: { contains: search, mode: 'insensitive' } } } });
                break;
            case 'riderName':
                conditions.push({ bookings: { some: { passenger: { firstName: { contains: search, mode: 'insensitive' } } } } });
                break;
            case 'riderEmail':
                conditions.push({ bookings: { some: { passenger: { email: { contains: search, mode: 'insensitive' } } } } });
                break;
            case 'riderPhone':
                conditions.push({ bookings: { some: { passenger: { phone: { contains: search, mode: 'insensitive' } } } } });
                break;
            default:
                pushAll();
                break;
        }
        where.OR = conditions;
    }

    const [rides, total] = await Promise.all([
        prisma.ride.findMany({
            where,
            skip,
            take: limit,
            orderBy: [{ departureDate: 'desc' }, { departureTime: 'desc' }],
            select: {
                id: true,
                status: true,
                originAddress: true,
                destinationAddress: true,
                departureDate: true,
                departureTime: true,
                totalSeats: true,
                availableSeats: true,
                basePricePerSeat: true,
                currency: true,
                routeDurationSeconds: true,
                actualStartTime: true,
                actualEndTime: true,
                createdAt: true,
                driver: { select: { id: true, firstName: true, email: true, phone: true } },
                bookings: {
                    select: {
                        id: true,
                        status: true,
                        passengerId: true,
                        seatsBooked: true,
                        totalPrice: true,
                        paymentAmount: true,
                        paymentCapturedAt: true,
                        completedAt: true,
                        cancelledAt: true,
                        onboardedAt: true,
                        dropoffConfirmedAt: true,
                        riderDropoffConfirmedAt: true,
                        refundedAt: true,
                        payment: {
                            select: {
                                id: true,
                                status: true,
                                amountTotal: true,
                                fareAmount: true,
                                currency: true,
                                payoutEligibleAt: true,
                            },
                        },
                        passenger: { select: { id: true, firstName: true, email: true, phone: true } },
                    },
                    orderBy: { createdAt: 'desc' },
                },
                disputes: { select: { id: true, status: true, reason: true } },
            },
        }),
        prisma.ride.count({ where }),
    ]);

    return {
        rides,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/* ================= REVENUE LEDGER ================= */
export const getRevenueLedger = async (query: {
    page?: number;
    limit?: number;
    accountType?: string;
}) => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 30));
    const skip = (page - 1) * limit;
    const where: Prisma.LedgerEntryWhereInput = {};

    if (query.accountType && query.accountType !== 'ALL') {
        where.accountType = query.accountType;
    }

    const [entries, total, platformCredits, platformDebits, riderCredits, driverCredits] = await Promise.all([
        prisma.ledgerEntry.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
        }),
        prisma.ledgerEntry.count({ where }),
        prisma.ledgerEntry.aggregate({
            where: { accountType: 'PLATFORM', direction: 'CREDIT' },
            _sum: { amount: true },
        }),
        prisma.ledgerEntry.aggregate({
            where: { accountType: 'PLATFORM', direction: 'DEBIT' },
            _sum: { amount: true },
        }),
        prisma.ledgerEntry.aggregate({
            where: { accountType: 'RIDER', direction: 'CREDIT' },
            _sum: { amount: true },
        }),
        prisma.ledgerEntry.aggregate({
            where: { accountType: 'DRIVER', direction: 'CREDIT' },
            _sum: { amount: true },
        }),
    ]);

    return {
        summary: {
            platformCredits: platformCredits._sum.amount ?? 0,
            platformDebits: platformDebits._sum.amount ?? 0,
            netPlatformRevenue: (platformCredits._sum.amount ?? 0) - (platformDebits._sum.amount ?? 0),
            riderCredits: riderCredits._sum.amount ?? 0,
            driverCredits: driverCredits._sum.amount ?? 0,
        },
        entries,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/* ================= EMERGENCY SOS ================= */
export const listEmergencyAlerts = async (query: {
    page?: number;
    limit?: number;
    status?: string;
}) => {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;
    const where: Prisma.EmergencyAlertWhereInput = {};

    if (query.status && query.status !== 'ALL') {
        where.status = query.status;
    }

    const [alerts, total, openCount] = await Promise.all([
        prisma.emergencyAlert.findMany({
            where,
            skip,
            take: limit,
            orderBy: { createdAt: 'desc' },
            select: emergencyAlertSelect,
        }),
        prisma.emergencyAlert.count({ where }),
        prisma.emergencyAlert.count({ where: { status: 'OPEN' } }),
    ]);

    return {
        alerts,
        openCount,
        pagination: {
            total,
            page,
            limit,
            totalPages: Math.ceil(total / limit),
        },
    };
};

export const updateEmergencyAlertStatus = async (
    alertId: string,
    adminId: string,
    status: 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM',
) => {
    const existing = await prisma.emergencyAlert.findUnique({ where: { id: alertId } });
    if (!existing) throw new Error('ALERT_NOT_FOUND');

    const now = new Date();
    const data: Prisma.EmergencyAlertUpdateInput = { status };
    if (status === 'ACKNOWLEDGED' && !existing.acknowledgedAt) {
        data.acknowledgedAt = now;
    }
    if (status === 'RESOLVED' || status === 'FALSE_ALARM') {
        data.resolvedAt = now;
        data.resolvedBy = adminId;
        if (!existing.acknowledgedAt) data.acknowledgedAt = now;
    }

    return prisma.emergencyAlert.update({
        where: { id: alertId },
        data,
        select: emergencyAlertSelect,
    });
};
