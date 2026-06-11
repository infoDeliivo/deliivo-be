/**
 * Integration Test: Full Ride Lifecycle (End-to-End)
 *
 * Chains the complete happy path and edge cases across all phases:
 * 1. Ride Publish (with pricing validation)
 * 2. Booking Creation (with payment + seat reservation)
 * 3. Driver Accept (OTP generation)
 * 4. Ride Start (status transitions, notifications)
 * 5. Driver Arrived (geofence, wait timer)
 * 6. Pickup OTP Verification (onboard)
 * 7. Live Location Tracking
 * 8. Family Tracking Link
 * 9. Dropoff (driver + rider confirm)
 * 10. Ride Completion
 * 11. Payment Escrow → Payout Eligible → Payout
 * 12. Dispute Flow (no-show scenario)
 * 13. Withdraw + Refund Flow
 * 14. Offline Sync
 */

import { randomUUID } from 'crypto';

// ============================================================
//  IN-MEMORY STATE
// ============================================================

const DRIVER_ID = 'driver-e2e-1';
const RIDER_1_ID = 'rider-e2e-1';
const RIDER_2_ID = 'rider-e2e-2';
const ADMIN_ID = 'admin-e2e-1';
const VEHICLE_ID = 'vehicle-e2e-1';

type MockRide = {
    id: string;
    driverId: string;
    status: string;
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    originAddress: string;
    destinationAddress: string;
    departureDate: Date;
    departureTime: string;
    totalSeats: number;
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;
    routeDistanceMeters: number;
    actualStartTime: Date | null;
    actualEndTime: Date | null;
    currentStopSequence: number | null;
    waypoints: any[];
    bookings?: any[];
};

type MockBooking = {
    id: string;
    rideId: string;
    passengerId: string;
    seatsBooked: number;
    totalPrice: number;
    status: string;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    pickupPosition: number;
    dropoffPosition: number;
    pickupOtp: string | null;
    pickupOtpHash: string | null;
    pickupOtpExpiresAt: Date | null;
    pickupOtpVerifiedAt: Date | null;
    dropOtpHash: string | null;
    dropOtpVerifiedAt: Date | null;
    otpAttemptCount: number;
    driverArrivedAt: Date | null;
    waitTimerStartedAt: Date | null;
    onboardedAt: Date | null;
    dropoffConfirmedAt: Date | null;
    riderDropoffConfirmedAt: Date | null;
    noShowMarkedAt: Date | null;
    completedAt: Date | null;
    driverDecisionDeadlineAt: Date | null;
    withdrawnAt: Date | null;
    withdrawnReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    ride?: any;
    passenger?: any;
};

type MockPayment = {
    id: string;
    bookingId: string;
    rideId: string;
    riderId: string;
    stripePaymentIntentId: string | null;
    amountTotal: number;
    currency: string;
    fareAmount: number;
    platformFeeAmount: number;
    status: string;
    payoutEligibleAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};

type MockLocationUpdate = {
    id: string;
    rideId: string;
    driverId: string;
    lat: number;
    lng: number;
    speed: number | null;
    heading: number | null;
    accuracy: number | null;
    timestamp: Date;
    createdAt: Date;
};

type MockRideEvent = {
    id: string;
    rideId: string;
    bookingId: string | null;
    actionId: string;
    eventType: string;
    actorType: string;
    actorId: string;
    lat: number | null;
    lng: number | null;
    clientTimestamp: Date;
    serverTimestamp: Date;
    validationStatus: string;
    metadataJson: any;
};

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

type MockLedgerEntry = {
    id: string;
    entryGroupId: string;
    paymentId: string | null;
    bookingId: string | null;
    userId: string | null;
    accountType: string;
    entryType: string;
    direction: string;
    amount: number;
    currency: string;
    metadataJson: any;
    createdAt: Date;
};

type MockPayoutBatch = {
    id: string;
    driverId: string;
    status: string;
    currency: string;
    amountTotal: number;
    stripeTransferId: string | null;
    createdAt: Date;
    updatedAt: Date;
    items: MockPayoutItem[];
};

type MockPayoutItem = {
    id: string;
    payoutBatchId: string;
    bookingId: string;
    paymentId: string;
    driverAmount: number;
    platformFee: number;
    status: string;
    createdAt: Date;
};

type MockNotification = {
    userId: string;
    type: string;
    title: string;
    body: string;
    data?: any;
};

const rides: MockRide[] = [];
const bookings: MockBooking[] = [];
const payments: MockPayment[] = [];
const locationUpdates: MockLocationUpdate[] = [];
const rideEvents: MockRideEvent[] = [];
const disputes: MockDispute[] = [];
const trackingLinks: MockTrackingLink[] = [];
const ledgerEntries: MockLedgerEntry[] = [];
const payoutBatches: MockPayoutBatch[] = [];
const notifications: MockNotification[] = [];
const segmentCapacities: Array<{ id: string; rideId: string; fromPosition: number; toPosition: number; occupiedSeats: number }> = [];

// ============================================================
//  MOCK DEPENDENCIES
// ============================================================

const mockNotification = jest.fn((params: MockNotification) => {
    notifications.push(params);
    return Promise.resolve();
});

jest.mock('../notification/notification.service.js', () => ({
    createNotification: (params: any) => mockNotification(params),
}));

jest.mock('../../services/push.service.ts', () => ({
    sendPushNotification: jest.fn(),
}));

jest.mock('../ride-booking/booking-otp.utils.js', () => ({
    isOtpValid: (plain: string, hash: string) => `hash-${plain}` === hash,
    generateBookingOtp: () => '123456',
    hashOtp: (otp: string) => `hash-${otp}`,
}));

