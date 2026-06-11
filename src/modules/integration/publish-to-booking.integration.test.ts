/**
 * Integration Test: Publish Ride → Booking → Driver Actions
 *
 * Chains the full flow with a shared in-memory state (simulating DB)
 * while mocking only external services (Redis, Stripe, notifications).
 */

// ============================================================
//  SHARED IN-MEMORY STATE (simulates DB across service calls)
// ============================================================

type InMemoryRide = {
    id: string;
    driverId: string;
    status: string;
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    routePolyline: string;
    routeDistanceMeters: number;
    routeDurationSeconds: number;
    departureDate: Date;
    departureTime: string;
    totalSeats: number;
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;
    femaleOnly: boolean;
    maxLuggagePerPerson: number;
    backSeatOnly: boolean;
    notes: string | null;
    vehicleId: string;
    driver: { id: string; name: string; avatarUrl: string | null; stripeAccountId?: string | null; stripeOnboardingComplete?: boolean; dlVerified?: boolean };
    waypoints: InMemoryWaypoint[];
};

type InMemoryWaypoint = {
    id: string;
    rideId: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: string;
    orderIndex: number;
    pricePerSeat: number | null;
    estimatedArrivalTime?: string | null;
};

type InMemoryBooking = {
    id: string;
    rideId: string;
    passengerId: string;
    seatsBooked: number;
    totalPrice: number;
    status: string;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    pickupAddress: string | null;
    dropoffAddress: string | null;
    segmentFare: number | null;
    pickupPosition: number | null;
    dropoffPosition: number | null;
    stripePaymentIntentId: string | null;
    paymentAmount: number | null;
    paymentCurrency: string | null;
    paymentCapturedAt: Date | null;
    driverDecisionDeadlineAt: Date | null;
    driverDecisionAt: Date | null;
    deadlineExtendedAt: Date | null;
    cancelledAt: Date | null;
    cancelledByRole: string | null;
    cancellationReason: string | null;
    refundPercent: number | null;
    refundAmount: number | null;
    refundId: string | null;
    refundedAt: Date | null;
    driverRejectionReason: string | null;
    pickupOtp: string | null;
    dropOtp: string | null;
    pickupOtpHash: string | null;
    pickupOtpExpiresAt: Date | null;
    dropOtpHash: string | null;
    dropOtpExpiresAt: Date | null;
    otpAttemptCount: number;
    createdAt: Date;
    updatedAt: Date;
    ride?: InMemoryRide;
    passenger?: { id: string; name: string; avatarUrl: string | null };
};

type InMemorySegmentCapacity = {
    id: string;
    rideId: string;
    fromPosition: number;
    toPosition: number;
    occupiedSeats: number;
};

let rides: InMemoryRide[] = [];
let bookings: InMemoryBooking[] = [];
let segmentCapacities: InMemorySegmentCapacity[] = [];
let waypoints: InMemoryWaypoint[] = [];
let users: Array<{ id: string; name: string; avatarUrl: string | null; tosAcceptedAt: Date | null; isBanned: boolean; dlVerified: boolean; salutation: string | null }> = [];
let vehicles: Array<{ id: string; userId: string; deletedAt: null }> = [];
let blocks: Array<{ blockerId: string; blockedId: string }> = [];
let draftStore: Record<string, string> = {};

const resetState = () => {
    rides = [];
    bookings = [];
    segmentCapacities = [];
    waypoints = [];
    blocks = [];
    draftStore = {};
    users = [
        { id: 'driver-1', name: 'Alice Driver', avatarUrl: null, tosAcceptedAt: new Date(), isBanned: false, dlVerified: true, salutation: 'MS' },
        { id: 'passenger-1', name: 'Bob Rider', avatarUrl: null, tosAcceptedAt: new Date(), isBanned: false, dlVerified: false, salutation: 'MR' },
        { id: 'passenger-2', name: 'Carol Rider', avatarUrl: null, tosAcceptedAt: new Date(), isBanned: false, dlVerified: false, salutation: 'MS' },
        { id: 'passenger-banned', name: 'Banned User', avatarUrl: null, tosAcceptedAt: new Date(), isBanned: true, dlVerified: false, salutation: 'MR' },
        { id: 'passenger-no-tos', name: 'No TOS', avatarUrl: null, tosAcceptedAt: null, isBanned: false, dlVerified: false, salutation: 'MR' },
    ];
    vehicles = [
        { id: 'vehicle-1', userId: 'driver-1', deletedAt: null },
    ];
};

// ============================================================
//  MOCKS
// ============================================================

const mockRedis = {
    get: jest.fn((key: string) => Promise.resolve(draftStore[key] ?? null)),
    setex: jest.fn((_key: string, _ttl: number, value: string) => {
        draftStore[_key] = value;
        return Promise.resolve('OK');
    }),
    del: jest.fn((key: string) => {
        delete draftStore[key];
        return Promise.resolve(1);
    }),
    exists: jest.fn(),
    on: jest.fn(),
};

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

