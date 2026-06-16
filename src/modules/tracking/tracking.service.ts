import { randomUUID, createHash } from 'crypto';
import { prisma } from '../../config/index.js';

const TRACKING_LINK_TTL_HOURS = 24;

const hashToken = (token: string): string => {
    return createHash('sha256').update(token).digest('hex');
};

const toRadians = (value: number) => value * Math.PI / 180;

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
    const earthRadius = 6371e3;
    const dLat = toRadians(b.lat - a.lat);
    const dLng = toRadians(b.lng - a.lng);
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);

    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;

    return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

const buildEta = (
    from: { lat: number; lng: number } | null,
    to: { lat: number; lng: number } | null,
    speedKmh = 35
) => {
    if (!from || !to) return null;
    const meters = Math.round(distanceMeters(from, to));
    const minutes = Math.max(1, Math.round((meters / 1000) / speedKmh * 60));
    return {
        distanceMeters: meters,
        minutes,
        label: minutes < 60
            ? `${minutes} min`
            : `${Math.floor(minutes / 60)}h ${minutes % 60}m`,
    };
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
                    pickupWaypointId: true,
                    dropoffWaypointId: true,
                    ride: {
                        select: {
                            id: true,
                            status: true,
                            originAddress: true,
                            originLat: true,
                            originLng: true,
                            destinationAddress: true,
                            destinationLat: true,
                            destinationLng: true,
                            departureDate: true,
                            departureTime: true,
                            waypoints: {
                                select: {
                                    id: true,
                                    lat: true,
                                    lng: true,
                                    estimatedArrivalTime: true,
                                },
                            },
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

    const pickupWaypoint = link.booking.pickupWaypointId
        ? link.booking.ride.waypoints.find((waypoint) => waypoint.id === link.booking.pickupWaypointId)
        : null;
    const dropoffWaypoint = link.booking.dropoffWaypointId
        ? link.booking.ride.waypoints.find((waypoint) => waypoint.id === link.booking.dropoffWaypointId)
        : null;
    const pickupPoint = pickupWaypoint
        ? { lat: pickupWaypoint.lat, lng: pickupWaypoint.lng }
        : { lat: link.booking.ride.originLat, lng: link.booking.ride.originLng };
    const dropoffPoint = dropoffWaypoint
        ? { lat: dropoffWaypoint.lat, lng: dropoffWaypoint.lng }
        : { lat: link.booking.ride.destinationLat, lng: link.booking.ride.destinationLng };
    const currentPoint = latestLocation ? { lat: latestLocation.lat, lng: latestLocation.lng } : null;

    return {
        rideId: link.booking.rideId,
        bookingId: link.booking.id,
        bookingStatus: link.booking.status,
        rideStatus: link.booking.ride.status,
        originAddress: link.booking.ride.originAddress,
        destinationAddress: link.booking.ride.destinationAddress,
        pickup: link.booking.pickupAddress,
        dropoff: link.booking.dropoffAddress,
        departureDate: link.booking.ride.departureDate,
        departureTime: link.booking.ride.departureTime,
        location: latestLocation,
        eta: {
            pickup: buildEta(currentPoint, pickupPoint),
            dropoff: buildEta(currentPoint, dropoffPoint),
            scheduledPickupTime: pickupWaypoint?.estimatedArrivalTime ?? link.booking.ride.departureTime,
            scheduledDropoffTime: dropoffWaypoint?.estimatedArrivalTime ?? null,
        },
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
