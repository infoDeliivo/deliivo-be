import { prisma } from '../../config/index.js';
import { RideStatus } from '@prisma/client';
import { ListRidesQuery } from './publish-ride.types.js';

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
                // @ts-ignore - vehicle relation exists in schema but Prisma types not updated
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

    return {
        rides,
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
            // @ts-ignore - vehicle relation exists in schema but Prisma types not updated
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

    return ride;
};

/* ================= CANCEL RIDE ================= */
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

    return prisma.ride.update({
        where: { id: rideId },
        data: { status: RideStatus.CANCELLED },
    });
};
