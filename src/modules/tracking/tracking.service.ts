import { randomUUID, createHash } from 'crypto';
import { prisma } from '../../config/index.js';

const TRACKING_LINK_TTL_HOURS = 24;

const hashToken = (token: string): string => {
    return createHash('sha256').update(token).digest('hex');
};

// ============================================================
//  CREATE TRACKING LINK
// ============================================================

export const createTrackingLink = async (params: {
    bookingId: string;
    createdBy: string;
    accessScope?: string;
    ttlHours?: number;
}) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: params.bookingId },
        select: { id: true, passengerId: true, rideId: true, status: true },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.passengerId !== params.createdBy) throw new Error('FORBIDDEN');

    // Only allow tracking for active rides
    const activeStatuses = ['CONFIRMED', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED', 'ONBOARD', 'IN_PROGRESS'];
    if (!activeStatuses.includes(booking.status)) {
        throw new Error('BOOKING_NOT_TRACKABLE');
    }

    const token = randomUUID();
    const ttl = params.ttlHours ?? TRACKING_LINK_TTL_HOURS;

    const link = await prisma.trackingLink.create({
        data: {
            bookingId: params.bookingId,
            token,
            tokenHash: hashToken(token),
            expiresAt: new Date(Date.now() + ttl * 60 * 60 * 1000),
            accessScope: params.accessScope ?? 'LOCATION_ONLY',
            createdBy: params.createdBy,
        },
    });

    return {
        id: link.id,
        token: link.token,
        expiresAt: link.expiresAt,
        accessScope: link.accessScope,
        trackingUrl: `/tracking/${token}`,
    };
};

// ============================================================
//  GET TRACKING DATA (public, no auth)
// ============================================================

export const getTrackingData = async (token: string) => {
    const tokenH = hashToken(token);

    const link = await prisma.trackingLink.findUnique({
        where: { tokenHash: tokenH },
        include: {
            booking: {
                select: {
                    id: true,
                    rideId: true,
                    status: true,
                    pickupAddress: true,
                    dropoffAddress: true,
                    ride: {
                        select: {
                            id: true,
                            status: true,
                            originAddress: true,
                            destinationAddress: true,
                            departureTime: true,
                        },
                    },
                },
            },
        },
    });

    if (!link) throw new Error('TRACKING_LINK_NOT_FOUND');
    if (link.revokedAt) throw new Error('TRACKING_LINK_REVOKED');
    if (link.expiresAt < new Date()) throw new Error('TRACKING_LINK_EXPIRED');

    // Get latest location
    const latestLocation = await prisma.locationUpdate.findFirst({
        where: { rideId: link.booking.rideId },
        orderBy: { timestamp: 'desc' },
        select: { lat: true, lng: true, speed: true, heading: true, timestamp: true },
    });

    return {
        bookingStatus: link.booking.status,
        rideStatus: link.booking.ride.status,
        pickup: link.booking.pickupAddress,
        dropoff: link.booking.dropoffAddress,
        departureTime: link.booking.ride.departureTime,
        location: latestLocation,
        accessScope: link.accessScope,
    };
};

// ============================================================
//  REVOKE TRACKING LINK
// ============================================================

export const revokeTrackingLink = async (linkId: string, userId: string) => {
    const link = await prisma.trackingLink.findUnique({
        where: { id: linkId },
        select: { id: true, createdBy: true },
    });

    if (!link) throw new Error('TRACKING_LINK_NOT_FOUND');
    if (link.createdBy !== userId) throw new Error('FORBIDDEN');

    return prisma.trackingLink.update({
        where: { id: linkId },
        data: { revokedAt: new Date() },
    });
};

// ============================================================
//  LIST BOOKING TRACKING LINKS
// ============================================================

export const listTrackingLinks = async (bookingId: string, userId: string) => {
    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        select: { passengerId: true },
    });

    if (!booking || booking.passengerId !== userId) throw new Error('FORBIDDEN');

    return prisma.trackingLink.findMany({
        where: { bookingId, revokedAt: null },
        select: { id: true, token: true, expiresAt: true, accessScope: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
    });
};