// Build a Prisma-like transaction mock that operates on in-memory state
const buildPrismaMock = () => {
    const txProxy = {
        ride: {
            create: jest.fn(async ({ data }: any) => {
                const ride: InMemoryRide = {
                    id: nextId('ride'),
                    driverId: data.driverId,
                    status: data.status ?? 'PUBLISHED',
                    originPlaceId: data.originPlaceId,
                    originAddress: data.originAddress,
                    originLat: data.originLat,
                    originLng: data.originLng,
                    destinationPlaceId: data.destinationPlaceId,
                    destinationAddress: data.destinationAddress,
                    destinationLat: data.destinationLat,
                    destinationLng: data.destinationLng,
                    routePolyline: data.routePolyline,
                    routeDistanceMeters: data.routeDistanceMeters ?? 50000,
                    routeDurationSeconds: data.routeDurationSeconds ?? 3600,
                    departureDate: data.departureDate,
                    departureTime: data.departureTime,
                    totalSeats: data.totalSeats,
                    availableSeats: data.availableSeats,
                    basePricePerSeat: data.basePricePerSeat,
                    currency: data.currency ?? 'GBP',
                    femaleOnly: data.femaleOnly ?? false,
                    maxLuggagePerPerson: data.maxLuggagePerPerson ?? 2,
                    backSeatOnly: data.backSeatOnly ?? false,
                    notes: data.notes ?? null,
                    vehicleId: data.vehicleId,
                    driver: users.find(u => u.id === data.driverId) as any,
                    waypoints: [],
                };
                rides.push(ride);
                return ride;
            }),
            findFirst: jest.fn(async ({ where }: any) => {
                const ride = rides.find(r => r.id === where.id && (!where.status || r.status === where.status));
                if (!ride) return null;
                return { ...ride, waypoints: waypoints.filter(w => w.rideId === ride.id).sort((a, b) => a.orderIndex - b.orderIndex) };
            }),
            findUnique: jest.fn(async ({ where }: any) => {
                const ride = rides.find(r => r.id === where.id);
                if (!ride) return null;
                return { ...ride, waypoints: waypoints.filter(w => w.rideId === ride.id).sort((a, b) => a.orderIndex - b.orderIndex) };
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const ride = rides.find(r => r.id === where.id);
                if (!ride) return null;
                if (data.availableSeats !== undefined) {
                    if (typeof data.availableSeats === 'object' && data.availableSeats.increment) {
                        ride.availableSeats += data.availableSeats.increment;
                    } else if (typeof data.availableSeats === 'object' && data.availableSeats.decrement) {
                        ride.availableSeats -= data.availableSeats.decrement;
                    } else {
                        ride.availableSeats = data.availableSeats;
                    }
                }
                if (data.status) ride.status = data.status;
                return ride;
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const ride = rides.find(r => r.id === where.id && (!where.status || r.status === where.status));
                if (!ride) return { count: 0 };
                if (where.availableSeats?.gte !== undefined && ride.availableSeats < where.availableSeats.gte) {
                    return { count: 0 };
                }
                if (data.availableSeats?.decrement) ride.availableSeats -= data.availableSeats.decrement;
                return { count: 1 };
            }),
        },
        rideWaypoint: {
            createMany: jest.fn(async ({ data }: any) => {
                for (const wp of data) {
                    const newWp: InMemoryWaypoint = {
                        id: nextId('wp'),
                        rideId: wp.rideId,
                        placeId: wp.placeId,
                        address: wp.address,
                        lat: wp.lat,
                        lng: wp.lng,
                        waypointType: wp.waypointType,
                        orderIndex: wp.orderIndex,
                        pricePerSeat: wp.pricePerSeat ?? null,
                        estimatedArrivalTime: wp.estimatedArrivalTime ?? null,
                    };
                    waypoints.push(newWp);
                    const ride = rides.find(r => r.id === wp.rideId);
                    if (ride) ride.waypoints.push(newWp);
                }
                return { count: data.length };
            }),
        },
        rideSegmentCapacity: {
            createMany: jest.fn(async ({ data }: any) => {
                for (const sc of data) {
                    segmentCapacities.push({
                        id: nextId('sc'),
                        rideId: sc.rideId,
                        fromPosition: sc.fromPosition,
                        toPosition: sc.toPosition,
                        occupiedSeats: sc.occupiedSeats ?? 0,
                    });
                }
                return { count: data.length };
            }),
            findMany: jest.fn(async ({ where }: any) => {
                return segmentCapacities.filter(sc => {
                    if (sc.rideId !== where.rideId) return false;
                    if (where.fromPosition?.gte !== undefined && sc.fromPosition < where.fromPosition.gte) return false;
                    if (where.toPosition?.lte !== undefined && sc.toPosition > where.toPosition.lte) return false;
                    return true;
                });
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const matching = segmentCapacities.filter(sc => {
                    if (sc.rideId !== where.rideId) return false;
                    if (where.fromPosition?.gte !== undefined && sc.fromPosition < where.fromPosition.gte) return false;
                    if (where.toPosition?.lte !== undefined && sc.toPosition > where.toPosition.lte) return false;
                    return true;
                });
                for (const sc of matching) {
                    if (data.occupiedSeats?.increment) sc.occupiedSeats += data.occupiedSeats.increment;
                    if (data.occupiedSeats?.decrement) sc.occupiedSeats -= data.occupiedSeats.decrement;
                }
                return { count: matching.length };
            }),
        },
        rideBooking: {
            create: jest.fn(async ({ data, include }: any) => {
                const booking: InMemoryBooking = {
                    id: nextId('booking'),
                    rideId: data.rideId,
                    passengerId: data.passengerId,
                    seatsBooked: data.seatsBooked,
                    totalPrice: data.totalPrice,
                    status: data.status,
                    pickupWaypointId: data.pickupWaypointId ?? null,
                    dropoffWaypointId: data.dropoffWaypointId ?? null,
                    pickupAddress: data.pickupAddress ?? null,
                    dropoffAddress: data.dropoffAddress ?? null,
                    segmentFare: data.segmentFare ?? null,
                    pickupPosition: data.pickupPosition ?? null,
                    dropoffPosition: data.dropoffPosition ?? null,
                    stripePaymentIntentId: data.stripePaymentIntentId ?? null,
                    paymentAmount: data.paymentAmount ?? null,
                    paymentCurrency: data.paymentCurrency ?? null,
                    paymentCapturedAt: data.paymentCapturedAt ?? null,
                    driverDecisionDeadlineAt: data.driverDecisionDeadlineAt ?? null,
                    driverDecisionAt: null,
                    deadlineExtendedAt: null,
                    cancelledAt: null,
                    cancelledByRole: null,
                    cancellationReason: null,
                    refundPercent: null,
                    refundAmount: null,
                    refundId: null,
                    refundedAt: null,
                    driverRejectionReason: null,
                    pickupOtp: null,
                    dropOtp: null,
                    pickupOtpHash: null,
                    pickupOtpExpiresAt: null,
                    dropOtpHash: null,
                    dropOtpExpiresAt: null,
                    otpAttemptCount: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
                bookings.push(booking);
                if (include?.ride) {
                    const ride = rides.find(r => r.id === data.rideId)!;
                    booking.ride = { ...ride, waypoints: waypoints.filter(w => w.rideId === ride.id).sort((a, b) => a.orderIndex - b.orderIndex) };
                }
                return booking;
            }),
            findFirst: jest.fn(async ({ where }: any) => {
                return bookings.find(b => {
                    if (where.id && b.id !== where.id) return false;
                    if (where.rideId && b.rideId !== where.rideId) return false;
                    if (where.passengerId && b.passengerId !== where.passengerId) return false;
                    if (where.status?.in && !where.status.in.includes(b.status)) return false;
                    return true;
                }) ?? null;
            }),
            findUnique: jest.fn(async ({ where }: any) => {
                const b = bookings.find(bk => bk.id === where.id);
                if (!b) return null;
                const ride = rides.find(r => r.id === b.rideId)!;
                return {
                    ...b,
                    ride: { ...ride, waypoints: waypoints.filter(w => w.rideId === ride.id).sort((a2, b2) => a2.orderIndex - b2.orderIndex) },
                    passenger: users.find(u => u.id === b.passengerId),
                };
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const b = bookings.find(bk => bk.id === where.id);
                if (!b) return null;
                const { otpAttemptCount, status, ...rest } = data;
                if (status) b.status = status;
                if (otpAttemptCount?.increment) {
                    b.otpAttemptCount += otpAttemptCount.increment;
                } else if (otpAttemptCount !== undefined && typeof otpAttemptCount === 'number') {
                    b.otpAttemptCount = otpAttemptCount;
                }
                // Apply remaining scalar fields
                for (const [key, val] of Object.entries(rest)) {
                    if (val !== undefined && typeof val !== 'object') {
                        (b as any)[key] = val;
                    }
                }
                b.updatedAt = new Date();
                return b;
            }),
        },
        user: {
            findUnique: jest.fn(async ({ where }: any) => {
                return users.find(u => u.id === where.id) ?? null;
            }),
        },
        userBlock: {
            findFirst: jest.fn(async ({ where }: any) => {
                const ors = where.OR || [];
                for (const cond of ors) {
                    if (blocks.find(bl => bl.blockerId === cond.blockerId && bl.blockedId === cond.blockedId)) {
                        return { id: 'block-1' };
                    }
                }
                return null;
            }),
        },
        driverPenaltyEvent: {
            create: jest.fn(async () => ({ id: nextId('penalty') })),
        },
    };

    return txProxy;
};

const mockPrisma: any = {
    user: {
        findUnique: jest.fn(async ({ where }: any) => users.find(u => u.id === where.id) ?? null),
    },
    vehicle: {
        findFirst: jest.fn(async ({ where }: any) => vehicles.find(v => v.userId === where.userId && !v.deletedAt) ?? null),
    },
    rideBooking: {
        findFirst: jest.fn(async ({ where }: any) => {
            const b = bookings.find(bk => {
                if (where.id && bk.id !== where.id) return false;
                if (where.passengerId && bk.passengerId !== where.passengerId) return false;
                if (where.status?.in && !where.status.in.includes(bk.status)) return false;
                return true;
            });
            if (!b) return null;
            const ride = rides.find(r => r.id === b.rideId);
            return { ...b, ride };
        }),
        findUnique: jest.fn(async ({ where }: any) => {
            const b = bookings.find(bk => bk.id === where.id);
            if (!b) return null;
            const ride = rides.find(r => r.id === b.rideId)!;
            return {
                ...b,
                ride: { ...ride, waypoints: waypoints.filter(w => w.rideId === ride.id), driver: ride.driver },
                passenger: users.find(u => u.id === b.passengerId),
            };
        }),
        update: jest.fn(async ({ where, data }: any) => {
            const b = bookings.find(bk => bk.id === where.id);
            if (!b) return null;
            const { otpAttemptCount, status, ...rest } = data;
            if (status) b.status = status;
            if (otpAttemptCount?.increment) {
                b.otpAttemptCount += otpAttemptCount.increment;
            } else if (otpAttemptCount !== undefined && typeof otpAttemptCount === 'number') {
                b.otpAttemptCount = otpAttemptCount;
            }
            for (const [key, val] of Object.entries(rest)) {
                if (val !== undefined && typeof val !== 'object') {
                    (b as any)[key] = val;
                }
            }
            b.updatedAt = new Date();
            return b;
        }),
    },
    ride: {
        update: jest.fn(async ({ where, data }: any) => {
            const ride = rides.find(r => r.id === where.id);
            if (!ride) return null;
            if (data.availableSeats !== undefined) {
                if (typeof data.availableSeats === 'object' && data.availableSeats.increment) {
                    ride.availableSeats += data.availableSeats.increment;
                } else {
                    ride.availableSeats = data.availableSeats;
                }
            }
            return ride;
        }),
    },
    driverPenaltyEvent: {
        create: jest.fn(async () => ({ id: nextId('penalty') })),
    },
    $transaction: jest.fn(async (callback: any) => {
        const tx = buildPrismaMock();
        return callback(tx);
    }),
};

const mockCreateNotification = jest.fn().mockResolvedValue(undefined);
const mockRefundPaymentIntent = jest.fn().mockResolvedValue({ id: 'refund-1' });
const mockCreateBookingPaymentIntent = jest.fn();
const mockEnqueueDeadlineCheck = jest.fn().mockResolvedValue(undefined);
const mockGetFuelPriceForCurrency = jest.fn().mockResolvedValue(1.5);

jest.mock('../../cache/redis.js', () => ({
    __esModule: true,
    default: mockRedis,
}));

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    createBookingPaymentIntent: (...args: unknown[]) => mockCreateBookingPaymentIntent(...args),
    refundPaymentIntent: (...args: unknown[]) => mockRefundPaymentIntent(...args),
}));

