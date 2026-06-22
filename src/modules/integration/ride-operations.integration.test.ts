/**
 * Integration Test: Ride Operations Lifecycle
 *
 * Tests the full operational flow after booking is confirmed:
 * Start Ride → Driver Arrived → OTP Verify → Onboard → Dropoff → Finish Ride
 * Plus edge cases: no-show, missed pickup, geofence, offline sync
 */

// ============================================================
//  IN-MEMORY STATE
// ============================================================

type MockRide = {
    id: string;
    driverId: string;
    status: string;
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    actualStartTime: Date | null;
    actualEndTime: Date | null;
    currentStopSequence: number | null;
    waypoints: MockWaypoint[];
    bookings: MockBooking[];
};

type MockWaypoint = {
    id: string;
    rideId: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: string;
    orderIndex: number;
};

type MockBooking = {
    id: string;
    rideId: string;
    passengerId: string;
    status: string;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    pickupOtpHash: string | null;
    pickupOtpExpiresAt: Date | null;
    otpAttemptCount: number;
    driverArrivedAt: Date | null;
    waitTimerStartedAt: Date | null;
    onboardedAt: Date | null;
    pickupOtpVerifiedAt: Date | null;
    dropoffConfirmedAt: Date | null;
    riderDropoffConfirmedAt: Date | null;
    noShowMarkedAt: Date | null;
    completedAt: Date | null;
    ride?: MockRide;
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
};

type MockLocation = {
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

let rides: MockRide[] = [];
let bookings: MockBooking[] = [];
let rideEvents: MockRideEvent[] = [];
let locations: MockLocation[] = [];
let idCounter = 0;

const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

const resetState = () => {
    rides = [];
    bookings = [];
    rideEvents = [];
    locations = [];
    idCounter = 0;
};

// ============================================================
//  MOCKS
// ============================================================

const mockCreateNotification = jest.fn().mockResolvedValue(undefined);

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../ride-booking/booking-otp.utils.js', () => ({
    __esModule: true,
    generateBookingOtp: () => '123456',
    hashOtp: (otp: string) => `sha256-${otp}`,
    isOtpValid: (plain: string, hash: string) => `sha256-${plain}` === hash,
}));