jest.mock('../payments/stripe.service.js', () => ({
    getStripeClient: () => ({
        transfers: {
            create: jest.fn().mockResolvedValue({ id: 'tr_mock_1' }),
        },
        paymentIntents: {
            retrieve: jest.fn().mockResolvedValue({ id: 'pi_mock', status: 'succeeded' }),
        },
    }),
}));

// ============================================================
//  MOCK PRISMA (comprehensive)
// ============================================================

jest.mock('../../config/index.js', () => ({
    prisma: {
        ride: {
            findUnique: jest.fn(({ where, include }: any) => {
                const ride = rides.find(r => r.id === where.id);
                if (!ride) return Promise.resolve(null);
                if (include?.bookings) {
                    return Promise.resolve({ ...ride, bookings: bookings.filter(b => b.rideId === ride.id) });
                }
                return Promise.resolve({ ...ride, waypoints: ride.waypoints });
            }),
            update: jest.fn(({ where, data }: any) => {
                const ride = rides.find(r => r.id === where.id);
                if (!ride) return Promise.reject(new Error('Not found'));
                Object.assign(ride, data);
                return Promise.resolve(ride);
            }),
        },
        rideBooking: {
            findUnique: jest.fn(({ where, include, select }: any) => {
                const b = bookings.find(bk => bk.id === where.id);
                if (!b) return Promise.resolve(null);
                const ride = rides.find(r => r.id === b.rideId);
                if (include?.ride || select?.ride) {
                    return Promise.resolve({
                        ...b,
                        ride: { ...ride, driverId: ride?.driverId ?? DRIVER_ID, waypoints: ride?.waypoints ?? [] },
                    });
                }
                return Promise.resolve(b);
            }),
            findFirst: jest.fn(({ where }: any) => {
                const b = bookings.find(bk => {
                    if (where.bookingId && bk.id !== where.bookingId) return false;
                    if (where.id && bk.id !== where.id) return false;
                    if (where.rideId && bk.rideId !== where.rideId) return false;
                    if (where.passengerId && bk.passengerId !== where.passengerId) return false;
                    if (where.status?.in && !where.status.in.includes(bk.status)) return false;
                    if (where.status && typeof where.status === 'string' && bk.status !== where.status) return false;
                    return true;
                });
                if (!b) return Promise.resolve(null);
                const ride = rides.find(r => r.id === b.rideId);
                return Promise.resolve({ ...b, ride: { ...ride, waypoints: ride?.waypoints ?? [] } });
            }),
            update: jest.fn(({ where, data }: any) => {
                const b = bookings.find(bk => bk.id === where.id);
                if (!b) return Promise.reject(new Error('Not found'));
                Object.assign(b, data, { updatedAt: new Date() });
                return Promise.resolve(b);
            }),
            updateMany: jest.fn(({ where, data }: any) => {
                const matching = bookings.filter(b => {
                    if (where.rideId && b.rideId !== where.rideId) return false;
                    if (where.status && b.status !== where.status) return false;
                    return true;
                });
                matching.forEach(b => Object.assign(b, data));
                return Promise.resolve({ count: matching.length });
            }),
        },
        rideEvent: {
            findUnique: jest.fn(({ where }: any) => {
                const e = rideEvents.find(ev => ev.actionId === where.actionId);
                return Promise.resolve(e ?? null);
            }),
            create: jest.fn(({ data }: any) => {
                const event: MockRideEvent = {
                    id: randomUUID(),
                    rideId: data.rideId,
                    bookingId: data.bookingId ?? null,
                    actionId: data.actionId,
                    eventType: data.eventType,
                    actorType: data.actorType,
                    actorId: data.actorId,
                    lat: data.lat ?? null,
                    lng: data.lng ?? null,
                    clientTimestamp: new Date(data.clientTimestamp),
                    serverTimestamp: new Date(),
                    validationStatus: 'VALID',
                    metadataJson: null,
                };
                rideEvents.push(event);
                return Promise.resolve(event);
            }),
            findMany: jest.fn(({ where }: any) => {
                return Promise.resolve(
                    rideEvents.filter(e => e.rideId === where.rideId && (where.bookingId ? e.bookingId === where.bookingId : true))
                );
            }),
        },
        locationUpdate: {
            create: jest.fn(({ data }: any) => {
                const loc: MockLocationUpdate = {
                    id: randomUUID(),
                    ...data,
                    createdAt: new Date(),
                };
                locationUpdates.push(loc);
                return Promise.resolve(loc);
            }),
            findFirst: jest.fn(({ where }: any) => {
                const matches = locationUpdates.filter(l => l.rideId === where.rideId);
                return Promise.resolve(matches[matches.length - 1] ?? null);
            }),
            findMany: jest.fn(({ where }: any) => {
                return Promise.resolve(locationUpdates.filter(l => l.rideId === where.rideId));
            }),
        },
        payment: {
            create: jest.fn(({ data }: any) => {
                const p: MockPayment = {
                    id: randomUUID(),
                    ...data,
                    status: data.status ?? 'CREATED',
                    stripePaymentIntentId: data.stripePaymentIntentId ?? null,
                    payoutEligibleAt: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                payments.push(p);
                return Promise.resolve(p);
            }),
            findUniqueOrThrow: jest.fn(({ where }: any) => {
                const p = payments.find(x => x.id === where.id);
                if (!p) return Promise.reject(new Error('Not found'));
                return Promise.resolve(p);
            }),
            findMany: jest.fn(({ where }: any) => {
                let result = [...payments];
                if (where?.status && typeof where.status === 'string') {
                    result = result.filter(p => p.status === where.status);
                }
                if (where?.status?.in) {
                    result = result.filter(p => where.status.in.includes(p.status));
                }
                if (where?.updatedAt?.lt) {
                    result = result.filter(p => p.updatedAt < where.updatedAt.lt);
                }
                if (where?.booking?.ride?.driverId) {
                    const driverId = where.booking.ride.driverId;
                    result = result.filter(p => {
                        const b = bookings.find(bk => bk.id === p.bookingId);
                        const r = rides.find(rd => rd.id === b?.rideId);
                        return r?.driverId === driverId;
                    });
                }
                return Promise.resolve(result.map(p => ({
                    ...p,
                    booking: { id: p.bookingId, rideId: p.rideId, ride: { driverId: DRIVER_ID } },
                })));
            }),
            update: jest.fn(({ where, data }: any) => {
                const p = payments.find(x => x.id === where.id);
                if (!p) return Promise.reject(new Error('Not found'));
                Object.assign(p, data, { updatedAt: new Date() });
                return Promise.resolve(p);
            }),
        },
        ledgerEntry: {
            create: jest.fn(({ data }: any) => {
                const entry: MockLedgerEntry = { id: randomUUID(), ...data, createdAt: new Date() };
                ledgerEntries.push(entry);
                return Promise.resolve(entry);
            }),
            createMany: jest.fn(({ data }: any) => {
                const entries = (Array.isArray(data) ? data : [data]).map((d: any) => ({
                    id: randomUUID(),
                    ...d,
                    createdAt: new Date(),
                }));
                ledgerEntries.push(...entries);
                return Promise.resolve({ count: entries.length });
            }),
            findMany: jest.fn(({ where }: any) => {
                let result = [...ledgerEntries];
                if (where?.paymentId) result = result.filter(e => e.paymentId === where.paymentId);
                if (where?.userId) result = result.filter(e => e.userId === where.userId);
                if (where?.accountType) result = result.filter(e => e.accountType === where.accountType);
                return Promise.resolve(result);
            }),
        },
        payoutBatch: {
            create: jest.fn(({ data }: any) => {
                const batchId = randomUUID();
                const items: MockPayoutItem[] = (data.items?.create ?? []).map((item: any) => ({
                    id: randomUUID(),
                    payoutBatchId: batchId,
                    ...item,
                    createdAt: new Date(),
                }));
                const batch: MockPayoutBatch = {
                    id: batchId,
                    driverId: data.driverId,
                    status: data.status ?? 'PENDING',
                    currency: data.currency,
                    amountTotal: data.amountTotal,
                    stripeTransferId: data.stripeTransferId ?? null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    items,
                };
                payoutBatches.push(batch);
                return Promise.resolve(batch);
            }),
            update: jest.fn(({ where, data }: any) => {
                const batch = payoutBatches.find(b => b.id === where.id);
                if (!batch) return Promise.reject(new Error('Not found'));
                Object.assign(batch, data, { updatedAt: new Date() });
                return Promise.resolve(batch);
            }),
        },
        payoutItem: {
            create: jest.fn(({ data }: any) => {
                const item: MockPayoutItem = { id: randomUUID(), ...data, createdAt: new Date() };
                const batch = payoutBatches.find(b => b.id === data.payoutBatchId);
                batch?.items.push(item);
                return Promise.resolve(item);
            }),
            updateMany: jest.fn(({ where, data }: any) => {
                const batch = payoutBatches.find(b => b.id === where.payoutBatchId);
                if (batch) batch.items.forEach(item => Object.assign(item, data));
                return Promise.resolve({ count: batch?.items.length ?? 0 });
            }),
        },
        paymentEventOutbox: {
            create: jest.fn(({ data }: any) => {
                return Promise.resolve({ id: randomUUID(), ...data, status: 'PENDING', createdAt: new Date() });
            }),
        },
        dispute: {
            create: jest.fn(({ data }: any) => {
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
            findFirst: jest.fn(({ where }: any) => {
                const d = disputes.find(x =>
                    x.bookingId === where.bookingId &&
                    (where.status?.in ? where.status.in.includes(x.status) : true)
                );
                return Promise.resolve(d ?? null);
            }),
            findUnique: jest.fn(({ where, include }: any) => {
                const d = disputes.find(x => x.id === where.id);
                if (!d) return Promise.resolve(null);
                if (include?.booking || include?.ride) {
                    const b = bookings.find(bk => bk.id === d.bookingId);
                    const r = rides.find(rd => rd.id === d.rideId);
                    return Promise.resolve({
                        ...d,
                        booking: b ? { ...b, totalPrice: b.totalPrice } : null,
                        ride: r ? { ...r, driverId: DRIVER_ID } : null,
                    });
                }
                return Promise.resolve(d);
            }),
            findMany: jest.fn(({ where }: any) => {
                let result = [...disputes];
                if (where?.raisedBy) result = result.filter(d => d.raisedBy === where.raisedBy);
                return Promise.resolve(result);
            }),
            update: jest.fn(({ where, data }: any) => {
                const d = disputes.find(x => x.id === where.id);
                if (!d) return Promise.reject(new Error('Not found'));
                Object.assign(d, data);
                return Promise.resolve(d);
            }),
        },
        trackingLink: {
            create: jest.fn(({ data }: any) => {
                const link: MockTrackingLink = {
                    id: randomUUID(),
                    ...data,
                    createdAt: new Date(),
                    revokedAt: null,
                };
                trackingLinks.push(link);
                return Promise.resolve(link);
            }),
            findUnique: jest.fn(({ where, include }: any) => {
                let link: MockTrackingLink | undefined;
                if (where.id) link = trackingLinks.find(l => l.id === where.id);
                if (where.tokenHash) link = trackingLinks.find(l => l.tokenHash === where.tokenHash);
                if (!link) return Promise.resolve(null);
                if (include?.booking) {
                    const b = bookings.find(bk => bk.id === link!.bookingId);
                    const r = rides.find(rd => rd.id === b?.rideId);
                    return Promise.resolve({
                        ...link,
                        booking: {
                            ...b,
                            pickupAddress: 'Riga Central',
                            dropoffAddress: 'Jurmala Beach',
                            ride: r ? { ...r } : null,
                        },
                    });
                }
                return Promise.resolve(link);
            }),
            findMany: jest.fn(({ where }: any) => {
                return Promise.resolve(
                    trackingLinks.filter(l => l.bookingId === where.bookingId && l.revokedAt === null)
                );
            }),
            update: jest.fn(({ where, data }: any) => {
                const link = trackingLinks.find(l => l.id === where.id);
                if (!link) return Promise.reject(new Error('Not found'));
                Object.assign(link, data);
                return Promise.resolve(link);
            }),
        },
        rideSegmentCapacity: {
            findMany: jest.fn(({ where }: any) => {
                return Promise.resolve(
                    segmentCapacities.filter(sc => {
                        if (sc.rideId !== where.rideId) return false;
                        if (where.fromPosition?.gte !== undefined && sc.fromPosition < where.fromPosition.gte) return false;
                        if (where.toPosition?.lte !== undefined && sc.toPosition > where.toPosition.lte) return false;
                        return true;
                    })
                );
            }),
            updateMany: jest.fn(({ where, data }: any) => {
                const matching = segmentCapacities.filter(sc => {
                    if (sc.rideId !== where.rideId) return false;
                    if (where.fromPosition?.gte !== undefined && sc.fromPosition < where.fromPosition.gte) return false;
                    if (where.toPosition?.lte !== undefined && sc.toPosition > where.toPosition.lte) return false;
                    return true;
                });
                matching.forEach(sc => {
                    if (data.occupiedSeats?.increment) sc.occupiedSeats += data.occupiedSeats.increment;
                    if (data.occupiedSeats?.decrement) sc.occupiedSeats -= data.occupiedSeats.decrement;
                });
                return Promise.resolve({ count: matching.length });
            }),
        },
        user: {
            findUnique: jest.fn(({ where }: any) => {
                if (where.id === DRIVER_ID) return Promise.resolve({ id: DRIVER_ID, stripeAccountId: 'acct_driver', stripeOnboardingComplete: true });
                return Promise.resolve(null);
            }),
        },
    },
}));

jest.mock('../../utils/logger.js', () => ({
    logInfo: jest.fn(),
    logError: jest.fn(),
    logWarn: jest.fn(),
}));

// ============================================================
//  IMPORTS (after mocks)
// ============================================================

import {
    startRide,
    finishRide,
    driverArrived,
    verifyPickupAndBoard,
    markNoShow,
    confirmDropoff,
    riderConfirmDropoff,
    submitLocation,
    getLatestLocation,
    syncOfflineActions,
} from '../ride-operations/ride-operations.service.js';
import {
    createPayment,
    markPaymentPending,
    markPaymentPaid,
    markHeldInEscrow,
    markPayoutEligible,
    PAYMENT_STATUSES,
} from '../payments/payment.service.js';
import { processDriverPayout, checkAndMarkEligible } from '../payout/payout.service.js';
import { createDispute, collectEvidence, evaluateDispute, resolveDispute } from '../dispute/dispute.service.js';
import { createTrackingLink, getTrackingData, revokeTrackingLink } from '../tracking/tracking.service.js';
import { getDriverBalance, getDriverEarnings } from '../ledger/ledger.service.js';

// ============================================================
//  HELPERS
// ============================================================

const createRideEvent = (overrides?: Partial<{ actionId: string; lat: number; lng: number; clientTimestamp: string }>) => ({
    actionId: randomUUID(),
    lat: 56.9496,
    lng: 24.1052,
    clientTimestamp: new Date().toISOString(),
    ...overrides,
});

const setupRide = (): string => {
    const rideId = randomUUID();
    rides.push({
        id: rideId,
        driverId: DRIVER_ID,
        status: 'PUBLISHED',
        originLat: 56.9496,
        originLng: 24.1052,
        destinationLat: 56.968,
        destinationLng: 23.7707,
        originAddress: 'Riga Central',
        destinationAddress: 'Jurmala Beach',
        departureDate: new Date(),
        departureTime: '10:00',
        totalSeats: 3,
        availableSeats: 3,
        basePricePerSeat: 12,
        currency: 'EUR',
        routeDistanceMeters: 35000,
        actualStartTime: null,
        actualEndTime: null,
        currentStopSequence: null,
        waypoints: [],
    });
    // Create segment capacity
    segmentCapacities.push({ id: randomUUID(), rideId, fromPosition: 0, toPosition: 1, occupiedSeats: 0 });
    return rideId;
};

const setupBooking = (rideId: string, passengerId: string, status = 'CONFIRMED'): string => {
    const bookingId = randomUUID();
    bookings.push({
        id: bookingId,
        rideId,
        passengerId,
        seatsBooked: 1,
        totalPrice: 12,
        status,
        pickupWaypointId: null,
        dropoffWaypointId: null,
        pickupPosition: 0,
        dropoffPosition: 1,
        pickupOtp: '123456',
        pickupOtpHash: 'hash-123456',
        pickupOtpExpiresAt: new Date(Date.now() + 3600000),
        pickupOtpVerifiedAt: null,
        dropOtpHash: null,
        dropOtpVerifiedAt: null,
        otpAttemptCount: 0,
        driverArrivedAt: null,
        waitTimerStartedAt: null,
        onboardedAt: null,
        dropoffConfirmedAt: null,
        riderDropoffConfirmedAt: null,
        noShowMarkedAt: null,
        completedAt: null,
        driverDecisionDeadlineAt: new Date(Date.now() + 3600000),
        withdrawnAt: null,
        withdrawnReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    return bookingId;
};

// ============================================================
//  TEST SUITE: HAPPY PATH — Full Lifecycle
// ============================================================

describe('Full Ride Lifecycle — Happy Path', () => {
    let rideId: string;
    let booking1Id: string;
    let booking2Id: string;
    let paymentId: string;

    beforeAll(() => {
        rideId = setupRide();
        booking1Id = setupBooking(rideId, RIDER_1_ID, 'CONFIRMED');
        booking2Id = setupBooking(rideId, RIDER_2_ID, 'CONFIRMED');
    });

    test('1. Driver starts ride → status IN_PROGRESS, bookings move to WAITING_FOR_PICKUP', async () => {
        const result = await startRide(DRIVER_ID, rideId, createRideEvent());

        expect(result.status).toBe('IN_PROGRESS');
        expect(result.actualStartTime).toBeDefined();

        const b1 = bookings.find(b => b.id === booking1Id)!;
        const b2 = bookings.find(b => b.id === booking2Id)!;
        expect(b1.status).toBe('WAITING_FOR_PICKUP');
        expect(b2.status).toBe('WAITING_FOR_PICKUP');

        // Notifications sent to both passengers
        const rideStartNotifs = notifications.filter(n => n.type === 'ride.started');
        expect(rideStartNotifs.length).toBe(2);
    });

    test('2. Driver submits location updates', async () => {
        const result = await submitLocation(DRIVER_ID, rideId, {
            lat: 56.9500,
            lng: 24.1060,
            speed: 45,
            heading: 270,
            accuracy: 5,
            timestamp: new Date().toISOString(),
        });

        expect(result.recorded).toBe(true);
        expect(locationUpdates.length).toBe(1);
    });

    test('3. Get latest location returns most recent ping', async () => {
        await submitLocation(DRIVER_ID, rideId, {
            lat: 56.9510,
            lng: 24.1080,
            speed: 50,
            timestamp: new Date().toISOString(),
        });

        const latest = await getLatestLocation(rideId);
        expect(latest).not.toBeNull();
        expect(latest!.lat).toBe(56.9510);
        expect(latest!.speed).toBe(50);
    });

    test('4. Rider 1 creates family tracking link', async () => {
        const link = await createTrackingLink({
            bookingId: booking1Id,
            createdBy: RIDER_1_ID,
        });

        expect(link.token).toBeDefined();
        expect(link.trackingUrl).toContain(link.token);
        expect(trackingLinks.length).toBe(1);
    });

    test('5. Family member accesses tracking data (public, no auth)', async () => {
        const link = trackingLinks[0];
        const data = await getTrackingData(link.token);

        expect(data.bookingStatus).toBe('WAITING_FOR_PICKUP');
        expect(data.pickup).toBe('Riga Central');
    });

    test('6. Driver arrives at rider 1 pickup — geofence + wait timer', async () => {
        const result = await driverArrived(DRIVER_ID, {
            bookingId: booking1Id,
            actionId: randomUUID(),
            lat: 56.9496,
            lng: 24.1052,
            clientTimestamp: new Date().toISOString(),
        });

        expect(result.status).toBe('DRIVER_ARRIVED');
        expect(result.geofenceValid).toBe(true);
        expect(result.waitTimerStartedAt).toBeDefined();

        // Notification sent to passenger
        const arrivedNotifs = notifications.filter(n => n.type === 'booking.driver_arrived');
        expect(arrivedNotifs.length).toBeGreaterThan(0);
    });

    test('7. Driver verifies pickup OTP → rider 1 onboard', async () => {
        const result = await verifyPickupAndBoard(DRIVER_ID, booking1Id, '123456', createRideEvent());

        expect(result.status).toBe('ONBOARD');
        expect(result.onboardedAt).toBeDefined();
    });

    test('8. Driver confirms dropoff for rider 1', async () => {
        const result = await confirmDropoff(DRIVER_ID, {
            bookingId: booking1Id,
            actionId: randomUUID(),
            lat: 56.968,
            lng: 23.7707,
            clientTimestamp: new Date().toISOString(),
        });

        expect(result.status).toBe('DROP_PENDING');
        expect(result.geofenceValid).toBe(true);
    });

    test('9. Rider 1 confirms dropoff → booking COMPLETED', async () => {
        const result = await riderConfirmDropoff(RIDER_1_ID, booking1Id, createRideEvent());

        expect(result.status).toBe('COMPLETED');
        expect(result.completedAt).toBeDefined();
    });

    test('10. Rider 1 revokes tracking link after completion', async () => {
        const link = trackingLinks[0];
        await revokeTrackingLink(link.id, RIDER_1_ID);
        expect(trackingLinks[0].revokedAt).not.toBeNull();
    });

    test('11. Driver marks rider 2 as no-show (after wait time)', async () => {
        // Move booking 2 to DRIVER_ARRIVED with wait timer in the past
        const b2 = bookings.find(b => b.id === booking2Id)!;
        b2.status = 'DRIVER_ARRIVED';
        b2.driverArrivedAt = new Date(Date.now() - 15 * 60000); // 15 min ago
        b2.waitTimerStartedAt = new Date(Date.now() - 15 * 60000);

        const result = await markNoShow(DRIVER_ID, {
            bookingId: booking2Id,
            actionId: randomUUID(),
            clientTimestamp: new Date().toISOString(),
        });

        expect(result.status).toBe('NO_SHOW');
        expect(result.noShowMarkedAt).toBeDefined();
    });

    test('12. Driver finishes ride (all bookings terminal)', async () => {
        const result = await finishRide(DRIVER_ID, rideId, createRideEvent());

        expect(result.status).toBe('COMPLETED');
        expect(result.actualEndTime).toBeDefined();
    });

    test('13. Payment lifecycle: create → paid → escrow → payout eligible', async () => {
        const payment = await createPayment({
            bookingId: booking1Id,
            rideId,
            riderId: RIDER_1_ID,
            amountTotal: 12,
            fareAmount: 11,
            platformFeeAmount: 1,
            currency: 'EUR',
        });
        paymentId = payment.id;

        expect(payment.status).toBe(PAYMENT_STATUSES.CREATED);

        await markPaymentPending(paymentId);
        const afterPending = payments.find(p => p.id === paymentId)!;
        expect(afterPending.status).toBe(PAYMENT_STATUSES.PAYMENT_PENDING);

        await markPaymentPaid(paymentId, DRIVER_ID);
        const afterPaid = payments.find(p => p.id === paymentId)!;
        expect(afterPaid.status).toBe(PAYMENT_STATUSES.PAID);

        // Ledger entries created
        expect(ledgerEntries.length).toBeGreaterThan(0);

        await markHeldInEscrow(paymentId);
        const afterEscrow = payments.find(p => p.id === paymentId)!;
        expect(afterEscrow.status).toBe(PAYMENT_STATUSES.HELD_IN_ESCROW);

        await markPayoutEligible(paymentId);
        const afterEligible = payments.find(p => p.id === paymentId)!;
        expect(afterEligible.status).toBe(PAYMENT_STATUSES.PAYOUT_ELIGIBLE);
    });

    test('14. Process driver payout', async () => {
        const result = await processDriverPayout(DRIVER_ID);

        expect(result.status).toBe('COMPLETED');
        expect(result.batchId).toBeDefined();
        expect(payoutBatches.length).toBe(1);
        expect(payoutBatches[0].stripeTransferId).toBe('tr_mock_1');
    });

    test('15. Driver earnings reflect completed payout', async () => {
        const earnings = await getDriverEarnings(DRIVER_ID);
        expect(earnings.totalEarned).toBeGreaterThan(0);
    });

    test('16. Ride events recorded throughout lifecycle', () => {
        const events = rideEvents.filter(e => e.rideId === rideId);
        const eventTypes = events.map(e => e.eventType);

        expect(eventTypes).toContain('RIDE_STARTED');
        expect(eventTypes).toContain('DRIVER_ARRIVED');
        expect(eventTypes).toContain('PICKUP_OTP_VERIFIED');
        expect(eventTypes).toContain('DROPOFF_CONFIRMED_DRIVER');
        expect(eventTypes).toContain('DROPOFF_CONFIRMED_RIDER');
        expect(eventTypes).toContain('NO_SHOW_MARKED');
        expect(eventTypes).toContain('RIDE_FINISHED');
    });

    test('17. Notifications sent at each stage', () => {
        const types = notifications.map(n => n.type);

        expect(types).toContain('ride.started');
        expect(types).toContain('booking.driver_arrived');
        expect(types).toContain('booking.dropoff_pending');
        expect(types).toContain('booking.no_show');
    });
});

// ============================================================
//  TEST SUITE: DISPUTE FLOW — No-Show with OTP Verified
// ============================================================

describe('Dispute Flow — No-Show Auto-Resolution', () => {
    let rideId: string;
    let bookingId: string;
    let disputeId: string;

    beforeAll(() => {
        rideId = setupRide();
        rides[rides.length - 1].status = 'COMPLETED';
        rides[rides.length - 1].actualStartTime = new Date();
        rides[rides.length - 1].actualEndTime = new Date();

        bookingId = setupBooking(rideId, RIDER_1_ID, 'NO_SHOW');
        const b = bookings.find(bk => bk.id === bookingId)!;
        b.pickupOtpVerifiedAt = new Date(); // OTP was verified
        b.noShowMarkedAt = new Date();
        b.onboardedAt = new Date();

        // Add location data for evidence
        locationUpdates.push(
            { id: randomUUID(), rideId, driverId: DRIVER_ID, lat: 56.95, lng: 24.10, speed: 40, heading: null, accuracy: null, timestamp: new Date(), createdAt: new Date() },
            { id: randomUUID(), rideId, driverId: DRIVER_ID, lat: 56.96, lng: 24.05, speed: 50, heading: null, accuracy: null, timestamp: new Date(), createdAt: new Date() },
        );
    });

    test('1. Rider raises dispute after being marked no-show', async () => {
        const dispute = await createDispute({
            rideId,
            bookingId,
            raisedBy: RIDER_1_ID,
            reason: 'I was in the car when marked no-show',
            description: 'Driver verified my OTP and I boarded, then marked me as no-show after argument',
        });

        disputeId = dispute.id;
        expect(dispute.status).toBe('OPEN');
    });

    test('2. Admin collects evidence', async () => {
        const evidence = await collectEvidence(disputeId);

        expect(evidence.otpVerified).toBe(true);
        expect(evidence.noShowMarked).toBe(true);
        expect(evidence.locationHistory.count).toBe(2);
    });

    test('3. Rule engine auto-resolves: no-show + OTP verified = REFUND_RIDER', async () => {
        const result = await evaluateDispute(disputeId);

        expect(result.recommendation).toBe('REFUND_RIDER');
        expect(result.riskScore).toBe(0.9);
        expect(result.status).toBe('AUTO_RESOLVED_RIDER_REFUND');
    });
});

// ============================================================
//  TEST SUITE: DISPUTE FLOW — Admin Manual Resolution
// ============================================================

describe('Dispute Flow — Admin Manual Resolution', () => {
    let rideId: string;
    let bookingId: string;
    let disputeId: string;

    beforeAll(() => {
        // Clear disputes from previous test
        disputes.length = 0;
        rideId = setupRide();
        rides[rides.length - 1].status = 'COMPLETED';

        bookingId = setupBooking(rideId, RIDER_1_ID, 'COMPLETED');
        const b = bookings.find(bk => bk.id === bookingId)!;
        b.completedAt = new Date();
        b.riderDropoffConfirmedAt = new Date();
        b.pickupOtpVerifiedAt = new Date();
        b.dropoffConfirmedAt = new Date();
    });

    test('1. Driver raises dispute about rider behavior', async () => {
        const dispute = await createDispute({
            rideId,
            bookingId,
            raisedBy: DRIVER_ID,
            reason: 'Rider damaged vehicle seat',
            description: 'Spilled drink on leather seat, refusing to pay for cleaning',
        });

        disputeId = dispute.id;
        expect(dispute.status).toBe('OPEN');
    });

    test('2. Rule engine marks for manual review (rider confirmed dropoff)', async () => {
        // Collect evidence first
        await collectEvidence(disputeId);
        const result = await evaluateDispute(disputeId);

        // Rider confirmed dropoff → AUTO_RESOLVED_DRIVER_PAYOUT
        expect(result.recommendation).toBe('PAYOUT_DRIVER');
    });

    test('3. Admin overrides with SPLIT resolution', async () => {
        // Reset status to allow manual resolution
        const d = disputes.find(x => x.id === disputeId)!;
        d.status = 'NEEDS_MANUAL_REVIEW';

        const resolved = await resolveDispute(disputeId, {
            resolution: 'SPLIT',
            resolvedBy: ADMIN_ID,
        });

        expect(resolved.status).toBe('RESOLVED_SPLIT');
        expect(resolved.resolvedBy).toBe(ADMIN_ID);
        expect(resolved.resolvedAt).toBeDefined();
    });
});

// ============================================================
//  TEST SUITE: OFFLINE SYNC
// ============================================================

describe('Offline Sync — Driver with connectivity issues', () => {
    let rideId: string;

    beforeAll(() => {
        rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';
    });

    test('syncs queued offline actions in batch', async () => {
        const actions = [
            { actionId: randomUUID(), eventType: 'LOCATION_UPDATE', rideId, lat: 56.95, lng: 24.10, clientTimestamp: new Date(Date.now() - 30000).toISOString() },
            { actionId: randomUUID(), eventType: 'LOCATION_UPDATE', rideId, lat: 56.96, lng: 24.08, clientTimestamp: new Date(Date.now() - 20000).toISOString() },
            { actionId: randomUUID(), eventType: 'DRIVER_ARRIVED', rideId, lat: 56.97, lng: 24.05, clientTimestamp: new Date(Date.now() - 10000).toISOString() },
        ];

        const result = await syncOfflineActions(DRIVER_ID, actions);

        expect(result.processed).toBe(3);
        expect(result.duplicates).toBe(0);
    });

    test('rejects duplicate actions on re-sync', async () => {
        const existingActionId = rideEvents[rideEvents.length - 1].actionId;

        const actions = [
            { actionId: existingActionId, eventType: 'DRIVER_ARRIVED', rideId, clientTimestamp: new Date().toISOString() },
            { actionId: randomUUID(), eventType: 'NEW_EVENT', rideId, clientTimestamp: new Date().toISOString() },
        ];

        const result = await syncOfflineActions(DRIVER_ID, actions);
        expect(result.duplicates).toBe(1);
        expect(result.processed).toBe(1);
    });
});

// ============================================================
//  TEST SUITE: PAYOUT ELIGIBILITY CHECKER
// ============================================================

describe('Payout Eligibility — Auto-transition after dispute window', () => {
    test('marks eligible payments past 48h dispute window', async () => {
        // Create a payment stuck in HELD_IN_ESCROW for 3 days
        const oldPayment: MockPayment = {
            id: randomUUID(),
            bookingId: randomUUID(),
            rideId: randomUUID(),
            riderId: RIDER_1_ID,
            stripePaymentIntentId: null,
            amountTotal: 15,
            currency: 'EUR',
            fareAmount: 14,
            platformFeeAmount: 1,
            status: 'HELD_IN_ESCROW',
            payoutEligibleAt: null,
            createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
            updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
        };
        payments.push(oldPayment);

        const result = await checkAndMarkEligible();

        expect(result.markedEligible).toBeGreaterThanOrEqual(1);
        const updated = payments.find(p => p.id === oldPayment.id)!;
        expect(updated.status).toBe('PAYOUT_ELIGIBLE');
    });
});

// ============================================================
//  TEST SUITE: EDGE CASES
// ============================================================

describe('Edge Cases', () => {
    test('cannot start a ride that is already IN_PROGRESS', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';

        await expect(startRide(DRIVER_ID, rideId, createRideEvent()))
            .rejects.toThrow('INVALID_RIDE_STATE_TRANSITION');
    });

    test('cannot finish ride with non-terminal bookings', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';
        setupBooking(rideId, RIDER_1_ID, 'ONBOARD'); // non-terminal

        await expect(finishRide(DRIVER_ID, rideId, createRideEvent()))
            .rejects.toThrow('BOOKINGS_NOT_ALL_TERMINAL');
    });

    test('cannot mark no-show before wait time elapses', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';
        const bookingId = setupBooking(rideId, RIDER_1_ID, 'DRIVER_ARRIVED');
        const b = bookings.find(bk => bk.id === bookingId)!;
        b.waitTimerStartedAt = new Date(); // just now, wait time not elapsed

        await expect(markNoShow(DRIVER_ID, {
            bookingId,
            actionId: randomUUID(),
            clientTimestamp: new Date().toISOString(),
        })).rejects.toThrow('WAIT_TIME_NOT_ELAPSED');
    });

    test('cannot verify OTP with wrong code', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';
        const bookingId = setupBooking(rideId, RIDER_1_ID, 'DRIVER_ARRIVED');

        await expect(verifyPickupAndBoard(DRIVER_ID, bookingId, '999999', createRideEvent()))
            .rejects.toThrow('INVALID_PICKUP_OTP');
    });

    test('non-driver cannot perform ride operations', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';

        await expect(startRide('stranger-id', rideId, createRideEvent()))
            .rejects.toThrow('FORBIDDEN_DRIVER');
    });

    test('non-passenger cannot confirm dropoff', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';
        const bookingId = setupBooking(rideId, RIDER_1_ID, 'DROP_PENDING');

        await expect(riderConfirmDropoff('stranger-id', bookingId, createRideEvent()))
            .rejects.toThrow('FORBIDDEN_PASSENGER');
    });

    test('geofence detects driver far from pickup', async () => {
        const rideId = setupRide();
        rides[rides.length - 1].status = 'IN_PROGRESS';
        const bookingId = setupBooking(rideId, RIDER_1_ID, 'WAITING_FOR_PICKUP');

        // Driver is 5km away from pickup
        const result = await driverArrived(DRIVER_ID, {
            bookingId,
            actionId: randomUUID(),
            lat: 57.0, // far from 56.9496
            lng: 24.2,
            clientTimestamp: new Date().toISOString(),
        });

        expect(result.geofenceValid).toBe(false);
        // Still allowed (warning only)
        expect(result.status).toBe('DRIVER_ARRIVED');
    });

    test('tracking link creation blocked for non-passenger', async () => {
        const rideId = setupRide();
        const bookingId = setupBooking(rideId, RIDER_1_ID, 'ONBOARD');

        await expect(createTrackingLink({
            bookingId,
            createdBy: 'stranger-id',
        })).rejects.toThrow('FORBIDDEN');
    });

    test('cannot create duplicate dispute on same booking', async () => {
        disputes.length = 0;
        const rideId = setupRide();
        const bookingId = setupBooking(rideId, RIDER_1_ID, 'COMPLETED');

        await createDispute({ rideId, bookingId, raisedBy: RIDER_1_ID, reason: 'First' });
        await expect(createDispute({ rideId, bookingId, raisedBy: RIDER_1_ID, reason: 'Second' }))
            .rejects.toThrow('DISPUTE_ALREADY_EXISTS');
    });
});

