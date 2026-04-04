const mockPrisma = {
    ride: {
        findFirst: jest.fn(),
    },
    vehicle: {
        findFirst: jest.fn(),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { getRideViewByToken, getRideSegmentById } from './search-ride.service';
import { encodeViewToken } from './view-token.utils';

describe('getRideViewByToken', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.vehicle.findFirst.mockResolvedValue(null);
    });

    it('returns the same B -> C rider-facing view selected from search', async () => {
        mockPrisma.ride.findFirst.mockResolvedValue({
            id: 'ride-1',
            driverId: 'driver-1',
            originPlaceId: 'place-a',
            originAddress: 'A',
            originLat: 1,
            originLng: 1,
            destinationPlaceId: 'place-d',
            destinationAddress: 'D',
            destinationLat: 4,
            destinationLng: 4,
            routeDistanceMeters: 1000,
            routeDurationSeconds: 600,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            departureTime: '10:00',
            totalSeats: 3,
            availableSeats: 3,
            basePricePerSeat: 30,
            currency: 'GBP',
            status: 'PUBLISHED',
            notes: null,
            bookings: [],
            driver: { id: 'driver-1', name: 'Driver', avatarUrl: null },
            waypoints: [
                {
                    id: 'wp-b',
                    placeId: 'place-b',
                    address: 'B',
                    lat: 2,
                    lng: 2,
                    orderIndex: 50,
                    waypointType: 'STOPOVER',
                    pricePerSeat: 10,
                },
                {
                    id: 'wp-c',
                    placeId: 'place-c',
                    address: 'C',
                    lat: 3,
                    lng: 3,
                    orderIndex: 51,
                    waypointType: 'STOPOVER',
                    pricePerSeat: 20,
                },
            ],
        });

        const token = encodeViewToken({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'waypoint:wp-b',
            dropRef: 'waypoint:wp-c',
        });

        const ride = await getRideViewByToken(token);

        expect(ride).toMatchObject({
            id: 'ride-1',
            originAddress: 'B',
            destinationAddress: 'C',
            basePricePerSeat: 10,
        });
    });

    it('rejects an invalid token before fetching ride data', async () => {
        await expect(getRideViewByToken('bad.token')).rejects.toThrow('INVALID_VIEW_TOKEN');
        expect(mockPrisma.ride.findFirst).not.toHaveBeenCalled();
    });
});

describe('getRideSegmentById', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.vehicle.findFirst.mockResolvedValue(null);
    });

    it('returns the same B -> C rider-facing view selected from search', async () => {
        mockPrisma.ride.findFirst.mockResolvedValue({
            id: 'ride-1',
            driverId: 'driver-1',
            originPlaceId: 'place-a',
            originAddress: 'A',
            originLat: 1,
            originLng: 1,
            destinationPlaceId: 'place-d',
            destinationAddress: 'D',
            destinationLat: 4,
            destinationLng: 4,
            routeDistanceMeters: 1000,
            routeDurationSeconds: 600,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            departureTime: '10:00',
            totalSeats: 3,
            availableSeats: 3,
            basePricePerSeat: 30,
            currency: 'GBP',
            status: 'PUBLISHED',
            notes: null,
            bookings: [],
            driver: { id: 'driver-1', name: 'Driver', avatarUrl: null },
            waypoints: [
                {
                    id: 'wp-b',
                    placeId: 'place-b',
                    address: 'B',
                    lat: 2,
                    lng: 2,
                    orderIndex: 50,
                    waypointType: 'STOPOVER',
                    pricePerSeat: 10,
                },
                {
                    id: 'wp-c',
                    placeId: 'place-c',
                    address: 'C',
                    lat: 3,
                    lng: 3,
                    orderIndex: 51,
                    waypointType: 'STOPOVER',
                    pricePerSeat: 20,
                },
            ],
        });

        const segmentId = encodeViewToken({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'waypoint:wp-b',
            dropRef: 'waypoint:wp-c',
        });

        const ride = await getRideSegmentById(segmentId);

        expect(ride).toMatchObject({
            id: 'ride-1',
            originAddress: 'B',
            destinationAddress: 'C',
            basePricePerSeat: 10,
        });
    });

    it('rejects an invalid segment id before fetching ride data', async () => {
        await expect(getRideSegmentById('bad.token')).rejects.toThrow('INVALID_SEGMENT_ID');
        expect(mockPrisma.ride.findFirst).not.toHaveBeenCalled();
    });
});
