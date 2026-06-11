/**
 * Integration Test: Dispute & Safety (Phase 4)
 *
 * Tests:
 * - Dispute creation and validation
 * - Evidence collection
 * - Rule engine auto-resolution
 * - Admin resolution
 * - Tracking link creation, access, and revocation
 */

import { randomUUID } from 'crypto';

// ============================================================
//  IN-MEMORY STATE
// ============================================================

type MockDispute = {
    id: string;
    rideId: string;
    bookingId: string;
    raisedBy: string;
    reason: string;
    description: string | null;
    status: string;
    evidenceJson: any;
    recommendation: string | null;
    riskScore: number | null;
    resolution: string | null;
    resolvedBy: string | null;
    createdAt: Date;
    resolvedAt: Date | null;
    booking?: any;
    ride?: any;
};

type MockTrackingLink = {
    id: string;
    bookingId: string;
    token: string;
    tokenHash: string;
    expiresAt: Date;
    accessScope: string;
    createdBy: string;
    createdAt: Date;
    revokedAt: Date | null;
    booking?: any;
};

const disputes: MockDispute[] = [];
const trackingLinks: MockTrackingLink[] = [];
const locationUpdates: Array<{ rideId: string; lat: number; lng: number; timestamp: Date; speed: number | null }> = [];
const rideEvents: Array<{ rideId: string; bookingId: string | null; eventType: string; actorType: string; clientTimestamp: Date; lat: number | null; lng: number | null }> = [];

const DRIVER_ID = 'driver-d1';
const RIDER_ID = 'rider-d1';
const RIDE_ID = 'ride-d1';
const BOOKING_ID = 'booking-d1';

// ============================================================
//  MOCK PRISMA
// ============================================================

jest.mock('../../config/index.js', () => ({
    prisma: {
        rideBooking: {
            findUnique: jest.fn(({ where }) => {
                if (where.id === BOOKING_ID) {
                    return Promise.resolve({
                        id: BOOKING_ID,
                        rideId: RIDE_ID,
                        passengerId: RIDER_ID,
                        status: 'ONBOARD',
                        pickupOtpVerifiedAt: new Date(),
                        dropOtpVerifiedAt: null,
                        driverArrivedAt: new Date(),
                        waitTimerStartedAt: new Date(),
                        onboardedAt: new Date(),
                        dropoffConfirmedAt: null,
                        riderDropoffConfirmedAt: null,
                        noShowMarkedAt: null,
                        completedAt: null,
                        createdAt: new Date(),
                        ride: { driverId: DRIVER_ID, status: 'IN_PROGRESS', actualStartTime: new Date(), actualEndTime: null },
                    });
                }
                return Promise.resolve(null);
            }),
        },
        dispute: {
            create: jest.fn(({ data }) => {
                const d: MockDispute = {
                    id: randomUUID(),
                    ...data,
                    evidenceJson: null,
                    recommendation: null,
                    riskScore: null,
                    resolution: null,
                    resolvedBy: null,
                    createdAt: new Date(),
                    resolvedAt: null,
                };
                disputes.push(d);
                return Promise.resolve(d);
            }),
            findFirst: jest.fn(({ where }) => {
                const d = disputes.find(x =>
                    x.bookingId === where.bookingId &&
                    (where.status?.in ? where.status.in.includes(x.status) : true)
                );
                return Promise.resolve(d ?? null);
            }),
            findUnique: jest.fn(({ where, include }) => {
                const d = disputes.find(x => x.id === where.id);
                if (!d) return Promise.resolve(null);
                if (include?.booking || include?.ride) {
                    return Promise.resolve({
                        ...d,
                        booking: {
                            id: BOOKING_ID,
                            passengerId: RIDER_ID,
                            totalPrice: 10,
                            status: 'ONBOARD',
                            pickupOtpVerifiedAt: new Date(),
                            dropOtpVerifiedAt: null,
                            driverArrivedAt: new Date(),
                            waitTimerStartedAt: new Date(),
                            onboardedAt: new Date(),
                            dropoffConfirmedAt: null,
                            riderDropoffConfirmedAt: null,
                            noShowMarkedAt: null,
                            completedAt: null,
                            createdAt: new Date(),
                        },
                        ride: { id: RIDE_ID, driverId: DRIVER_ID, status: 'IN_PROGRESS', actualStartTime: new Date(), actualEndTime: null, originAddress: 'A', destinationAddress: 'B' },
                    });
                }
                return Promise.resolve(d);
            }),
            findMany: jest.fn(({ where }) => {
                let result = [...disputes];
                if (where?.status) result = result.filter(d => d.status === where.status);
                if (where?.raisedBy) result = result.filter(d => d.raisedBy === where.raisedBy);
                return Promise.resolve(result);
            }),
            count: jest.fn(() => Promise.resolve(disputes.length)),
            update: jest.fn(({ where, data }) => {
                const d = disputes.find(x => x.id === where.id);
                if (!d) return Promise.reject(new Error('Not found'));
                Object.assign(d, data);
                return Promise.resolve(d);
            }),
        },
        trackingLink: {
            create: jest.fn(({ data }) => {
                const link: MockTrackingLink = {
                    id: randomUUID(),
                    ...data,
                    createdAt: new Date(),
                    revokedAt: null,
                };
                trackingLinks.push(link);
                return Promise.resolve(link);
            }),
            findUnique: jest.fn(({ where, include }) => {
                let link: MockTrackingLink | undefined;
                if (where.id) link = trackingLinks.find(l => l.id === where.id);
                if (where.tokenHash) link = trackingLinks.find(l => l.tokenHash === where.tokenHash);
                if (!link) return Promise.resolve(null);
                if (include?.booking) {
                    return Promise.resolve({
                        ...link,
                        booking: {
                            id: BOOKING_ID,
                            rideId: RIDE_ID,
                            status: 'ONBOARD',
                            pickupAddress: 'Pickup St',
                            dropoffAddress: 'Dropoff Ave',
                            ride: { id: RIDE_ID, status: 'IN_PROGRESS', originAddress: 'A', destinationAddress: 'B', departureTime: '10:00' },
                        },
                    });
                }
                return Promise.resolve(link);
            }),
            findMany: jest.fn(({ where }) => {
                return Promise.resolve(
                    trackingLinks.filter(l => l.bookingId === where.bookingId && l.revokedAt === null)
                );
            }),
            update: jest.fn(({ where, data }) => {
                const link = trackingLinks.find(l => l.id === where.id);
                if (!link) return Promise.reject(new Error('Not found'));
                Object.assign(link, data);
                return Promise.resolve(link);
            }),
        },
        locationUpdate: {
            findMany: jest.fn(({ where }) => {
                return Promise.resolve(locationUpdates.filter(l => l.rideId === where.rideId));
            }),
            findFirst: jest.fn(({ where }) => {
                const matches = locationUpdates.filter(l => l.rideId === where.rideId);
                return Promise.resolve(matches[matches.length - 1] ?? null);
            }),
        },
        rideEvent: {
            findMany: jest.fn(({ where }) => {
                return Promise.resolve(
                    rideEvents.filter(e => e.rideId === where.rideId && (where.bookingId ? e.bookingId === where.bookingId : true))
                );
            }),
        },
    },
}));