const mockPrisma: any = {
    ride: {
        findUnique: jest.fn(async ({ where, include, select }: any) => {
            const ride = rides.find(r => r.id === where.id);
            if (!ride) return null;
            const result: any = select
                ? { id: ride.id, driverId: ride.driverId, status: ride.status }
                : { ...ride };
            if (include?.bookings) {
                const filter = include.bookings.where;
                let rideBookings = bookings.filter(b => b.rideId === ride.id);
                if (filter?.status?.in) {
                    rideBookings = rideBookings.filter(b => filter.status.in.includes(b.status));
                }
                if (include.bookings.select) {
                    result.bookings = rideBookings.map(b => ({
                        id: b.id,
                        status: b.status,
                    }));
                } else {
                    result.bookings = rideBookings;
                }
            }
            if (include?.waypoints) {
                result.waypoints = rides.find(r => r.id === where.id)?.waypoints ?? [];
            }
            return result;
        }),
        update: jest.fn(async ({ where, data }: any) => {
            const ride = rides.find(r => r.id === where.id);
            if (!ride) return null;
            if (data.status) ride.status = data.status;
            if (data.actualStartTime) ride.actualStartTime = data.actualStartTime;
            if (data.actualEndTime) ride.actualEndTime = data.actualEndTime;
            if (data.currentStopSequence !== undefined) ride.currentStopSequence = data.currentStopSequence;
            return ride;
        }),
    },
    rideBooking: {
        findUnique: jest.fn(async ({ where, include }: any) => {
            const b = bookings.find(bk => bk.id === where.id);
            if (!b) return null;
            const result: any = { ...b };
            if (include?.ride) {
                const ride = rides.find(r => r.id === b.rideId)!;
                result.ride = { ...ride };
                if (include.ride.include?.waypoints) {
                    result.ride.waypoints = ride.waypoints;
                }
            }
            return result;
        }),
        update: jest.fn(async ({ where, data }: any) => {
            const b = bookings.find(bk => bk.id === where.id);
            if (!b) return null;
            for (const [key, val] of Object.entries(data)) {
                if (key === 'otpAttemptCount' && typeof val === 'object' && (val as any).increment) {
                    b.otpAttemptCount += (val as any).increment;
                } else if (val !== undefined && typeof val !== 'object') {
                    (b as any)[key] = val;
                } else if (val instanceof Date) {
                    (b as any)[key] = val;
                }
            }
            return b;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
            const matching = bookings.filter(b => {
                if (b.rideId !== where.rideId) return false;
                if (where.status && b.status !== where.status) return false;
                return true;
            });
            for (const b of matching) {
                if (data.status) b.status = data.status;
            }
            return { count: matching.length };
        }),
    },
    rideEvent: {
        findUnique: jest.fn(async ({ where }: any) => {
            return rideEvents.find(e => e.actionId === where.actionId) ?? null;
        }),
        create: jest.fn(async ({ data }: any) => {
            const event: MockRideEvent = {
                id: nextId('event'),
                rideId: data.rideId,
                bookingId: data.bookingId,
                actionId: data.actionId,
                eventType: data.eventType,
                actorType: data.actorType,
                actorId: data.actorId,
                lat: data.lat,
                lng: data.lng,
                clientTimestamp: data.clientTimestamp,
                serverTimestamp: new Date(),
                validationStatus: 'VALID',
            };
            rideEvents.push(event);
            return event;
        }),
    },
    locationUpdate: {
        create: jest.fn(async ({ data }: any) => {
            const loc: MockLocation = {
                id: nextId('loc'),
                rideId: data.rideId,
                driverId: data.driverId,
                lat: data.lat,
                lng: data.lng,
                speed: data.speed,
                heading: data.heading,
                accuracy: data.accuracy,
                timestamp: data.timestamp,
                createdAt: new Date(),
            };
            locations.push(loc);
            return loc;
        }),
        findFirst: jest.fn(async ({ where, orderBy }: any) => {
            const matching = locations
                .filter(l => l.rideId === where.rideId)
                .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
            return matching[0] ?? null;
        }),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
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
    reportMissedPickup,
    submitLocation,
    getLatestLocation,
    syncOfflineActions,
} from '../ride-operations/ride-operations.service';

// ============================================================
//  HELPERS
// ============================================================

const createTestRide = (overrides: Partial<MockRide> = {}): MockRide => {
    const ride: MockRide = {
        id: nextId('ride'),
        driverId: 'driver-1',
        status: 'IN_PROGRESS',
        originLat: 51.495,
        originLng: -0.144,
        destinationLat: 50.829,
        destinationLng: -0.141,
        actualStartTime: null,
        actualEndTime: null,
        currentStopSequence: null,
        waypoints: [],
        bookings: [],
        ...overrides,
    };
    rides.push(ride);
    return ride;
};

const createTestBooking = (rideId: string, overrides: Partial<MockBooking> = {}): MockBooking => {
    const booking: MockBooking = {
        id: nextId('booking'),
        rideId,
        passengerId: 'passenger-1',
        status: 'CONFIRMED',
        pickupWaypointId: null,
        dropoffWaypointId: null,
        pickupOtpHash: 'sha256-123456',
        pickupOtpExpiresAt: new Date(Date.now() + 3600_000),
        otpAttemptCount: 0,
        driverArrivedAt: null,
        waitTimerStartedAt: null,
        onboardedAt: null,
        pickupOtpVerifiedAt: null,
        dropoffConfirmedAt: null,
        riderDropoffConfirmedAt: null,
        noShowMarkedAt: null,
        completedAt: null,
        ...overrides,
    };
    bookings.push(booking);
    return booking;
};

const eventInput = (actionId?: string) => ({
    actionId: actionId ?? nextId('action'),
    lat: 51.495,
    lng: -0.144,
    clientTimestamp: new Date().toISOString(),
});

// ============================================================
//  TESTS
// ============================================================

describe('Integration: Ride Operations Lifecycle', () => {
    beforeEach(() => {
        resetState();
        jest.clearAllMocks();
    });

    // =========================================
    //  HAPPY PATH: Full operational lifecycle
    // =========================================

    describe('Happy Path: Complete ride lifecycle', () => {
        it('starts a ride and moves confirmed bookings to WAITING_FOR_PICKUP', async () => {
            const ride = createTestRide({ status: 'PUBLISHED' });
            const booking = createTestBooking(ride.id, { status: 'CONFIRMED' });

            const result = await startRide('driver-1', ride.id, eventInput());

            expect(result.status).toBe('IN_PROGRESS');
            expect(result.actualStartTime).toBeDefined();
            expect(ride.status).toBe('IN_PROGRESS');
            expect(booking.status).toBe('WAITING_FOR_PICKUP');

            // Event recorded
            expect(rideEvents).toHaveLength(1);
            expect(rideEvents[0].eventType).toBe('RIDE_STARTED');

            // Passenger notified
            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'passenger-1',
                    type: 'ride.started',
                })
            );
        });

        it('driver arrives at pickup and starts wait timer', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'WAITING_FOR_PICKUP' });

            const result = await driverArrived('driver-1', {
                bookingId: booking.id,
                ...eventInput(),
            });

            expect(result.status).toBe('DRIVER_ARRIVED');
            expect(result.driverArrivedAt).toBeDefined();
            expect(result.waitTimerStartedAt).toBeDefined();
            expect(result.geofenceValid).toBe(true); // coords match origin

            expect(booking.status).toBe('DRIVER_ARRIVED');
            expect(booking.driverArrivedAt).toBeDefined();

            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'passenger-1',
                    type: 'booking.driver_arrived',
                })
            );
        });

        it('verifies pickup OTP and boards passenger', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'DRIVER_ARRIVED' });

            const result = await verifyPickupAndBoard('driver-1', booking.id, '123456', eventInput());

            expect(result.status).toBe('ONBOARD');
            expect(result.onboardedAt).toBeDefined();
            expect(booking.status).toBe('ONBOARD');
            expect(booking.pickupOtpVerifiedAt).toBeDefined();
        });

        it('driver confirms dropoff and rider confirms', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'ONBOARD' });

            // Driver confirms
            const dropResult = await confirmDropoff('driver-1', {
                bookingId: booking.id,
                ...eventInput(),
            });

            expect(dropResult.status).toBe('DROP_PENDING');
            expect(booking.status).toBe('DROP_PENDING');

            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'passenger-1',
                    type: 'booking.dropoff_pending',
                })
            );

            // Rider confirms
            const riderResult = await riderConfirmDropoff('passenger-1', booking.id, eventInput());

            expect(riderResult.status).toBe('COMPLETED');
            expect(booking.status).toBe('COMPLETED');
            expect(booking.completedAt).toBeDefined();
        });

        it('finishes ride after all bookings are terminal', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'COMPLETED' });

            const result = await finishRide('driver-1', ride.id, eventInput());

            expect(result.status).toBe('COMPLETED');
            expect(result.actualEndTime).toBeDefined();
            expect(ride.status).toBe('COMPLETED');
        });

        it('full flow: start → arrive → OTP → dropoff → finish', async () => {
            // 1. Start ride
            const ride = createTestRide({ status: 'PUBLISHED' });
            const booking = createTestBooking(ride.id, { status: 'CONFIRMED' });

            await startRide('driver-1', ride.id, eventInput());
            expect(booking.status).toBe('WAITING_FOR_PICKUP');

            // 2. Driver arrives
            await driverArrived('driver-1', { bookingId: booking.id, ...eventInput() });
            expect(booking.status).toBe('DRIVER_ARRIVED');

            // 3. OTP verification
            await verifyPickupAndBoard('driver-1', booking.id, '123456', eventInput());
            expect(booking.status).toBe('ONBOARD');

            // 4. Driver confirms drop-off
            await confirmDropoff('driver-1', { bookingId: booking.id, ...eventInput() });
            expect(booking.status).toBe('DROP_PENDING');

            // 5. Rider confirms
            await riderConfirmDropoff('passenger-1', booking.id, eventInput());
            expect(booking.status).toBe('COMPLETED');

            // 6. Finish ride
            await finishRide('driver-1', ride.id, eventInput());
            expect(ride.status).toBe('COMPLETED');

            // 6 events recorded
            expect(rideEvents).toHaveLength(6);
        });
    });

    // =========================================
    //  NO-SHOW FLOW
    // =========================================

    describe('No-Show flow', () => {
        it('marks no-show after wait time elapsed', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, {
                status: 'DRIVER_ARRIVED',
                waitTimerStartedAt: new Date(Date.now() - 11 * 60_000), // 11 min ago
            });

            const result = await markNoShow('driver-1', { bookingId: booking.id, ...eventInput() });

            expect(result.status).toBe('NO_SHOW');
            expect(booking.noShowMarkedAt).toBeDefined();

            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'passenger-1',
                    type: 'booking.no_show',
                })
            );
        });

        it('rejects no-show before wait time elapsed', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, {
                status: 'DRIVER_ARRIVED',
                waitTimerStartedAt: new Date(Date.now() - 5 * 60_000), // only 5 min
            });

            await expect(
                markNoShow('driver-1', { bookingId: booking.id, ...eventInput() })
            ).rejects.toThrow('WAIT_TIME_NOT_ELAPSED');
        });

        it('finishes ride with no-show booking (terminal state)', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'NO_SHOW' });

            const result = await finishRide('driver-1', ride.id, eventInput());
            expect(result.status).toBe('COMPLETED');
        });
    });

    // =========================================
    //  MISSED PICKUP FLOW
    // =========================================

    describe('Missed Pickup flow', () => {
        it('rider reports missed pickup', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'WAITING_FOR_PICKUP' });

            const result = await reportMissedPickup('passenger-1', booking.id, eventInput());

            expect(result.status).toBe('DRIVER_MISSED_PICKUP');
            expect(booking.status).toBe('DRIVER_MISSED_PICKUP');
        });

        it('rejects missed pickup from non-passenger', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'WAITING_FOR_PICKUP' });

            await expect(
                reportMissedPickup('other-user', booking.id, eventInput())
            ).rejects.toThrow('FORBIDDEN_PASSENGER');
        });

        it('rejects missed pickup if booking is already onboard', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'ONBOARD' });

            await expect(
                reportMissedPickup('passenger-1', booking.id, eventInput())
            ).rejects.toThrow('BOOKING_NOT_WAITING_FOR_PICKUP');
        });
    });

    // =========================================
    //  OTP VALIDATION EDGE CASES
    // =========================================

    describe('OTP verification edge cases', () => {
        it('rejects wrong OTP and increments attempt count', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, { status: 'DRIVER_ARRIVED' });

            await expect(
                verifyPickupAndBoard('driver-1', booking.id, '999999', eventInput())
            ).rejects.toThrow('INVALID_PICKUP_OTP');

            expect(booking.otpAttemptCount).toBe(1);
        });

        it('rejects after 5 failed attempts', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, {
                status: 'DRIVER_ARRIVED',
                otpAttemptCount: 5,
            });

            await expect(
                verifyPickupAndBoard('driver-1', booking.id, '123456', eventInput())
            ).rejects.toThrow('OTP_ATTEMPT_LIMIT_EXCEEDED');
        });

        it('rejects expired OTP', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, {
                status: 'DRIVER_ARRIVED',
                pickupOtpExpiresAt: new Date(Date.now() - 1000), // expired
            });

            await expect(
                verifyPickupAndBoard('driver-1', booking.id, '123456', eventInput())
            ).rejects.toThrow('PICKUP_OTP_EXPIRED');
        });

        it('rejects when OTP hash not set', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const booking = createTestBooking(ride.id, {
                status: 'DRIVER_ARRIVED',
                pickupOtpHash: null,
            });

            await expect(
                verifyPickupAndBoard('driver-1', booking.id, '123456', eventInput())
            ).rejects.toThrow('PICKUP_OTP_NOT_AVAILABLE');
        });
    });

    // =========================================
    //  STATE VALIDATION
    // =========================================

    describe('State validation', () => {
        it('rejects start ride from non-driver', async () => {
            createTestRide({ status: 'PUBLISHED' });

            await expect(
                startRide('other-user', rides[0].id, eventInput())
            ).rejects.toThrow('FORBIDDEN_DRIVER');
        });

        it('rejects start ride if already completed', async () => {
            createTestRide({ status: 'COMPLETED' });

            await expect(
                startRide('driver-1', rides[0].id, eventInput())
            ).rejects.toThrow('INVALID_RIDE_STATE_TRANSITION');
        });

        it('rejects finish if bookings still non-terminal', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'ONBOARD' });

            await expect(
                finishRide('driver-1', ride.id, eventInput())
            ).rejects.toThrow('BOOKINGS_NOT_ALL_TERMINAL');
        });

        it('rejects finish if ride not in progress', async () => {
            createTestRide({ status: 'PUBLISHED' });

            await expect(
                finishRide('driver-1', rides[0].id, eventInput())
            ).rejects.toThrow('RIDE_NOT_IN_PROGRESS');
        });

        it('rejects driver-arrived if booking not waiting', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'CONFIRMED' });

            await expect(
                driverArrived('driver-1', { bookingId: bookings[0].id, ...eventInput() })
            ).rejects.toThrow('BOOKING_NOT_WAITING_FOR_PICKUP');
        });

        it('rejects confirm-dropoff if not onboard', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'WAITING_FOR_PICKUP' });

            await expect(
                confirmDropoff('driver-1', { bookingId: bookings[0].id, ...eventInput() })
            ).rejects.toThrow('BOOKING_NOT_ONBOARD');
        });

        it('rejects rider-confirm-dropoff if not drop-pending', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'ONBOARD' });

            await expect(
                riderConfirmDropoff('passenger-1', bookings[0].id, eventInput())
            ).rejects.toThrow('BOOKING_NOT_DROP_PENDING');
        });
    });

    // =========================================
    //  GEOFENCE
    // =========================================

    describe('Geofence validation', () => {
        it('returns geofenceValid=true when near pickup', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'WAITING_FOR_PICKUP' });

            // Same coords as origin
            const result = await driverArrived('driver-1', {
                bookingId: bookings[0].id,
                actionId: nextId('action'),
                lat: 51.495,
                lng: -0.144,
                clientTimestamp: new Date().toISOString(),
            });

            expect(result.geofenceValid).toBe(true);
        });

        it('returns geofenceValid=false when far from pickup', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'WAITING_FOR_PICKUP' });

            // 10km away
            const result = await driverArrived('driver-1', {
                bookingId: bookings[0].id,
                actionId: nextId('action'),
                lat: 51.6,
                lng: -0.3,
                clientTimestamp: new Date().toISOString(),
            });

            expect(result.geofenceValid).toBe(false);
        });

        it('returns geofenceValid=true for dropoff near destination', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'ONBOARD' });

            const result = await confirmDropoff('driver-1', {
                bookingId: bookings[0].id,
                actionId: nextId('action'),
                lat: 50.829,  // destination coords
                lng: -0.141,
                clientTimestamp: new Date().toISOString(),
            });

            expect(result.geofenceValid).toBe(true);
        });

        it('returns geofenceValid=false for dropoff far from destination', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'ONBOARD' });

            const result = await confirmDropoff('driver-1', {
                bookingId: bookings[0].id,
                actionId: nextId('action'),
                lat: 52.0,  // far away
                lng: 1.0,
                clientTimestamp: new Date().toISOString(),
            });

            expect(result.geofenceValid).toBe(false);
        });
    });

    // =========================================
    //  LIVE LOCATION TRACKING
    // =========================================

    describe('Location tracking', () => {
        it('records location and returns it as latest', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });

            await submitLocation('driver-1', ride.id, {
                lat: 51.5,
                lng: -0.12,
                speed: 60,
                heading: 180,
                accuracy: 10,
                timestamp: new Date().toISOString(),
            });

            expect(locations).toHaveLength(1);
            expect(locations[0].lat).toBe(51.5);
            expect(locations[0].speed).toBe(60);

            const latest = await getLatestLocation(ride.id);
            expect(latest).not.toBeNull();
            expect(latest!.lat).toBe(51.5);
        });

        it('rejects location if ride not in progress', async () => {
            createTestRide({ status: 'PUBLISHED' });

            await expect(
                submitLocation('driver-1', rides[0].id, {
                    lat: 51.5,
                    lng: -0.12,
                    timestamp: new Date().toISOString(),
                })
            ).rejects.toThrow('RIDE_NOT_IN_PROGRESS');
        });

        it('rejects location from non-driver', async () => {
            createTestRide({ status: 'IN_PROGRESS' });

            await expect(
                submitLocation('other-user', rides[0].id, {
                    lat: 51.5,
                    lng: -0.12,
                    timestamp: new Date().toISOString(),
                })
            ).rejects.toThrow('FORBIDDEN_DRIVER');
        });

        it('returns null when no locations exist', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const result = await getLatestLocation(ride.id);
            expect(result).toBeNull();
        });
    });

    // =========================================
    //  OFFLINE SYNC / IDEMPOTENCY
    // =========================================

    describe('Offline sync and idempotency', () => {
        it('processes new actions and deduplicates existing ones', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });

            const result = await syncOfflineActions('driver-1', [
                { actionId: 'action-new-1', eventType: 'GPS_UPDATE', rideId: ride.id, lat: 51.5, lng: -0.1, clientTimestamp: new Date().toISOString() },
                { actionId: 'action-new-2', eventType: 'GPS_UPDATE', rideId: ride.id, lat: 51.6, lng: -0.2, clientTimestamp: new Date().toISOString() },
            ]);

            expect(result.processed).toBe(2);
            expect(result.duplicates).toBe(0);
            expect(rideEvents).toHaveLength(2);

            // Re-send same actions → should be duplicates
            const result2 = await syncOfflineActions('driver-1', [
                { actionId: 'action-new-1', eventType: 'GPS_UPDATE', rideId: ride.id, lat: 51.5, lng: -0.1, clientTimestamp: new Date().toISOString() },
            ]);

            expect(result2.processed).toBe(0);
            expect(result2.duplicates).toBe(1);
            expect(rideEvents).toHaveLength(2); // no new events
        });

        it('recordEvent is idempotent — same actionId does not create duplicate', async () => {
            const ride = createTestRide({ status: 'PUBLISHED' });
            createTestBooking(ride.id, { status: 'CONFIRMED' });

            const input = eventInput('fixed-action-id');

            await startRide('driver-1', ride.id, input);
            expect(rideEvents).toHaveLength(1);

            // Reset ride state to test re-call
            ride.status = 'PUBLISHED';
            bookings[0].status = 'CONFIRMED';

            await startRide('driver-1', ride.id, input);
            // Same actionId → event not duplicated
            expect(rideEvents).toHaveLength(1);
        });
    });

    // =========================================
    //  MULTI-BOOKING SCENARIOS
    // =========================================

    describe('Multi-booking ride', () => {
        it('finishes ride only after all bookings are terminal', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            const b1 = createTestBooking(ride.id, { status: 'COMPLETED', passengerId: 'p1' });
            const b2 = createTestBooking(ride.id, { status: 'ONBOARD', passengerId: 'p2' });

            // Can't finish — b2 is still ONBOARD
            await expect(
                finishRide('driver-1', ride.id, eventInput())
            ).rejects.toThrow('BOOKINGS_NOT_ALL_TERMINAL');

            // Complete b2
            b2.status = 'DROP_PENDING';
            await riderConfirmDropoff('p2', b2.id, eventInput());

            // Now both are terminal
            await finishRide('driver-1', ride.id, eventInput());
            expect(ride.status).toBe('COMPLETED');
        });

        it('handles mix of no-show and completed bookings', async () => {
            const ride = createTestRide({ status: 'IN_PROGRESS' });
            createTestBooking(ride.id, { status: 'COMPLETED', passengerId: 'p1' });
            createTestBooking(ride.id, { status: 'NO_SHOW', passengerId: 'p2' });
            createTestBooking(ride.id, { status: 'DRIVER_MISSED_PICKUP', passengerId: 'p3' });

            // All are terminal
            const result = await finishRide('driver-1', ride.id, eventInput());
            expect(result.status).toBe('COMPLETED');
        });

        it('start ride moves only CONFIRMED bookings, not DRIVER_PENDING', async () => {
            const ride = createTestRide({ status: 'PUBLISHED' });
            const confirmed = createTestBooking(ride.id, { status: 'CONFIRMED', passengerId: 'p1' });
            const pending = createTestBooking(ride.id, { status: 'DRIVER_PENDING', passengerId: 'p2' });

            await startRide('driver-1', ride.id, eventInput());

            expect(confirmed.status).toBe('WAITING_FOR_PICKUP');
            expect(pending.status).toBe('DRIVER_PENDING'); // unchanged
        });
    });
});
