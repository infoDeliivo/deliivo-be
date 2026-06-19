import { BookingStatus, Prisma, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';
import { markBookingPaymentRefunded } from '../payments/payment.service.js';
import redis from '../../cache/redis.js';

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

    const where: any = {};
    if (query.search) {
        where.OR = [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { phone: { contains: query.search, mode: 'insensitive' } },
        ];
    }
    if (typeof query.isBanned === 'boolean') {
        where.isBanned = query.isBanned;
    }
    if (query.role) {
        where.role = query.role.toUpperCase();
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
                name: true,
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

/* ================= VERIFY VEHICLE ================= */
export const verifyVehicle = async (vehicleId: string) => {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { id: true } });
    if (!vehicle) throw new Error('VEHICLE_NOT_FOUND');

    return prisma.vehicle.update({
        where: { id: vehicleId },
        data: { isVerified: true },
        select: { id: true, isVerified: true },
    });
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
                { driver: { name: { contains: search, mode: 'insensitive' } } },
                { driver: { email: { contains: search, mode: 'insensitive' } } },
                { driver: { phone: { contains: search, mode: 'insensitive' } } },
                { bookings: { some: { id: { contains: search, mode: 'insensitive' } } } },
                { bookings: { some: { passengerId: { contains: search, mode: 'insensitive' } } } },
                { bookings: { some: { passenger: { name: { contains: search, mode: 'insensitive' } } } } },
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
            case 'driverId':
                conditions.push({ driverId: { contains: search, mode: 'insensitive' } });
                break;
            case 'driverName':
                conditions.push({ driver: { name: { contains: search, mode: 'insensitive' } } });
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
                conditions.push({ bookings: { some: { passenger: { name: { contains: search, mode: 'insensitive' } } } } });
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
                driver: { select: { id: true, name: true, email: true, phone: true } },
                bookings: {
                    select: {
                        id: true,
                        status: true,
                        passengerId: true,
                        seatsBooked: true,
                        totalPrice: true,
                        paymentAmount: true,
                        refundedAt: true,
                        passenger: { select: { id: true, name: true, email: true, phone: true } },
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
