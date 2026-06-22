import { prisma } from '../../config/index.js';
import { DISPUTE_STATUSES, OPEN_DISPUTE_STATUSES } from './dispute.constants.js';
import { createNotification } from '../notification/notification.service.js';
import { emitToUsers } from '../../socket/index.js';

export { DISPUTE_STATUSES };

type DisputeRideEventEvidence = {
    eventType: string;
    actorType: string;
    actorId: string;
    timestamp: string;
    hasLocation: boolean;
    lat: number | null;
    lng: number | null;
    validationStatus: string;
    isManualOverride: boolean;
};

type DisputeEvidenceFactor = {
    key: string;
    label: string;
    passed: boolean;
    weight: number;
    detail: string;
};

const MANUAL_OVERRIDE_EVENT_HINTS = ['MANUAL', 'OVERRIDE', 'FALLBACK', 'SUPPORT', 'DEV'];

const isManualOverrideEvent = (eventType: string, metadataJson: unknown) => {
    const upperEventType = String(eventType || '').toUpperCase();
    if (MANUAL_OVERRIDE_EVENT_HINTS.some((hint) => upperEventType.includes(hint))) {
        return true;
    }

    if (!metadataJson || typeof metadataJson !== 'object') {
        return false;
    }

    const metadata = metadataJson as Record<string, unknown>;
    return Boolean(metadata.manualOverride || metadata.supportOverride || metadata.simulation || metadata.overrideReason);
};

