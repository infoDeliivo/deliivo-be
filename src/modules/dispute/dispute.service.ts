import { prisma } from '../../config/index.js';

// ============================================================
//  DISPUTE STATUSES
// ============================================================

export const DISPUTE_STATUSES = {
    OPEN: 'OPEN',
    EVIDENCE_COLLECTED: 'EVIDENCE_COLLECTED',
    AUTO_RESOLVED_RIDER_REFUND: 'AUTO_RESOLVED_RIDER_REFUND',
    AUTO_RESOLVED_DRIVER_PAYOUT: 'AUTO_RESOLVED_DRIVER_PAYOUT',
    NEEDS_MANUAL_REVIEW: 'NEEDS_MANUAL_REVIEW',
    WAITING_FOR_USER_RESPONSE: 'WAITING_FOR_USER_RESPONSE',
    RESOLVED_REFUND: 'RESOLVED_REFUND',
    RESOLVED_PAYOUT: 'RESOLVED_PAYOUT',
    RESOLVED_SPLIT: 'RESOLVED_SPLIT',
    ESCALATED: 'ESCALATED',
} as const;

// ============================================================
//  CREATE DISPUTE
// ============================================================

export const createDispute = async (params: {
    rideId: string;
    bookingId: string;
    raisedBy: string;
    reason: string;
    description?: string;
}) => {
    // Verify booking exists and belongs to the ride
    const booking = await prisma.rideBooking.findUnique({
        where: { id: params.bookingId },
        select: { id: true, rideId: true, passengerId: true, ride: { select: { driverId: true } } },
    });

    if (!booking) throw new Error('BOOKING_NOT_FOUND');
    if (booking.rideId !== params.rideId) throw new Error('BOOKING_RIDE_MISMATCH');

    // Only the rider or driver can raise a dispute
    if (params.raisedBy !== booking.passengerId && params.raisedBy !== booking.ride.driverId) {
        throw new Error('FORBIDDEN_DISPUTE');
    }

    // Check for existing open dispute on this booking
    const existing = await prisma.dispute.findFirst({
        where: {
            bookingId: params.bookingId,
            status: { in: [DISPUTE_STATUSES.OPEN, DISPUTE_STATUSES.EVIDENCE_COLLECTED, DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW] },
        },
    });
    if (existing) throw new Error('DISPUTE_ALREADY_EXISTS');

    const dispute = await prisma.dispute.create({
        data: {
            rideId: params.rideId,
            bookingId: params.bookingId,
            raisedBy: params.raisedBy,
            reason: params.reason,
            description: params.description ?? null,
            status: DISPUTE_STATUSES.OPEN,
        },
    });

    return dispute;
};

// ============================================================
//  EVIDENCE COLLECTOR
// ============================================================

export const collectEvidence = async (disputeId: string) => {
    const dispute = await prisma.dispute.findUnique({
        where: { id: disputeId },
        include: {
            booking: {
                select: {
                    id: true,
                    status: true,
                    pickupOtpVerifiedAt: true,
                    dropOtpVerifiedAt: true,
                    driverArrivedAt: true,
                    waitTimerStartedAt: true,
                    onboardedAt: true,
                    dropoffConfirmedAt: true,
                    riderDropoffConfirmedAt: true,
                    noShowMarkedAt: true,
                    completedAt: true,
                    createdAt: true,
                },
            },
            ride: {
                select: {
                    id: true,
                    status: true,
                    actualStartTime: true,
                    actualEndTime: true,
                },
            },
        },
    });

    if (!dispute) throw new Error('DISPUTE_NOT_FOUND');

    // Collect GPS history
    const locationHistory = await prisma.locationUpdate.findMany({
        where: { rideId: dispute.rideId },
        orderBy: { timestamp: 'asc' },
        select: { lat: true, lng: true, timestamp: true, speed: true },
    });

    // Collect ride events
    const rideEvents = await prisma.rideEvent.findMany({
        where: { rideId: dispute.rideId, bookingId: dispute.bookingId },
        orderBy: { serverTimestamp: 'asc' },
        select: { eventType: true, actorType: true, clientTimestamp: true, lat: true, lng: true },
    });

    const evidence = {
        booking: dispute.booking,
        ride: dispute.ride,
        locationHistory: {
            count: locationHistory.length,
            firstUpdate: locationHistory[0] ?? null,
            lastUpdate: locationHistory[locationHistory.length - 1] ?? null,
        },
        rideEvents: rideEvents.map(e => ({
            eventType: e.eventType,
            actorType: e.actorType,
            timestamp: e.clientTimestamp,
            hasLocation: e.lat != null,
        })),
        otpVerified: !!dispute.booking.pickupOtpVerifiedAt,
        dropoffConfirmed: !!dispute.booking.dropoffConfirmedAt,
        riderConfirmedDropoff: !!dispute.booking.riderDropoffConfirmedAt,
        noShowMarked: !!dispute.booking.noShowMarkedAt,
    };

    // Update dispute with evidence
    await prisma.dispute.update({
        where: { id: disputeId },
        data: {
            evidenceJson: evidence as any,
            status: DISPUTE_STATUSES.EVIDENCE_COLLECTED,
        },
    });

    return evidence;
};

