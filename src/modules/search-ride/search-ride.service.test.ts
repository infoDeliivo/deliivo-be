const mockPrisma = {
    ride: {
        findMany: jest.fn(),
        groupBy: jest.fn(),
    },
    vehicle: {
        findMany: jest.fn(),
    },
    user: {
        findUnique: jest.fn(),
    },
    userRatingStats: {
        findMany: jest.fn(),
    },
    rideBooking: {
        groupBy: jest.fn(),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { searchRidesAdvanced } from './search-ride.service';
import { decodeViewToken } from './view-token.utils';

describe('searchRidesAdvanced segment shaping', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.vehicle.findMany.mockResolvedValue([]);
        mockPrisma.ride.groupBy.mockResolvedValue([]);
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.userRatingStats.findMany.mockResolvedValue([]);
        mockPrisma.rideBooking.groupBy.mockResolvedValue([]);
    });

    it('returns matched segment addresses, segment fare, bookingContext, and segmentId', async () => {
        mockPrisma.ride.findMany.mockResolvedValue([
            {
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
                routePolyline: 'abcd',
                departureDate: new Date('2026-03-30T00:00:00.000Z'),
                departureTime: '10:00',
                availableSeats: 3,
                basePricePerSeat: 30,
                currency: 'GBP',
                status: 'PUBLISHED',
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
            },
        ]);

        const result = await searchRidesAdvanced({
            originLat: 2,
            originLng: 2,
            destinationLat: 3,
            destinationLng: 3,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            page: 1,
            limit: 10,
            radiusKm: 5,
        });

        expect(result.rides[0]).toMatchObject({
            id: 'ride-1',
            originAddress: 'B',
            destinationAddress: 'C',
            basePricePerSeat: 10,
            isSegmentView: true,
            segment: {
                pickupCumulativePrice: 10,
                dropCumulativePrice: 20,
                segmentFare: 10,
            },
        });
        expect(result.rides[0].segmentId).toEqual(expect.any(String));

        const payload = decodeViewToken(result.rides[0].segmentId as string);
        expect(payload).toMatchObject({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'waypoint:wp-b',
            dropRef: 'waypoint:wp-c',
        });
    });

    it('keeps a ride when full-ride base price exceeds maxPrice but the matched segment fare does not', async () => {
        mockPrisma.ride.findMany.mockResolvedValue([
            {
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
                routePolyline: 'abcd',
                departureDate: new Date('2026-03-30T00:00:00.000Z'),
                departureTime: '10:00',
                availableSeats: 3,
                basePricePerSeat: 30,
                currency: 'GBP',
                status: 'PUBLISHED',
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
            },
        ]);

        const result = await searchRidesAdvanced({
            originLat: 2,
            originLng: 2,
            destinationLat: 3,
            destinationLng: 3,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            maxPrice: 15,
            page: 1,
            limit: 10,
            radiusKm: 5,
        });

        expect(result.rides).toHaveLength(1);
        expect(result.rides[0]).toMatchObject({
            id: 'ride-1',
            basePricePerSeat: 10,
            isSegmentView: true,
        });
    });

    it('keeps full-ride origin, destination, and price for exact route matches', async () => {
        mockPrisma.ride.findMany.mockResolvedValue([
            {
                id: 'ride-2',
                driverId: 'driver-2',
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
                routePolyline: 'abcd',
                departureDate: new Date('2026-03-30T00:00:00.000Z'),
                departureTime: '10:00',
                availableSeats: 3,
                basePricePerSeat: 30,
                currency: 'GBP',
                status: 'PUBLISHED',
                bookings: [],
                driver: { id: 'driver-2', name: 'Driver', avatarUrl: null },
                waypoints: [],
            },
        ]);

        const result = await searchRidesAdvanced({
            originLat: 1,
            originLng: 1,
            destinationLat: 4,
            destinationLng: 4,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            page: 1,
            limit: 10,
            radiusKm: 5,
        });

        expect(result.rides[0]).toMatchObject({
            id: 'ride-2',
            originAddress: 'A',
            destinationAddress: 'D',
            basePricePerSeat: 30,
        });
        expect(result.rides[0].isSegmentView).toBeFalsy();
        expect(result.rides[0].bookingContext).toBeUndefined();
        expect(result.rides[0].segmentId).toBeUndefined();
    });

    it('keeps women-only rides hidden for guests', async () => {
        mockPrisma.ride.findMany.mockResolvedValue([]);

        await searchRidesAdvanced({
            originLat: 1,
            originLng: 1,
            destinationLat: 2,
            destinationLng: 2,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            page: 1,
            limit: 10,
            radiusKm: 5,
        });

        expect(mockPrisma.ride.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ femaleOnly: false }),
        }));
    });

    it('allows women-only rides into candidate search for female viewers', async () => {
        mockPrisma.ride.findMany.mockResolvedValue([]);
        mockPrisma.user.findUnique.mockResolvedValue({ gender: 'FEMALE' });

        await searchRidesAdvanced({
            originLat: 1,
            originLng: 1,
            destinationLat: 2,
            destinationLng: 2,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            page: 1,
            limit: 10,
            radiusKm: 5,
        }, 'female-viewer');

        const call = mockPrisma.ride.findMany.mock.calls[0][0];
        expect(call.where.femaleOnly).toBeUndefined();
    });

    it('filters exclusively to women-only rides when a female viewer requests it', async () => {
        mockPrisma.ride.findMany.mockResolvedValue([]);
        mockPrisma.user.findUnique.mockResolvedValue({ gender: 'FEMALE' });

        await searchRidesAdvanced({
            originLat: 1,
            originLng: 1,
            destinationLat: 2,
            destinationLng: 2,
            departureDate: new Date('2026-03-30T00:00:00.000Z'),
            femaleOnly: true,
            page: 1,
            limit: 10,
            radiusKm: 5,
        }, 'female-viewer');

        expect(mockPrisma.ride.findMany.mock.calls[0][0].where.femaleOnly).toBe(true);
    });
});
