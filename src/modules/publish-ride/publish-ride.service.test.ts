const mockPrisma = {
    ride: {
        findFirst: jest.fn(),
    },
    rideRating: {
        findMany: jest.fn().mockResolvedValue([]),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    // withPrismaFallback: unlisted models/methods resolve empty instead of throwing.
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

import { getRideById } from './publish-ride.service.js';

const RIDE_ID = 'ride-1';
const DRIVER_ID = 'driver-1';

const booking = (over: Record<string, unknown> = {}) => ({
    id: `booking-${Math.random().toString(36).slice(2, 8)}`,
    rideId: RIDE_ID,
    status: 'CONFIRMED',
    seatsBooked: 1,
    seatsReservedAt: new Date(),
    totalPrice: 10,
    pickupWaypointId: null,
    dropoffWaypointId: null,
    driverDecisionDeadlineAt: null,
    passenger: { id: 'p', firstName: 'A', lastName: 'B', phone: null, avatarUrl: null },
    payment: null,
    ...over,
});

const rideWith = (bookings: unknown[], availableSeats: number) => ({
    id: RIDE_ID,
    driverId: DRIVER_ID,
    totalSeats: 3,
    availableSeats,
    currency: 'EUR',
    originAddress: 'A',
    originPlaceId: 'a',
    originLat: 0,
    originLng: 0,
    destinationAddress: 'B',
    destinationPlaceId: 'b',
    destinationLat: 1,
    destinationLng: 1,
    departureTime: '09:00',
    waypoints: [],
    bookings,
});

beforeEach(() => {
    jest.clearAllMocks();
});

describe('getRideById bookedSeats', () => {
    it('reports seats sold, not totalSeats - availableSeats', async () => {
        // Two whole-route riders and one segment rider on a 3-seat ride. The segment
        // booking only occupies part of the route, so availableSeats (peak occupancy)
        // is free to disagree — the driver must still see three seats sold.
        mockPrisma.ride.findFirst.mockResolvedValue(
            rideWith([booking(), booking(), booking()], 1)
        );

        const ride = await getRideById(DRIVER_ID, RIDE_ID) as any;

        expect(ride.bookedSeats).toBe(3);
        expect(ride.availableSeats).toBe(1);
    });

    it('sums seats rather than counting booking rows', async () => {
        mockPrisma.ride.findFirst.mockResolvedValue(
            rideWith([booking({ seatsBooked: 2 }), booking({ seatsBooked: 1 })], 0)
        );

        const ride = await getRideById(DRIVER_ID, RIDE_ID) as any;

        expect(ride.bookedSeats).toBe(3);
        expect(ride.bookings).toHaveLength(2);
    });

    it('excludes cancelled bookings and bookings that hold no seats', async () => {
        mockPrisma.ride.findFirst.mockResolvedValue(
            rideWith([
                booking(),
                // Released on cancel, but the status filter is the belt for rides
                // cancelled before seatsReservedAt was cleared.
                booking({ status: 'CANCELLED', seatsReservedAt: new Date() }),
                // Unpaid: holds nothing in stripe mode.
                booking({ status: 'DRIVER_PENDING', seatsReservedAt: null }),
            ], 2)
        );

        const ride = await getRideById(DRIVER_ID, RIDE_ID) as any;

        expect(ride.bookedSeats).toBe(1);
    });
});