// ============================================================
//  RULE ENGINE (auto-resolution for clear cases)
// ============================================================

export const evaluateDispute = async (disputeId: string) => {
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new Error('DISPUTE_NOT_FOUND');
    if (!dispute.evidenceJson) throw new Error('EVIDENCE_NOT_COLLECTED');

    const evidence = dispute.evidenceJson as any;
    let recommendation: string | null = null;
    let riskScore = 0.5; // neutral
    let autoResolution: string | null = null;

    // Rule 1: No-show marked but OTP was verified → driver lie, refund rider
    if (evidence.noShowMarked && evidence.otpVerified) {
        recommendation = 'REFUND_RIDER';
        riskScore = 0.9;
        autoResolution = DISPUTE_STATUSES.AUTO_RESOLVED_RIDER_REFUND;
    }
    // Rule 2: Rider confirmed dropoff → dispute invalid, payout driver
    else if (evidence.riderConfirmedDropoff) {
        recommendation = 'PAYOUT_DRIVER';
        riskScore = 0.1;
        autoResolution = DISPUTE_STATUSES.AUTO_RESOLVED_DRIVER_PAYOUT;
    }
    // Rule 3: No GPS data at all → suspicious, manual review
    else if (evidence.locationHistory?.count === 0) {
        recommendation = 'MANUAL_REVIEW';
        riskScore = 0.7;
        autoResolution = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;
    }
    // Rule 4: Dropoff confirmed by driver but not rider, and ride completed
    else if (evidence.dropoffConfirmed && !evidence.riderConfirmedDropoff && evidence.ride?.status === 'COMPLETED') {
        recommendation = 'MANUAL_REVIEW';
        riskScore = 0.5;
        autoResolution = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;
    }
    // Default: needs manual review
    else {
        recommendation = 'MANUAL_REVIEW';
        riskScore = 0.5;
        autoResolution = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;
    }

    const newStatus = autoResolution;

    await prisma.dispute.update({
        where: { id: disputeId },
        data: {
            recommendation,
            riskScore,
            status: newStatus,
            ...(newStatus.startsWith('AUTO_RESOLVED') ? { resolvedAt: new Date(), resolution: recommendation } : {}),
        },
    });

    return { disputeId, recommendation, riskScore, status: newStatus };
};

// ============================================================
//  ADMIN: RESOLVE DISPUTE
// ============================================================

export const resolveDispute = async (disputeId: string, params: {
    resolution: string; // REFUND, PAYOUT, SPLIT, ESCALATE
    resolvedBy: string;
}) => {
    const dispute = await prisma.dispute.findUnique({ where: { id: disputeId } });
    if (!dispute) throw new Error('DISPUTE_NOT_FOUND');

    const statusMap: Record<string, string> = {
        REFUND: DISPUTE_STATUSES.RESOLVED_REFUND,
        PAYOUT: DISPUTE_STATUSES.RESOLVED_PAYOUT,
        SPLIT: DISPUTE_STATUSES.RESOLVED_SPLIT,
        ESCALATE: DISPUTE_STATUSES.ESCALATED,
    };

    const newStatus = statusMap[params.resolution] ?? DISPUTE_STATUSES.ESCALATED;

    return prisma.dispute.update({
        where: { id: disputeId },
        data: {
            status: newStatus,
            resolution: params.resolution,
            resolvedBy: params.resolvedBy,
            resolvedAt: new Date(),
        },
    });
};

// ============================================================
//  QUERIES
// ============================================================

export const getDisputeById = async (disputeId: string) => {
    return prisma.dispute.findUnique({
        where: { id: disputeId },
        include: { booking: true, ride: true },
    });
};

export const listDisputes = async (params: {
    status?: string;
    page?: number;
    limit?: number;
}) => {
    const { status, page = 1, limit = 20 } = params;
    const skip = (page - 1) * limit;

    const where = status ? { status } : {};

    const [disputes, total] = await Promise.all([
        prisma.dispute.findMany({
            where,
            orderBy: [{ riskScore: 'desc' }, { createdAt: 'asc' }],
            skip,
            take: limit,
            include: {
                booking: { select: { id: true, passengerId: true, totalPrice: true } },
                ride: { select: { id: true, driverId: true, originAddress: true, destinationAddress: true } },
            },
        }),
        prisma.dispute.count({ where }),
    ]);

    return { disputes, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const getUserDisputes = async (userId: string) => {
    return prisma.dispute.findMany({
        where: { raisedBy: userId },
        orderBy: { createdAt: 'desc' },
    });
};
