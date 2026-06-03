import { BookingStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';
import { toMinorCurrencyUnits } from '../ride-booking/booking-cancellation-policy.js';

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

    return prisma.user.update({
        where: { id: userId },
        data: { isBanned },
        select: { id: true, isBanned: true },
    });
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

    return { bookingId, refunded: true };
};
