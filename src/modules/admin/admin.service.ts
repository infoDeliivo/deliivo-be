import { BookingStatus, Prisma, RideStatus, UserRole, VehicleVerificationStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { markBookingPaymentRefunded } from '../payments/payment.service.js';
import redis from '../../cache/redis.js';
import { getContentSummary } from '../content/content.service.js';

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
                        refundedAt: true,
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