// ============================================================
//  IMPORTS (after mocks)
// ============================================================

import {
    createDispute,
    collectEvidence,
    evaluateDispute,
    resolveDispute,
    getUserDisputes,
    DISPUTE_STATUSES,
} from '../dispute/dispute.service.js';
import {
    createTrackingLink,
    getTrackingData,
    revokeTrackingLink,
    listTrackingLinks,
} from '../tracking/tracking.service.js';

// ============================================================
//  DISPUTE TESTS
// ============================================================

describe('Dispute Service', () => {
    let disputeId: string;

    test('creates dispute for valid booking', async () => {
        const dispute = await createDispute({
            rideId: RIDE_ID,
            bookingId: BOOKING_ID,
            raisedBy: RIDER_ID,
            reason: 'Driver took wrong route',
            description: 'Added 15 minutes to the trip',
        });
        disputeId = dispute.id;
        expect(dispute.status).toBe('OPEN');
        expect(dispute.reason).toBe('Driver took wrong route');
    });

    test('rejects duplicate dispute on same booking', async () => {
        await expect(createDispute({
            rideId: RIDE_ID,
            bookingId: BOOKING_ID,
            raisedBy: RIDER_ID,
            reason: 'Another reason',
        })).rejects.toThrow('DISPUTE_ALREADY_EXISTS');
    });

    test('rejects dispute from unauthorized user', async () => {
        // Reset disputes for this test
        disputes.length = 0;
        await expect(createDispute({
            rideId: RIDE_ID,
            bookingId: BOOKING_ID,
            raisedBy: 'random-user',
            reason: 'Something',
        })).rejects.toThrow('FORBIDDEN_DISPUTE');
    });

    test('collects evidence', async () => {
        // Re-create the dispute
        const dispute = await createDispute({
            rideId: RIDE_ID,
            bookingId: BOOKING_ID,
            raisedBy: RIDER_ID,
            reason: 'Wrong route',
        });
        disputeId = dispute.id;

        // Add some location data
        locationUpdates.push(
            { rideId: RIDE_ID, lat: 56.9, lng: 24.1, timestamp: new Date(), speed: 60 },
            { rideId: RIDE_ID, lat: 56.95, lng: 24.15, timestamp: new Date(), speed: 55 },
        );
        rideEvents.push(
            { rideId: RIDE_ID, bookingId: BOOKING_ID, eventType: 'RIDE_STARTED', actorType: 'DRIVER', clientTimestamp: new Date(), lat: 56.9, lng: 24.1 },
        );

        const evidence = await collectEvidence(disputeId);
        expect(evidence.locationHistory.count).toBe(2);
        expect(evidence.otpVerified).toBe(true);
        expect(evidence.rideEvents.length).toBe(1);
    });

    test('evaluates dispute with rule engine', async () => {
        const result = await evaluateDispute(disputeId);
        expect(result.recommendation).toBeDefined();
        expect(result.riskScore).toBeDefined();
        expect(typeof result.riskScore).toBe('number');
    });

    test('admin resolves dispute', async () => {
        const resolved = await resolveDispute(disputeId, {
            resolution: 'SPLIT',
            resolvedBy: 'admin-001',
        });
        expect(resolved.status).toBe(DISPUTE_STATUSES.RESOLVED_SPLIT);
        expect(resolved.resolvedAt).toBeDefined();
        expect(resolved.resolvedBy).toBe('admin-001');
    });

    test('lists user disputes', async () => {
        const userDisputes = await getUserDisputes(RIDER_ID);
        expect(userDisputes.length).toBeGreaterThan(0);
    });
});