jest.mock('../../queue/deadline.queue.js', () => ({
    __esModule: true,
    enqueueDeadlineCheck: (...args: unknown[]) => mockEnqueueDeadlineCheck(...args),
}));

jest.mock('../../services/fuel-price.service.js', () => ({
    __esModule: true,
    getFuelPriceForCurrency: (...args: unknown[]) => mockGetFuelPriceForCurrency(...args),
}));

jest.mock('../ride-booking/booking-otp.utils.js', () => ({
    __esModule: true,
    generateBookingOtp: () => '123456',
    hashOtp: (otp: string) => `hash-${otp}`,
    isOtpValid: (plain: string, hash: string) => `hash-${plain}` === hash,
}));

jest.mock('../pricing/pricing.service.js', () => ({
    __esModule: true,
    validateAndSnapshotPricing: jest.fn().mockResolvedValue({ valid: true, snapshotId: 'snap-mock' }),
}));

jest.mock('../payments/payment.service.js', () => ({
    __esModule: true,
    createPayment: jest.fn().mockResolvedValue({ id: 'payment-mock-id' }),
    markPaymentPending: jest.fn().mockResolvedValue({}),
    markPaymentPaid: jest.fn().mockResolvedValue({}),
}));

// ============================================================
//  IMPORTS (after mocks)
// ============================================================