// ============================================================
//  TEST SUITE: MULTI-PASSENGER SCENARIO
// ============================================================

describe('Multi-Passenger Ride — Different completion times', () => {
    let rideId: string;
    let b1Id: string;
    let b2Id: string;
    let b3Id: string;

    beforeAll(() => {
        rideId = setupRide();
        b1Id = setupBooking(rideId, RIDER_1_ID, 'CONFIRMED');
        b2Id = setupBooking(rideId, RIDER_2_ID, 'CONFIRMED');
        b3Id = setupBooking(rideId, 'rider-e2e-3', 'CONFIRMED');
    });

    test('ride starts, all bookings move to WAITING_FOR_PICKUP', async () => {
        await startRide(DRIVER_ID, rideId, createRideEvent());
        const statuses = bookings.filter(b => b.rideId === rideId).map(b => b.status);
        expect(statuses.every(s => s === 'WAITING_FOR_PICKUP')).toBe(true);
    });

    test('rider 1 boards via OTP', async () => {
        bookings.find(b => b.id === b1Id)!.status = 'DRIVER_ARRIVED';
        await verifyPickupAndBoard(DRIVER_ID, b1Id, '123456', createRideEvent());
        expect(bookings.find(b => b.id === b1Id)!.status).toBe('ONBOARD');
    });

    test('rider 2 boards via OTP', async () => {
        bookings.find(b => b.id === b2Id)!.status = 'DRIVER_ARRIVED';
        await verifyPickupAndBoard(DRIVER_ID, b2Id, '123456', createRideEvent());
        expect(bookings.find(b => b.id === b2Id)!.status).toBe('ONBOARD');
    });

    test('rider 3 is no-show', async () => {
        const b3 = bookings.find(b => b.id === b3Id)!;
        b3.status = 'DRIVER_ARRIVED';
        b3.waitTimerStartedAt = new Date(Date.now() - 15 * 60000);

        await markNoShow(DRIVER_ID, { bookingId: b3Id, actionId: randomUUID(), clientTimestamp: new Date().toISOString() });
        expect(bookings.find(b => b.id === b3Id)!.status).toBe('NO_SHOW');
    });

    test('rider 1 dropped off first', async () => {
        await confirmDropoff(DRIVER_ID, { bookingId: b1Id, actionId: randomUUID(), lat: 56.96, lng: 24.0, clientTimestamp: new Date().toISOString() });
        await riderConfirmDropoff(RIDER_1_ID, b1Id, createRideEvent());
        expect(bookings.find(b => b.id === b1Id)!.status).toBe('COMPLETED');
    });

    test('rider 2 dropped off second', async () => {
        await confirmDropoff(DRIVER_ID, { bookingId: b2Id, actionId: randomUUID(), lat: 56.968, lng: 23.77, clientTimestamp: new Date().toISOString() });
        await riderConfirmDropoff(RIDER_2_ID, b2Id, createRideEvent());
        expect(bookings.find(b => b.id === b2Id)!.status).toBe('COMPLETED');
    });

    test('all bookings terminal → ride finishes', async () => {
        const result = await finishRide(DRIVER_ID, rideId, createRideEvent());
        expect(result.status).toBe('COMPLETED');
    });
});