// ============================================================
//  RULE ENGINE AUTO-RESOLUTION TESTS
// ============================================================

describe('Dispute Rule Engine', () => {
    test('auto-resolves no-show with OTP verified as rider refund', async () => {
        // Create dispute where no-show was marked but OTP was verified
        disputes.length = 0;
        const d = await createDispute({
            rideId: RIDE_ID,
            bookingId: BOOKING_ID,
            raisedBy: RIDER_ID,
            reason: 'Marked no-show after I boarded',
        });

        // Manually set evidence with noShowMarked + otpVerified
        const mockEvidence = {
            noShowMarked: true,
            otpVerified: true,
            riderConfirmedDropoff: false,
            dropoffConfirmed: false,
            locationHistory: { count: 5 },
            ride: { status: 'COMPLETED' },
        };
        disputes[0].evidenceJson = mockEvidence;
        disputes[0].status = 'EVIDENCE_COLLECTED';

        const result = await evaluateDispute(d.id);
        expect(result.recommendation).toBe('REFUND_RIDER');
        expect(result.riskScore).toBe(0.9);
        expect(result.status).toBe(DISPUTE_STATUSES.AUTO_RESOLVED_RIDER_REFUND);
    });
});

// ============================================================
//  TRACKING LINK TESTS
// ============================================================

describe('Tracking Links', () => {
    let linkToken: string;
    let linkId: string;

    test('creates tracking link for active booking', async () => {
        const result = await createTrackingLink({
            bookingId: BOOKING_ID,
            createdBy: RIDER_ID,
        });
        linkToken = result.token;
        linkId = result.id;
        expect(result.trackingUrl).toContain(linkToken);
        expect(result.accessScope).toBe('LOCATION_ONLY');
    });

    test('retrieves tracking data by token', async () => {
        const data = await getTrackingData(linkToken);
        expect(data.bookingStatus).toBe('ONBOARD');
        expect(data.pickup).toBe('Pickup St');
        expect(data.dropoff).toBe('Dropoff Ave');
    });

    test('lists tracking links for a booking', async () => {
        const links = await listTrackingLinks(BOOKING_ID, RIDER_ID);
        expect(links.length).toBeGreaterThan(0);
    });

    test('revokes tracking link', async () => {
        await revokeTrackingLink(linkId, RIDER_ID);
        const link = trackingLinks.find(l => l.id === linkId);
        expect(link!.revokedAt).toBeDefined();
    });

    test('rejects access to revoked link', async () => {
        await expect(getTrackingData(linkToken)).rejects.toThrow('TRACKING_LINK_REVOKED');
    });

    test('rejects access to expired link', async () => {
        // Create a link that's already expired
        const expiredLink: MockTrackingLink = {
            id: randomUUID(),
            bookingId: BOOKING_ID,
            token: 'expired-token',
            tokenHash: require('crypto').createHash('sha256').update('expired-token').digest('hex'),
            expiresAt: new Date(Date.now() - 1000), // expired
            accessScope: 'LOCATION_ONLY',
            createdBy: RIDER_ID,
            createdAt: new Date(),
            revokedAt: null,
        };
        trackingLinks.push(expiredLink);

        await expect(getTrackingData('expired-token')).rejects.toThrow('TRACKING_LINK_EXPIRED');
    });

    test('rejects tracking link creation from non-passenger', async () => {
        await expect(createTrackingLink({
            bookingId: BOOKING_ID,
            createdBy: 'stranger-id',
        })).rejects.toThrow('FORBIDDEN');
    });
});