import * as DraftRideService from '../publish-ride/draft-ride.service';
import { createBooking, cancelBooking } from '../ride-booking/ride-booking.service';
import { acceptBooking, rejectBooking, cancelAfterAccept, verifyPickupOtp } from '../driver-booking/driver-booking.service';

// ============================================================
//  HELPERS
// ============================================================

const DRAFT_KEY = 'rideDraft:driver-1';

const buildCompleteDraft = (overrides: Record<string, any> = {}) => ({
    userId: 'driver-1',
    step: 13,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    originPlaceId: 'place-origin',
    originAddress: 'London Victoria',
    originLat: 51.495,
    originLng: -0.144,
    destinationPlaceId: 'place-dest',
    destinationAddress: 'Brighton Station',
    destinationLat: 50.829,
    destinationLng: -0.141,
    routePolyline: 'encoded-polyline-data',
    routeDistanceMeters: 85000,
    routeDurationSeconds: 5400,
    departureDate: new Date('2026-07-01T00:00:00.000Z').toISOString(),
    departureTime: '09:00',
    totalSeats: 3,
    basePricePerSeat: 30,
    currency: 'GBP',
    maxLuggagePerPerson: 2,
    backSeatOnly: false,
    femaleOnly: false,
    notes: null,
    stopovers: [
        { placeId: 'place-gatwick', address: 'Gatwick Airport', lat: 51.148, lng: -0.190 },
        { placeId: 'place-crawley', address: 'Crawley Town', lat: 51.109, lng: -0.187 },
    ],
    stopoverPricingByPlaceId: {
        'place-gatwick': 12,
        'place-crawley': 22,
    },
    pickups: [],
    dropoffs: [],
    ...overrides,
});

// ============================================================
//  TESTS
// ============================================================

