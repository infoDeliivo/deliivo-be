const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    on: jest.fn(),
};

const mockPrisma = {
    vehicle: {
        findFirst: jest.fn(),
    },
    user: {
        findUnique: jest.fn().mockResolvedValue({ dlVerified: true, tosAcceptedAt: new Date(), gender: 'FEMALE' }),
    },
    $transaction: jest.fn(),
};

const mockFuelPriceService = {
    getFuelPriceForCurrency: jest.fn(),
};

jest.mock('../../cache/redis.js', () => ({
    __esModule: true,
    default: mockRedis,
}));

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../../services/fuel-price.service.js', () => ({
    __esModule: true,
    getFuelPriceForCurrency: mockFuelPriceService.getFuelPriceForCurrency,
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: jest.fn().mockResolvedValue(undefined),
}));

import * as DraftRideService from './draft-ride.service';
import { RideStatus } from '@prisma/client';

describe('publishRide', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue({ dlVerified: true, tosAcceptedAt: new Date(), gender: 'FEMALE' });
    });

    it('does not persist caller-supplied stopover prices in distance-based pricing mode', async () => {
        const draft = {
            userId: 'driver-1',
            step: 10,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            basePricePerSeat: 30,
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));

        await DraftRideService.updatePricing('driver-1', {
            basePricePerSeat: 40,
            stopoverPricing: [
                { placeId: 'stop-a', pricePerSeat: 12.5 },
                { placeId: 'stop-b', pricePerSeat: 20 },
            ],
        });

        expect(mockRedis.setex).toHaveBeenCalledTimes(1);
        const savedDraft = JSON.parse(mockRedis.setex.mock.calls[0][2] as string);
        expect(savedDraft.stopoverPricingByPlaceId).toBeUndefined();
        expect(savedDraft.basePricePerSeat).toBe(40);
    });

    it('preserves existing stopover pricing when updatePricing omits stopoverPricing', async () => {
        const draft = {
            userId: 'driver-1',
            step: 12,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            basePricePerSeat: 30,
            stopoverPricingByPlaceId: {
                'stop-a': 12.5,
                'stop-b': 20,
            },
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));

        await DraftRideService.updatePricing('driver-1', {
            basePricePerSeat: 45,
        });

        expect(mockRedis.setex).toHaveBeenCalledTimes(1);
        const savedDraft = JSON.parse(mockRedis.setex.mock.calls[0][2] as string);
        expect(savedDraft.stopoverPricingByPlaceId).toEqual({
            'stop-a': 12.5,
            'stop-b': 20,
        });
        expect(savedDraft.basePricePerSeat).toBe(45);
    });

    it('persists distance-derived stopover prices and null when missing', async () => {
        const draft = {
            userId: 'driver-1',
            step: 13,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            originPlaceId: 'origin-place',
            originAddress: 'Origin',
            originLat: 10,
            originLng: 20,
            destinationPlaceId: 'destination-place',
            destinationAddress: 'Destination',
            destinationLat: 11,
            destinationLng: 21,
            routePolyline: 'encoded-polyline',
            departureDate: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            departureTime: '09:30',
            totalSeats: 3,
            basePricePerSeat: 40,
            currency: 'GBP',
            stopovers: [
                { placeId: 'stop-a', address: 'Stop A', lat: 12, lng: 22, recommendedPrice: 18.75 },
                { placeId: 'stop-b', address: 'Stop B', lat: 13, lng: 23 },
            ],
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));
        mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'vehicle-1' });

        const rideCreate = jest.fn().mockResolvedValue({ id: 'ride-1', departureTime: '09:30', routeDurationSeconds: 3600 });
        const rideWaypointCreateMany = jest.fn().mockResolvedValue(undefined);
        const rideFindUnique = jest.fn().mockResolvedValue({
            id: 'ride-1',
            status: RideStatus.PUBLISHED,
            departureDate: new Date('2026-04-01T00:00:00.000Z'),
            departureTime: '09:30',
            originAddress: 'Origin',
            destinationAddress: 'Destination',
            waypoints: [],
        });

        mockPrisma.$transaction.mockImplementation(async (callback: any) => {
            return callback({
                ride: {
                    create: rideCreate,
                    findUnique: rideFindUnique,
                },
                rideWaypoint: {
                    createMany: rideWaypointCreateMany,
                },
                rideSegmentCapacity: {
                    createMany: jest.fn().mockResolvedValue(undefined),
                },
            });
        });

        await DraftRideService.publishRide('driver-1');

        expect(rideWaypointCreateMany).toHaveBeenCalledWith({
            data: expect.arrayContaining([
                expect.objectContaining({
                    placeId: 'stop-a',
                    waypointType: 'STOPOVER',
                    pricePerSeat: 18.75,
                }),
                expect.objectContaining({
                    placeId: 'stop-b',
                    waypointType: 'STOPOVER',
                    pricePerSeat: null,
                }),
            ]),
        });
    });

    it('rejects female-only publish when driver gender is not FEMALE', async () => {
        const draft = {
            userId: 'driver-1',
            step: 13,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            originPlaceId: 'origin-place',
            originAddress: 'Origin',
            originLat: 10,
            originLng: 20,
            destinationPlaceId: 'destination-place',
            destinationAddress: 'Destination',
            destinationLat: 11,
            destinationLng: 21,
            routePolyline: 'encoded-polyline',
            departureDate: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            departureTime: '09:30',
            totalSeats: 3,
            basePricePerSeat: 40,
            femaleOnly: true,
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));
        mockPrisma.user.findUnique.mockResolvedValue({ dlVerified: true, tosAcceptedAt: new Date(), gender: 'MALE' });
        mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'vehicle-1' });

        await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('FEMALE_ONLY_NOT_ALLOWED');
    });

    it('marks ferry routes as not publishable and blocks final publish', async () => {
        const draft = {
            userId: 'driver-1',
            step: 2,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            originPlaceId: 'origin-place',
            originAddress: 'Origin',
            originLat: 10,
            originLng: 20,
            destinationPlaceId: 'destination-place',
            destinationAddress: 'Destination',
            destinationLat: 11,
            destinationLng: 21,
        };

        const fetchMock = jest.fn().mockResolvedValue({
            json: async () => ({
                routes: [
                    {
                        distanceMeters: 10000,
                        duration: '1200s',
                        description: 'Fastest route',
                        warnings: ['This route includes a ferry.'],
                        polyline: { encodedPolyline: 'encoded-polyline' },
                        legs: [
                            {
                                steps: [
                                    {
                                        travelMode: 'DRIVE',
                                        navigationInstruction: {
                                            maneuver: 'FERRY',
                                            instructions: 'Take the ferry',
                                        },
                                    },
                                ],
                            },
                        ],
                    },
                ],
            }),
        });

        const blockedDraft = {
            ...draft,
            routePolyline: 'encoded-polyline',
            routeDistanceMeters: 10000,
            routeDurationSeconds: 1200,
            routeIsPublishable: false,
            routeBlockedReason: 'NON_ROAD_ROUTE_NOT_ALLOWED',
            departureDate: new Date('2026-04-01T00:00:00.000Z').toISOString(),
            departureTime: '09:30',
            totalSeats: 3,
            basePricePerSeat: 40,
        };
        const cachedRoutes = JSON.stringify([
            {
                index: 0,
                polyline: 'encoded-polyline',
                distanceMeters: 10000,
                durationSeconds: 1200,
                distanceText: '10.0 km',
                durationText: '20 min',
                description: 'Fastest route',
                warnings: ['This route includes a ferry.'],
                isPublishable: false,
                blockedReason: 'NON_ROAD_ROUTE_NOT_ALLOWED',
            },
        ]);

        mockRedis.get
            .mockResolvedValueOnce(JSON.stringify(draft))
            .mockResolvedValueOnce(JSON.stringify(draft))
            .mockResolvedValueOnce(cachedRoutes)
            .mockResolvedValueOnce(JSON.stringify(blockedDraft));
        mockPrisma.vehicle.findFirst.mockResolvedValue({ id: 'vehicle-1' });

        const originalFetch = global.fetch;
        global.fetch = fetchMock as any;

        try {
            const result = await DraftRideService.computeRouteOptions('driver-1');
            expect(result.routes[0]).toMatchObject({
                isPublishable: false,
                blockedReason: 'NON_ROAD_ROUTE_NOT_ALLOWED',
            });

            await DraftRideService.selectRoute('driver-1', 0);
            await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('NON_ROAD_ROUTE_NOT_ALLOWED');
        } finally {
            global.fetch = originalFetch;
        }
    });
});