const toIsoString = (value: Date | string | null | undefined) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const buildEvidenceFactor = (
    key: string,
    label: string,
    passed: boolean,
    weight: number,
    detail: string
): DisputeEvidenceFactor => ({
    key,
    label,
    passed,
    weight,
    detail,
});

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
        select: {
            id: true,
            rideId: true,
            passengerId: true,
            ride: {
                select: {
                    driverId: true,
                    originAddress: true,
                    destinationAddress: true,
                },
            },
        },
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
            status: { in: OPEN_DISPUTE_STATUSES },
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

    const otherPartyId = params.raisedBy === booking.passengerId
        ? booking.ride.driverId
        : booking.passengerId;
    const route = `${booking.ride.originAddress.split(',')[0]} to ${booking.ride.destinationAddress.split(',')[0]}`;

    await createNotification({
        userId: otherPartyId,
        type: 'dispute.created',
        title: 'New dispute opened',
        body: `A dispute was opened for ${route}.`,
        data: {
            disputeId: dispute.id,
            bookingId: booking.id,
            rideId: booking.rideId,
            reason: params.reason,
            deepLink: `app://booking/${booking.id}`,
        },
    });

    await emitToUsers([booking.passengerId, booking.ride.driverId], 'dispute:updated', {
        disputeId: dispute.id,
        bookingId: booking.id,
        rideId: booking.rideId,
        status: dispute.status,
        reason: dispute.reason,
        raisedBy: dispute.raisedBy,
        updatedAt: dispute.createdAt.toISOString(),
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
                    passengerId: true,
                    pickupOtpVerifiedAt: true,
                    dropOtpVerifiedAt: true,
                    driverArrivedAt: true,
                    waitTimerStartedAt: true,
                    onboardedAt: true,
                    dropoffConfirmedAt: true,
                    riderDropoffConfirmedAt: true,
                    noShowMarkedAt: true,
                    cancelledAt: true,
                    cancelledByRole: true,
                    cancellationReason: true,
                    driverDecisionDeadlineAt: true,
                    driverDecisionAt: true,
                    deadlineExpiredNotifiedAt: true,
                    deadlineExtendedAt: true,
                    autoCancelledAt: true,
                    completedAt: true,
                    createdAt: true,
                },
            },
            ride: {
                select: {
                    id: true,
                    status: true,
                    driverId: true,
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
        select: { eventType: true, actorType: true, actorId: true, clientTimestamp: true, lat: true, lng: true, validationStatus: true, metadataJson: true },
    });

    const riderGpsEvents = rideEvents.filter((event) => event.actorType === 'RIDER' && event.lat != null && event.lng != null);
    const manualOverrideEvents = rideEvents.filter((event) => isManualOverrideEvent(event.eventType, event.metadataJson));

    const evidence = {
        booking: dispute.booking,
        ride: dispute.ride,
        signalSummary: {
            driverGpsCount: locationHistory.length,
            riderGpsCount: riderGpsEvents.length,
            manualOverrideCount: manualOverrideEvents.length,
            rideEventCount: rideEvents.length,
            hasGpsSignals: locationHistory.length > 0 || riderGpsEvents.length > 0,
        },
        locationHistory: {
            count: locationHistory.length,
            firstUpdate: locationHistory[0] ?? null,
            lastUpdate: locationHistory[locationHistory.length - 1] ?? null,
        },
        driverGps: {
            count: locationHistory.length,
            firstUpdate: locationHistory[0] ?? null,
            lastUpdate: locationHistory[locationHistory.length - 1] ?? null,
            latestPosition: locationHistory[locationHistory.length - 1]
                ? {
                    lat: locationHistory[locationHistory.length - 1].lat,
                    lng: locationHistory[locationHistory.length - 1].lng,
                    timestamp: locationHistory[locationHistory.length - 1].timestamp,
                }
                : null,
        },
        riderGps: {
            count: riderGpsEvents.length,
            firstUpdate: riderGpsEvents[0] ?? null,
            lastUpdate: riderGpsEvents[riderGpsEvents.length - 1] ?? null,
            latestPosition: riderGpsEvents[riderGpsEvents.length - 1]
                ? {
                    lat: riderGpsEvents[riderGpsEvents.length - 1].lat,
                    lng: riderGpsEvents[riderGpsEvents.length - 1].lng,
                    timestamp: riderGpsEvents[riderGpsEvents.length - 1].clientTimestamp,
                }
                : null,
        },
        manualOverrides: {
            count: manualOverrideEvents.length,
            events: manualOverrideEvents.map((event) => ({
                eventType: event.eventType,
                actorType: event.actorType,
                actorId: event.actorId,
                timestamp: toIsoString(event.clientTimestamp),
                validationStatus: event.validationStatus,
                hasLocation: event.lat != null && event.lng != null,
                metadata: event.metadataJson ?? null,
            })),
        },
        rideEvents: rideEvents.map((e) => ({
            eventType: e.eventType,
            actorType: e.actorType,
            actorId: e.actorId,
            timestamp: toIsoString(e.clientTimestamp),
            hasLocation: e.lat != null,
            lat: e.lat,
            lng: e.lng,
            validationStatus: e.validationStatus,
            isManualOverride: isManualOverrideEvent(e.eventType, e.metadataJson),
        })),
        otpVerified: !!dispute.booking.pickupOtpVerifiedAt,
        dropoffConfirmed: !!dispute.booking.dropoffConfirmedAt,
        riderConfirmedDropoff: !!dispute.booking.riderDropoffConfirmedAt,
        noShowMarked: !!dispute.booking.noShowMarkedAt,
        bookingSnapshot: {
            status: dispute.booking.status,
            passengerId: dispute.booking.passengerId,
            pickupOtpVerifiedAt: dispute.booking.pickupOtpVerifiedAt,
            dropOtpVerifiedAt: dispute.booking.dropOtpVerifiedAt,
            driverArrivedAt: dispute.booking.driverArrivedAt,
            waitTimerStartedAt: dispute.booking.waitTimerStartedAt,
            onboardedAt: dispute.booking.onboardedAt,
            dropoffConfirmedAt: dispute.booking.dropoffConfirmedAt,
            riderDropoffConfirmedAt: dispute.booking.riderDropoffConfirmedAt,
            noShowMarkedAt: dispute.booking.noShowMarkedAt,
            cancelledAt: dispute.booking.cancelledAt,
            cancelledByRole: dispute.booking.cancelledByRole,
            cancellationReason: dispute.booking.cancellationReason,
            driverDecisionDeadlineAt: dispute.booking.driverDecisionDeadlineAt,
            driverDecisionAt: dispute.booking.driverDecisionAt,
            deadlineExpiredNotifiedAt: dispute.booking.deadlineExpiredNotifiedAt,
            deadlineExtendedAt: dispute.booking.deadlineExtendedAt,
            autoCancelledAt: dispute.booking.autoCancelledAt,
            completedAt: dispute.booking.completedAt,
            createdAt: dispute.booking.createdAt,
        },
        factorSummary: [
            buildEvidenceFactor(
                'driver_gps',
                'Driver GPS history',
                locationHistory.length > 0,
                locationHistory.length > 0 ? 20 : -20,
                locationHistory.length > 0
                    ? `${locationHistory.length} driver location updates recorded.`
                    : 'No driver location history was captured for the ride.'
            ),
            buildEvidenceFactor(
                'rider_gps',
                'Rider GPS evidence',
                riderGpsEvents.length > 0,
                riderGpsEvents.length > 0 ? 10 : -10,
                riderGpsEvents.length > 0
                    ? `${riderGpsEvents.length} rider-side location-marking events recorded.`
                    : 'No rider-side GPS evidence was recorded.'
            ),
            buildEvidenceFactor(
                'manual_override',
                'Manual override signals',
                manualOverrideEvents.length > 0,
                manualOverrideEvents.length > 0 ? -15 : 5,
                manualOverrideEvents.length > 0
                    ? `${manualOverrideEvents.length} manual or fallback actions were recorded and must be reviewed with the ride evidence.`
                    : 'No manual override actions were recorded.'
            ),
            buildEvidenceFactor(
                'otp',
                'Pickup OTP evidence',
                !!dispute.booking.pickupOtpVerifiedAt,
                dispute.booking.pickupOtpVerifiedAt ? 20 : -5,
                dispute.booking.pickupOtpVerifiedAt
                    ? 'Pickup OTP was verified before the ride progressed.'
                    : 'Pickup OTP was not verified.'
            ),
            buildEvidenceFactor(
                'dropoff_confirmation',
                'Drop-off confirmation',
                !!dispute.booking.riderDropoffConfirmedAt || !!dispute.booking.dropoffConfirmedAt,
                (dispute.booking.riderDropoffConfirmedAt || dispute.booking.dropoffConfirmedAt) ? 20 : -5,
                dispute.booking.riderDropoffConfirmedAt
                    ? 'Rider confirmed drop-off.'
                    : dispute.booking.dropoffConfirmedAt
                        ? 'Driver marked the drop-off.'
                        : 'No drop-off confirmation exists yet.'
            ),
            buildEvidenceFactor(
                'no_show',
                'No-show evidence',
                !!dispute.booking.noShowMarkedAt,
                dispute.booking.noShowMarkedAt ? -10 : 5,
                dispute.booking.noShowMarkedAt
                    ? 'Booking was marked as no-show.'
                    : 'No no-show mark was recorded.'
            ),
        ],
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
    const driverGpsCount = Number(evidence.locationHistory?.count ?? evidence.driverGps?.count ?? 0);
    const riderGpsCount = Number(evidence.riderGps?.count ?? 0);
    const manualOverrideCount = Number(evidence.manualOverrides?.count ?? 0);
    const hasGpsSignals = driverGpsCount > 0 || riderGpsCount > 0;
    const hasStrongGpsSignals = driverGpsCount > 0 && riderGpsCount > 0;
    const rideCompleted = evidence.ride?.status === 'COMPLETED' || !!evidence.bookingSnapshot?.completedAt;
    const riderDropoffConfirmed = Boolean(evidence.riderConfirmedDropoff || evidence.bookingSnapshot?.riderDropoffConfirmedAt);
    const driverDropoffConfirmed = Boolean(evidence.dropoffConfirmed || evidence.bookingSnapshot?.dropoffConfirmedAt);
    const pickupOtpVerified = Boolean(evidence.otpVerified || evidence.bookingSnapshot?.pickupOtpVerifiedAt);
    const noShowMarked = Boolean(evidence.noShowMarked || evidence.bookingSnapshot?.noShowMarkedAt);

    const factors = Array.isArray(evidence.factorSummary)
        ? [...evidence.factorSummary]
        : [];

    let riskScore = 0.5;
    if (hasStrongGpsSignals) {
        riskScore -= 0.18;
    } else if (hasGpsSignals) {
        riskScore -= 0.08;
    } else {
        riskScore += 0.15;
    }

    if (manualOverrideCount > 0) {
        riskScore += Math.min(0.2, 0.08 + manualOverrideCount * 0.03);
    }

    if (pickupOtpVerified) {
        riskScore += 0.1;
    }

    if (riderDropoffConfirmed) {
        riskScore -= 0.28;
    }

    if (driverDropoffConfirmed && rideCompleted) {
        riskScore -= 0.12;
    }

    if (noShowMarked && pickupOtpVerified) {
        riskScore += 0.25;
    }

    riskScore = Math.min(1, Math.max(0, Number(riskScore.toFixed(2))));

    let recommendation: string = 'MANUAL_REVIEW';
    let autoResolution: string = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;

    // High-confidence rider loss: no-show mark after a verified pickup.
    if (noShowMarked && pickupOtpVerified) {
        recommendation = 'REFUND_RIDER';
        autoResolution = DISPUTE_STATUSES.AUTO_RESOLVED_RIDER_REFUND;
    }
    // High-confidence driver win: rider confirmed dropoff and the ride is supported by state or GPS.
    else if (riderDropoffConfirmed && (rideCompleted || driverDropoffConfirmed || hasStrongGpsSignals)) {
        recommendation = 'PAYOUT_DRIVER';
        autoResolution = DISPUTE_STATUSES.AUTO_RESOLVED_DRIVER_PAYOUT;
    }
    // Manual override evidence should never be ignored; if it is the only signal, keep the dispute in review.
    else if (manualOverrideCount > 0 && !hasStrongGpsSignals) {
        recommendation = 'MANUAL_REVIEW';
        autoResolution = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;
    }
    // No GPS at all is not sufficient to auto-resolve unless a stronger booking signal exists.
    else if (!hasGpsSignals) {
        recommendation = 'MANUAL_REVIEW';
        autoResolution = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;
    }
    // Driver confirmed dropoff but rider did not, and the ride is completed: keep it reviewable.
    else if (driverDropoffConfirmed && !riderDropoffConfirmed && rideCompleted) {
        recommendation = 'MANUAL_REVIEW';
        autoResolution = DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW;
    }

    factors.unshift(
        buildEvidenceFactor(
            'evaluation_path',
            'Evaluation path',
            autoResolution !== DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW,
            autoResolution !== DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW ? 25 : 0,
            autoResolution === DISPUTE_STATUSES.AUTO_RESOLVED_RIDER_REFUND
                ? 'Dispute auto-resolved in favor of the rider.'
                : autoResolution === DISPUTE_STATUSES.AUTO_RESOLVED_DRIVER_PAYOUT
                    ? 'Dispute auto-resolved in favor of the driver.'
                    : 'The dispute remains in manual review.'
        )
    );

    await prisma.dispute.update({
        where: { id: disputeId },
        data: {
            recommendation,
            riskScore,
            status: autoResolution,
            evidenceJson: {
                ...evidence,
                evaluation: {
                    recommendation,
                    riskScore,
                    status: autoResolution,
                    evaluatedAt: new Date().toISOString(),
                    factors,
                },
            },
            ...(autoResolution.startsWith('AUTO_RESOLVED') ? { resolvedAt: new Date(), resolution: recommendation } : {}),
        },
    });

    return { disputeId, recommendation, riskScore, status: autoResolution, factors };
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
        include: {
            booking: {
                include: {
                    passenger: { select: { id: true, name: true, avatarUrl: true } },
                    payment: true,
                },
            },
            ride: true,
        },
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
                booking: { select: { id: true, passengerId: true, totalPrice: true, status: true, payment: true } },
                ride: { select: { id: true, driverId: true, originAddress: true, destinationAddress: true } },
            },
        }),
        prisma.dispute.count({ where }),
    ]);

    return { disputes, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

export const getUserDisputes = async (userId: string) => {
    return prisma.dispute.findMany({
        where: {
            OR: [
                { raisedBy: userId },
                { booking: { passengerId: userId } },
                { ride: { driverId: userId } },
            ],
        },
        orderBy: { createdAt: 'desc' },
        include: {
            booking: { select: { id: true, passengerId: true, totalPrice: true, status: true } },
            ride: { select: { id: true, driverId: true, originAddress: true, destinationAddress: true, departureDate: true, departureTime: true } },
        },
    });
};