describe('Integration: Publish → Book → Driver Actions', () => {
    beforeEach(() => {
        resetState();
        idCounter = 0;
        jest.clearAllMocks();
        process.env.BOOKING_PAYMENT_MODE = 'bypass';
        process.env.PLATFORM_FEE_PERCENT = '0';
        process.env.VIEW_TOKEN_SECRET = 'test-secret-key-32chars-long!!!';
    });

    // =========================================
    //  HAPPY PATH: Full flow
    // =========================================

    describe('Happy Path: Full ride lifecycle', () => {
        it('publishes a ride with stopovers and creates segment capacity edges', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());

            await DraftRideService.publishRide('driver-1');

            // Ride created
            expect(rides).toHaveLength(1);
            expect(rides[0].status).toBe('PUBLISHED');
            expect(rides[0].availableSeats).toBe(3);
            expect(rides[0].basePricePerSeat).toBe(30);

            // Waypoints created (2 stopovers)
            const rideWaypoints = waypoints.filter(w => w.rideId === rides[0].id);
            expect(rideWaypoints.filter(w => w.waypointType === 'STOPOVER')).toHaveLength(2);

            // Segment capacity edges created (2 stopovers = 3 edges)
            const rideEdges = segmentCapacities.filter(sc => sc.rideId === rides[0].id);
            expect(rideEdges).toHaveLength(3);
            expect(rideEdges.map(e => [e.fromPosition, e.toPosition])).toEqual([
                [0, 1], [1, 2], [2, 3],
            ]);
            expect(rideEdges.every(e => e.occupiedSeats === 0)).toBe(true);

            // Draft deleted from Redis
            expect(mockRedis.del).toHaveBeenCalledWith(DRAFT_KEY);
        });

        it('passenger books a segment (Gatwick → Brighton) and gets correct pricing', async () => {
            // Setup: publish ride first
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            // Book Gatwick → Brighton (destination)
            // Gatwick cumulative price = 12, destination = 30, segment fare = 30 - 12 = 18
            const booking = await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                pickupWaypointId: gatwickWp.id,
            });

            expect(booking.status).toBe('DRIVER_PENDING');
            expect(booking.totalPrice).toBe(18);
            expect(booking.pickupWaypointId).toBe(gatwickWp.id);
            expect(booking.dropoffWaypointId).toBeNull();

            // Segment capacity updated: edges 1→2 and 2→3 should have 1 occupied
            const edges = segmentCapacities.filter(sc => sc.rideId === rideId);
            expect(edges.find(e => e.fromPosition === 0)!.occupiedSeats).toBe(0); // origin→gatwick unaffected
            expect(edges.find(e => e.fromPosition === 1)!.occupiedSeats).toBe(1); // gatwick→crawley
            expect(edges.find(e => e.fromPosition === 2)!.occupiedSeats).toBe(1); // crawley→destination

            // Driver notified
            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'driver-1',
                    type: 'booking.request.driver_decision',
                })
            );

            // Deadline enqueued
            expect(mockEnqueueDeadlineCheck).toHaveBeenCalled();
        });

        it('driver accepts booking and OTPs are generated', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                pickupWaypointId: gatwickWp.id,
            });

            const bookingId = bookings[0].id;

            // Set deadline in the future so acceptance works
            bookings[0].driverDecisionDeadlineAt = new Date(Date.now() + 60_000);

            const result = await acceptBooking('driver-1', bookingId);

            expect(result.status).toBe('CONFIRMED');
            expect(result.segment).toBeDefined();
            expect(result.segment!.pickupAddress).toBe('Gatwick Airport');
            expect(result.segment!.dropoffAddress).toBe('Brighton Station');
            expect(result.segment!.isPartialRoute).toBe(true);

            // OTPs set
            expect(bookings[0].pickupOtpHash).toBe('hash-123456');

            // Passenger notified
            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'booking.driver.accepted',
                    userId: 'passenger-1',
                })
            );
        });

        it('driver verifies pickup OTP and booking moves to IN_PROGRESS', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                pickupWaypointId: gatwickWp.id,
            });

            bookings[0].driverDecisionDeadlineAt = new Date(Date.now() + 60_000);
            await acceptBooking('driver-1', bookings[0].id);

            // Simulate confirmed state with OTP
            bookings[0].status = 'CONFIRMED';
            bookings[0].pickupOtpHash = 'hash-123456';
            bookings[0].pickupOtpExpiresAt = new Date(Date.now() + 60_000);

            const result = await verifyPickupOtp('driver-1', bookings[0].id, '123456');
            expect(result.status).toBe('IN_PROGRESS');
        });
    });

    // =========================================
    //  SEGMENT CAPACITY: Non-overlapping bookings
    // =========================================

    describe('Segment Capacity: Non-overlapping bookings succeed', () => {
        it('allows two non-overlapping segment bookings on a 1-seat ride', async () => {
            // 1-seat ride: only 1 passenger per segment
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ totalSeats: 1 }));
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;
            const crawleyWp = waypoints.find(w => w.placeId === 'place-crawley')!;

            // Passenger 1 books Origin → Gatwick (edge 0→1 only)
            const booking1 = await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                dropoffWaypointId: gatwickWp.id,
            });
            expect(booking1.totalPrice).toBe(12); // origin → gatwick = 12

            // Passenger 2 books Crawley → Destination (edge 2→3 only)
            const booking2 = await createBooking('passenger-2', {
                rideId,
                seatsBooked: 1,
                pickupWaypointId: crawleyWp.id,
            });
            expect(booking2.totalPrice).toBe(8); // destination(30) - crawley(22) = 8

            // Both bookings succeed — non-overlapping segments
            expect(bookings).toHaveLength(2);
            expect(rides[0].availableSeats).toBe(0); // max occupied across all edges = 1
        });

        it('blocks overlapping segment when capacity is full', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ totalSeats: 1 }));
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            // Passenger 1 books Origin → Brighton (full route, all edges = 1)
            await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
            });

            // Passenger 2 tries Origin → Gatwick (edge 0→1 already full)
            await expect(
                createBooking('passenger-2', {
                    rideId,
                    seatsBooked: 1,
                    dropoffWaypointId: gatwickWp.id,
                })
            ).rejects.toThrow('INSUFFICIENT_SEATS');
        });
    });

    // =========================================
    //  EDGE CASES: Pricing
    // =========================================

    describe('Pricing edge cases', () => {
        it('interpolates prices when stopovers have no explicit pricing', async () => {
            // No stopover pricing — should use interpolation
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({
                stopoverPricingByPlaceId: {},
            }));
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            // Interpolated: gatwick = 30 * (1/3) = 10, crawley = 30 * (2/3) = 20
            // Origin → Gatwick = 10
            const booking = await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                dropoffWaypointId: gatwickWp.id,
            });
            expect(booking.totalPrice).toBe(10);
        });

        it('full route booking charges basePricePerSeat', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;

            const booking = await createBooking('passenger-1', {
                rideId,
                seatsBooked: 2,
            });

            // Full route: 30 per seat * 2 seats = 60
            expect(booking.totalPrice).toBe(60);
        });

        it('middle segment (Gatwick → Crawley) charges the difference', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;
            const crawleyWp = waypoints.find(w => w.placeId === 'place-crawley')!;

            // Gatwick(12) → Crawley(22) = 22 - 12 = 10
            const booking = await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                pickupWaypointId: gatwickWp.id,
                dropoffWaypointId: crawleyWp.id,
            });
            expect(booking.totalPrice).toBe(10);
        });
    });

    // =========================================
    //  UNHAPPY PATHS: Booking validation
    // =========================================

    describe('Booking validation failures', () => {
        beforeEach(async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');
        });

        it('rejects booking own ride', async () => {
            await expect(
                createBooking('driver-1', { rideId: rides[0].id, seatsBooked: 1 })
            ).rejects.toThrow('CANNOT_BOOK_OWN_RIDE');
        });

        it('rejects banned user', async () => {
            await expect(
                createBooking('passenger-banned', { rideId: rides[0].id, seatsBooked: 1 })
            ).rejects.toThrow('USER_BANNED');
        });

        it('rejects user without ToS acceptance', async () => {
            await expect(
                createBooking('passenger-no-tos', { rideId: rides[0].id, seatsBooked: 1 })
            ).rejects.toThrow('TOS_NOT_ACCEPTED');
        });

        it('rejects when user is blocked by driver', async () => {
            blocks.push({ blockerId: 'driver-1', blockedId: 'passenger-1' });

            await expect(
                createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 1 })
            ).rejects.toThrow('USER_BLOCKED');
        });

        it('rejects when passenger blocked the driver', async () => {
            blocks.push({ blockerId: 'passenger-1', blockedId: 'driver-1' });

            await expect(
                createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 1 })
            ).rejects.toThrow('USER_BLOCKED');
        });

        it('rejects duplicate active booking', async () => {
            await createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 1 });

            await expect(
                createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 1 })
            ).rejects.toThrow('BOOKING_ALREADY_EXISTS');
        });

        it('rejects reversed segment (dropoff before pickup)', async () => {
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;
            const crawleyWp = waypoints.find(w => w.placeId === 'place-crawley')!;

            await expect(
                createBooking('passenger-1', {
                    rideId: rides[0].id,
                    seatsBooked: 1,
                    pickupWaypointId: crawleyWp.id,
                    dropoffWaypointId: gatwickWp.id,
                })
            ).rejects.toThrow('INVALID_BOOKING_SEGMENT');
        });

        it('rejects booking more seats than max allowed per booking', async () => {
            await expect(
                createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 5 })
            ).rejects.toThrow('MAXIMUM_SEATS_EXCEEDED');
        });

        it('rejects zero seats', async () => {
            await expect(
                createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 0 })
            ).rejects.toThrow('MINIMUM_ONE_SEAT_REQUIRED');
        });

        it('rejects booking a non-existent ride', async () => {
            await expect(
                createBooking('passenger-1', { rideId: 'non-existent', seatsBooked: 1 })
            ).rejects.toThrow('RIDE_NOT_FOUND');
        });
    });

    // =========================================
    //  UNHAPPY PATHS: Driver actions
    // =========================================

    describe('Driver action failures', () => {
        beforeEach(async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');
            await createBooking('passenger-1', { rideId: rides[0].id, seatsBooked: 1 });
            bookings[0].driverDecisionDeadlineAt = new Date(Date.now() + 60_000);
        });

        it('rejects accept from non-driver', async () => {
            await expect(
                acceptBooking('passenger-1', bookings[0].id)
            ).rejects.toThrow('FORBIDDEN_DRIVER');
        });

        it('rejects accept after deadline expired', async () => {
            bookings[0].driverDecisionDeadlineAt = new Date(Date.now() - 1000);

            await expect(
                acceptBooking('driver-1', bookings[0].id)
            ).rejects.toThrow('BOOKING_DECISION_DEADLINE_PASSED');
        });

        it('rejects OTP verification with wrong code', async () => {
            await acceptBooking('driver-1', bookings[0].id);

            bookings[0].status = 'CONFIRMED';
            bookings[0].pickupOtpHash = 'hash-123456';
            bookings[0].pickupOtpExpiresAt = new Date(Date.now() + 60_000);

            await expect(
                verifyPickupOtp('driver-1', bookings[0].id, '999999')
            ).rejects.toThrow('INVALID_PICKUP_OTP');

            expect(bookings[0].otpAttemptCount).toBe(1);
        });

        it('rejects cancel-after-accept on non-CONFIRMED booking', async () => {
            // Booking is still DRIVER_PENDING
            await expect(
                cancelAfterAccept('driver-1', bookings[0].id, 'changed mind')
            ).rejects.toThrow('BOOKING_NOT_CONFIRMED');
        });
    });

    // =========================================
    //  SEAT RELEASE: Reject and cancel flows
    // =========================================

    describe('Seat release on rejection/cancellation', () => {
        beforeEach(async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');
        });

        it('driver reject releases segment seats back', async () => {
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            await createBooking('passenger-1', {
                rideId: rides[0].id,
                seatsBooked: 2,
                pickupWaypointId: gatwickWp.id,
            });

            // Edges 1→2, 2→3 should have 2 occupied
            expect(segmentCapacities.find(e => e.fromPosition === 1)!.occupiedSeats).toBe(2);

            bookings[0].driverDecisionDeadlineAt = new Date(Date.now() + 60_000);
            await rejectBooking('driver-1', bookings[0].id, 'not available');

            // Seats released
            expect(segmentCapacities.find(e => e.fromPosition === 1)!.occupiedSeats).toBe(0);
            expect(segmentCapacities.find(e => e.fromPosition === 2)!.occupiedSeats).toBe(0);
            expect(rides[0].availableSeats).toBe(3);

            // Notification sent to passenger
            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'booking.driver.rejected',
                    userId: 'passenger-1',
                })
            );
        });

        it('passenger cancellation releases segment seats', async () => {
            await createBooking('passenger-1', {
                rideId: rides[0].id,
                seatsBooked: 1,
            });

            // All edges should have 1 occupied (full route)
            expect(segmentCapacities.every(e => e.occupiedSeats === 1)).toBe(true);

            const result = await cancelBooking('passenger-1', bookings[0].id);

            expect(result.refundPercent).toBeDefined();
            // Seats released
            expect(segmentCapacities.every(e => e.occupiedSeats === 0)).toBe(true);
            expect(rides[0].availableSeats).toBe(3);
        });

        it('driver cancel-after-accept releases seats and creates penalty', async () => {
            await createBooking('passenger-1', {
                rideId: rides[0].id,
                seatsBooked: 1,
            });

            bookings[0].driverDecisionDeadlineAt = new Date(Date.now() + 60_000);
            await acceptBooking('driver-1', bookings[0].id);

            // Simulate confirmed state
            bookings[0].status = 'CONFIRMED';
            bookings[0].paymentCapturedAt = new Date();
            bookings[0].paymentAmount = 30;
            bookings[0].totalPrice = 30;

            await cancelAfterAccept('driver-1', bookings[0].id, 'emergency');

            // Seats released
            expect(segmentCapacities.every(e => e.occupiedSeats === 0)).toBe(true);
            expect(rides[0].availableSeats).toBe(3);
        });
    });

    // =========================================
    //  PUBLISH VALIDATION
    // =========================================

    describe('Publish validation failures', () => {
        it('rejects publish without origin', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ originPlaceId: null }));

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('ORIGIN_AND_DESTINATION_REQUIRED');
        });

        it('rejects publish without destination', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ destinationPlaceId: null }));

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('ORIGIN_AND_DESTINATION_REQUIRED');
        });

        it('rejects publish without route', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ routePolyline: null }));

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('ROUTE_REQUIRED');
        });

        it('rejects publish without schedule', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ departureDate: null }));

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('SCHEDULE_REQUIRED');
        });

        it('rejects publish without capacity', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ totalSeats: 0 }));

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('CAPACITY_AND_PRICING_REQUIRED');
        });

        it('rejects publish when driver has no ToS', async () => {
            users[0].tosAcceptedAt = null;
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('TOS_NOT_ACCEPTED');
        });

        it('rejects publish when driver DL not verified', async () => {
            users[0].dlVerified = false;
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('DRIVER_NOT_VERIFIED');
        });

        it('rejects publish when no vehicle', async () => {
            vehicles.length = 0;
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());

            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('VEHICLE_REQUIRED');
        });
    });

    // =========================================
    //  FEMALE-ONLY RIDE
    // =========================================

    describe('Female-only ride enforcement', () => {
        beforeEach(async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ femaleOnly: true }));
            await DraftRideService.publishRide('driver-1');
        });

        it('allows female passenger to book female-only ride', async () => {
            // passenger-2 has salutation MS
            const booking = await createBooking('passenger-2', {
                rideId: rides[0].id,
                seatsBooked: 1,
            });
            expect(booking.status).toBe('DRIVER_PENDING');
        });

        it('rejects male passenger from booking female-only ride', async () => {
            // passenger-1 has salutation MR
            await expect(
                createBooking('passenger-1', {
                    rideId: rides[0].id,
                    seatsBooked: 1,
                })
            ).rejects.toThrow('FEMALE_ONLY_RIDE');
        });
    });

    // =========================================
    //  MULTI-BOOKING CAPACITY SCENARIOS
    // =========================================

    describe('Multi-booking capacity scenarios', () => {
        it('three passengers fill a 3-seat ride on different segments', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ totalSeats: 3 }));
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;
            const crawleyWp = waypoints.find(w => w.placeId === 'place-crawley')!;

            // P1: full route, 1 seat → all edges get +1
            await createBooking('passenger-1', { rideId, seatsBooked: 1 });

            // P2: origin → gatwick, 2 seats → edge 0→1 gets +2
            // (Need a third user)
            users.push({ id: 'passenger-3', name: 'Dave', avatarUrl: null, tosAcceptedAt: new Date(), isBanned: false, dlVerified: false, salutation: 'MR' });
            await createBooking('passenger-2', { rideId, seatsBooked: 2, dropoffWaypointId: gatwickWp.id });

            // Edge 0→1: 1 + 2 = 3 (full!)
            expect(segmentCapacities.find(e => e.fromPosition === 0)!.occupiedSeats).toBe(3);
            // Edge 1→2: 1 (only P1)
            expect(segmentCapacities.find(e => e.fromPosition === 1)!.occupiedSeats).toBe(1);
            // Edge 2→3: 1 (only P1)
            expect(segmentCapacities.find(e => e.fromPosition === 2)!.occupiedSeats).toBe(1);

            // P3: crawley → destination, 2 seats should succeed (edge 2→3 has only 1)
            await createBooking('passenger-3', { rideId, seatsBooked: 2, pickupWaypointId: crawleyWp.id });

            expect(segmentCapacities.find(e => e.fromPosition === 2)!.occupiedSeats).toBe(3);
            expect(rides[0].availableSeats).toBe(0);
        });

        it('rejects booking when one edge in range is full', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({ totalSeats: 2 }));
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;

            // P1: full route, 2 seats → all edges full
            await createBooking('passenger-1', { rideId, seatsBooked: 2 });

            // P2: gatwick → destination, 1 seat → edges 1→2, 2→3 are already at 2
            await expect(
                createBooking('passenger-2', {
                    rideId,
                    seatsBooked: 1,
                    pickupWaypointId: gatwickWp.id,
                })
            ).rejects.toThrow('INSUFFICIENT_SEATS');
        });
    });

    // =========================================
    //  SNAPSHOT INTEGRITY
    // =========================================

    describe('Booking snapshot fields', () => {
        it('stores pickup/dropoff address and segment fare at booking time', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            const rideId = rides[0].id;
            const gatwickWp = waypoints.find(w => w.placeId === 'place-gatwick')!;
            const crawleyWp = waypoints.find(w => w.placeId === 'place-crawley')!;

            await createBooking('passenger-1', {
                rideId,
                seatsBooked: 1,
                pickupWaypointId: gatwickWp.id,
                dropoffWaypointId: crawleyWp.id,
            });

            const booking = bookings[0];
            expect(booking.pickupAddress).toBe('Gatwick Airport');
            expect(booking.dropoffAddress).toBe('Crawley Town');
            expect(booking.segmentFare).toBe(10); // 22 - 12
            expect(booking.pickupPosition).toBe(1);
            expect(booking.dropoffPosition).toBe(2);
        });

        it('stores positions 0 and 3 for full-route booking', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft());
            await DraftRideService.publishRide('driver-1');

            await createBooking('passenger-1', {
                rideId: rides[0].id,
                seatsBooked: 1,
            });

            const booking = bookings[0];
            expect(booking.pickupPosition).toBe(0);
            expect(booking.dropoffPosition).toBe(3);
            expect(booking.pickupAddress).toBe('London Victoria');
            expect(booking.dropoffAddress).toBe('Brighton Station');
            expect(booking.segmentFare).toBe(30);
        });
    });

    // =========================================
    //  RIDE WITH NO STOPOVERS
    // =========================================

    describe('Ride without stopovers', () => {
        it('publishes with single edge (0→1) and full-route booking works', async () => {
            draftStore[DRAFT_KEY] = JSON.stringify(buildCompleteDraft({
                stopovers: [],
                stopoverPricingByPlaceId: {},
            }));
            await DraftRideService.publishRide('driver-1');

            // 0 stopovers = 1 edge
            const edges = segmentCapacities.filter(sc => sc.rideId === rides[0].id);
            expect(edges).toHaveLength(1);
            expect(edges[0].fromPosition).toBe(0);
            expect(edges[0].toPosition).toBe(1);

            const booking = await createBooking('passenger-1', {
                rideId: rides[0].id,
                seatsBooked: 1,
            });

            expect(booking.totalPrice).toBe(30);
            expect(edges[0].occupiedSeats).toBe(1);
        });
    });
});
