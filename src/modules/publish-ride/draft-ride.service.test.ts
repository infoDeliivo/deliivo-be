const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    on: jest.fn(),
};

// A driver who satisfies every publish requirement. Tests that exercise a specific gate
// override the relevant field.
const eligibleDriver = {
    dlVerified: true,
    tosAcceptedAt: new Date(),
    gender: 'FEMALE',
    stripeOnboardingComplete: true,
};

const approvedVehicle = { id: 'vehicle-1', verificationStatus: 'APPROVED' };

const mockPrisma = {
    vehicle: {
        findFirst: jest.fn().mockResolvedValue(approvedVehicle),
    },
    user: {
        findUnique: jest.fn().mockResolvedValue(eligibleDriver),
    },
    dlVerification: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
    ride: {
        findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
};

const mockFuelPriceService = {
    getFuelPriceForCurrency: jest.fn(),
};

const mockGoogleService = {
    placeDetails: jest.fn(),
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

const mockPricingService = {
    getPricePreview: jest.fn(),
    resolveActiveFeeTerms: jest.fn(),
    validateAndSnapshotPricing: jest.fn().mockResolvedValue({ valid: true, snapshotId: 'snap-1' }),
};

jest.mock('../pricing/pricing.service.js', () => ({
    __esModule: true,
    DEFAULT_BALTIC_PRICING_CONFIG: {
        id: 'default-baltic-distance-pricing',
        regionCode: 'BALTIC',
        currency: 'EUR',
        minRatePerKm: 0.06,
        recommendedRatePerKm: 0.08,
        maxRatePerKm: 0.12,
        minimumSeatPrice: 3,
        roundingStrategy: 'NEAREST_EURO',
        serviceFeePercent: 2,
        serviceFeeFlat: 0,
    },
    getPricePreview: (...args: unknown[]) => mockPricingService.getPricePreview(...args),
    resolveActiveFeeTerms: (...args: unknown[]) => mockPricingService.resolveActiveFeeTerms(...args),
    validateAndSnapshotPricing: (...args: unknown[]) => mockPricingService.validateAndSnapshotPricing(...args),
}));

jest.mock('../maps/google.service.js', () => ({
    __esModule: true,
    googleService: mockGoogleService,
}));

import * as DraftRideService from './draft-ride.service';
import { RideStatus } from '@prisma/client';
import polyline from '@mapbox/polyline';

describe('publishRide', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue(eligibleDriver);
        mockPrisma.vehicle.findFirst.mockResolvedValue(approvedVehicle);
        mockPrisma.dlVerification.findFirst.mockResolvedValue(null);
        mockPrisma.ride.findMany.mockResolvedValue([]);
        mockGoogleService.placeDetails.mockResolvedValue({
            address_components: [{ short_name: 'EE', types: ['country'] }],
        });
    });

    it('rejects a draft origin outside Estonia, Latvia, and Lithuania', async () => {
        mockGoogleService.placeDetails.mockResolvedValue({
            address_components: [{ short_name: 'DE', types: ['country'] }],
        });

        await expect(DraftRideService.createWithOrigin('driver-1', {
            originPlaceId: 'place-berlin',
            originAddress: 'Berlin, Germany',
            originLat: 52.52,
            originLng: 13.405,
        })).rejects.toThrow('LOCATION_OUTSIDE_BALTICS');

        expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('allows a European destination for an outbound ride from the Baltics', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            userId: 'driver-1',
            step: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            originPlaceId: 'place-tallinn',
            originAddress: 'Tallinn, Estonia',
            originLat: 59.437,
            originLng: 24.7536,
        }));
        mockGoogleService.placeDetails.mockResolvedValue({
            address_components: [{ short_name: 'DE', types: ['country'] }],
        });

        await expect(DraftRideService.updateDestination('driver-1', {
            destinationPlaceId: 'place-hamburg',
            destinationAddress: 'Hamburg, Germany',
            destinationLat: 53.5511,
            destinationLng: 9.9937,
        })).resolves.toMatchObject({
            destinationAddress: 'Hamburg, Germany',
        });
    });

    it('requires at least one pickup and one drop-off before publishing', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({
            userId: 'driver-1',
            step: 13,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            originPlaceId: 'place-tallinn',
            destinationPlaceId: 'place-tartu',
            routePolyline: 'encoded-route',
            routeIsPublishable: true,
            // Relative to now: publishing rejects a departure less than three hours away, so a
            // fixed date turns these tests red the moment it slips into the past.
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            departureTime: '10:00',
            totalSeats: 3,
            basePricePerSeat: 12,
            pickups: [],
            dropoffs: [],
        }));

        await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('MEETING_POINTS_REQUIRED');
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
        const routePolyline = polyline.encode([[10, 20], [11, 21]]);
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
            routePolyline,
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            departureTime: '09:30',
            totalSeats: 3,
            basePricePerSeat: 40,
            currency: 'GBP',
            pickups: [
                { placeId: 'pickup-a', address: 'Pickup A', lat: 10, lng: 20 },
            ],
            dropoffs: [
                { placeId: 'dropoff-a', address: 'Drop-off A', lat: 11, lng: 21 },
            ],
            stopovers: [
                { placeId: 'stop-a', address: 'Stop A', lat: 10.3, lng: 20.3, recommendedPrice: 18.75 },
                { placeId: 'stop-b', address: 'Stop B', lat: 10.6, lng: 20.6 },
            ],
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));
        mockPrisma.vehicle.findFirst.mockResolvedValue(approvedVehicle);

        const rideCreate = jest.fn().mockResolvedValue({ id: 'ride-1', departureTime: '09:30', routeDurationSeconds: 3600 });
        const rideWaypointCreateMany = jest.fn().mockResolvedValue(undefined);
        const rideFindUnique = jest.fn().mockResolvedValue({
            id: 'ride-1',
            status: RideStatus.PUBLISHED,
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
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
            routePolyline: polyline.encode([[10, 20], [11, 21]]),
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            departureTime: '09:30',
            totalSeats: 3,
            basePricePerSeat: 40,
            femaleOnly: true,
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));
        mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, gender: 'MALE' });
        mockPrisma.vehicle.findFirst.mockResolvedValue(approvedVehicle);

        await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('FEMALE_ONLY_NOT_ALLOWED');
    });

    it('rejects publishing when the driver already has an overlapping ride', async () => {
        const departureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        departureDate.setUTCHours(0, 0, 0, 0);
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
            routePolyline: polyline.encode([[10, 20], [11, 21]]),
            routeDurationSeconds: 7200,
            departureDate: departureDate.toISOString(),
            departureTime: '09:30',
            totalSeats: 3,
            basePricePerSeat: 40,
            pickups: [{ placeId: 'pickup-a', address: 'Pickup A', lat: 10, lng: 20 }],
            dropoffs: [{ placeId: 'dropoff-a', address: 'Drop-off A', lat: 11, lng: 21 }],
        };

        mockRedis.get.mockResolvedValue(JSON.stringify(draft));
        mockPrisma.ride.findMany.mockResolvedValue([{
            id: 'existing-ride',
            departureDate,
            departureTime: '09:30',
            routeDurationSeconds: 3600,
        }]);

        await expect(DraftRideService.publishRide('driver-1')).rejects.toThrow('DRIVER_RIDE_TIME_CONFLICT');
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
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
        mockPrisma.vehicle.findFirst.mockResolvedValue(approvedVehicle);

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

    describe('getStopoversAlongRoute', () => {
        // A ~222 km due-north route along longitude 20, from lat 0 to lat 2.
        const routePoints = Array.from({ length: 21 }, (_, index) => [index * 0.1, 20] as [number, number]);

        const draftWithRoute = () => ({
            userId: 'driver-1',
            step: 7,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            originLat: 0,
            originLng: 20,
            originPlaceId: 'place-origin',
            destinationLat: 2,
            destinationLng: 20,
            destinationPlaceId: 'place-destination',
            routePolyline: polyline.encode(routePoints),
            routeDistanceMeters: 222000,
            basePricePerSeat: 20,
        });

        // A locality centred on the route at the given latitude. `adminArea` names the
        // containing administrative area: one named after the locality marks a town, any
        // other name marks a village inside someone else's area.
        const localityAt = (
            lat: number,
            name: string,
            adminArea: string | null,
            types = ['locality', 'political'],
        ) => ({
            locality: {
                place_id: `place-${name.toLowerCase()}`,
                formatted_address: `${name}, Estonia`,
                address_components: [{ long_name: name, short_name: name, types }],
                types,
                geometry: { location: { lat, lng: 20 } },
            },
            adminAreaLevel2: adminArea,
        });

        /** A town: seat of its own parish. */
        const townAt = (lat: number, name: string, types = ['locality', 'political']) =>
            localityAt(lat, name, `${name} Parish`, types);

        /** A village: sits inside another town's parish. */
        const villageAt = (lat: number, name: string) => localityAt(lat, name, 'Tartu City');

        it('samples the whole route when resolving towns', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            mockGoogleService.reverseGeocodeLocality.mockResolvedValue(null);

            await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(mockGoogleService.reverseGeocodeLocality).toHaveBeenCalledTimes(16);
            const queriedLatitudes = mockGoogleService.reverseGeocodeLocality.mock.calls.map(([lat]) => lat as number);
            expect(Math.min(...queriedLatitudes)).toBeLessThan(0.3);
            expect(Math.max(...queriedLatitudes)).toBeGreaterThan(1.8);
        });

        it('returns towns the route passes through, in along-route order', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            mockGoogleService.reverseGeocodeLocality.mockImplementation(async (lat: number) => {
                if (lat < 0.7) return townAt(0.5, 'Kose');
                if (lat < 1.4) return townAt(1.0, 'Mao');
                return townAt(1.5, 'Poltsamaa');
            });

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(result.suggestions.map((suggestion) => suggestion.name)).toEqual(['Kose', 'Mao', 'Poltsamaa']);
            const distances = result.suggestions.map((suggestion) => suggestion.distanceFromOriginMeters);
            expect(distances).toEqual([...distances].sort((a, b) => a - b));
            // Price scales with along-route distance, never exceeding the base price.
            const prices = result.suggestions.map((suggestion) => suggestion.pricePerSeat as number);
            expect(prices).toEqual([...prices].sort((a, b) => a - b));
            expect(Math.max(...prices)).toBeLessThanOrEqual(20);
        });

        it('promotes the town an administrative area is named after, even when the road bypasses it', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            // Samples land in villages; each village sits in "Kose Parish".
            mockGoogleService.reverseGeocodeLocality.mockResolvedValue({
                locality: {
                    place_id: 'place-palvere',
                    formatted_address: 'Palvere, Estonia',
                    address_components: [{ long_name: 'Palvere', short_name: 'Palvere', types: ['locality'] }],
                    types: ['locality', 'political'],
                    geometry: { location: { lat: 1.0, lng: 20 } },
                },
                adminAreaLevel2: 'Kose Parish',
                countryCode: 'EE',
            });
            // The parish seat is a real town 4 km off the road.
            mockGoogleService.geocodeLocality.mockResolvedValue({
                place_id: 'place-kose',
                formatted_address: 'Kose, Estonia',
                address_components: [{ long_name: 'Kose', short_name: 'Kose', types: ['locality'] }],
                types: ['locality', 'political'],
                geometry: { location: { lat: 1.2, lng: 20.06 } },
            });

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(mockGoogleService.geocodeLocality).toHaveBeenCalledWith('Kose', 'EE');
            expect(result.suggestions.map((suggestion) => [suggestion.name, suggestion.isMajorTown])).toEqual([
                ['Kose', true],
                ['Palvere', false],
            ]);
            // Along-route distance comes from projecting the town onto the polyline.
            const kose = result.suggestions[0];
            expect(kose.distanceFromOriginMeters).toBeGreaterThan(0);
        });

        it('drops an administrative area with no eponymous town', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            mockGoogleService.reverseGeocodeLocality.mockResolvedValue({
                locality: {
                    place_id: 'place-koigi',
                    formatted_address: 'Koigi, Estonia',
                    address_components: [{ long_name: 'Koigi', short_name: 'Koigi', types: ['locality'] }],
                    types: ['locality', 'political'],
                    geometry: { location: { lat: 1.0, lng: 20 } },
                },
                adminAreaLevel2: 'Järva Parish',
                countryCode: 'EE',
            });
            // "Järva" is a county name, not a town — geocodeLocality finds no locality.
            mockGoogleService.geocodeLocality.mockResolvedValue(null);

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(mockGoogleService.geocodeLocality).toHaveBeenCalledWith('Järva', 'EE');
            expect(result.suggestions.map((suggestion) => suggestion.name)).toEqual(['Koigi']);
        });

        it('lists towns before villages, each in route order', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            mockGoogleService.reverseGeocodeLocality.mockImplementation(async (lat: number) => {
                if (lat < 0.6) return villageAt(0.4, 'Earlyvillage');
                if (lat < 1.1) return townAt(0.9, 'Latetown');
                if (lat < 1.6) return villageAt(1.3, 'Latevillage');
                return townAt(1.7, 'Lasttown');
            });

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(result.suggestions.map((suggestion) => suggestion.name)).toEqual([
                'Latetown', 'Lasttown', 'Earlyvillage', 'Latevillage',
            ]);
            expect(result.suggestions.map((suggestion) => suggestion.isMajorTown)).toEqual([
                true, true, false, false,
            ]);
        });

        it('keeps arrival times tied to along-route distance, not list position', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify({
                ...draftWithRoute(),
                departureTime: '10:00',
                routeDurationSeconds: 7200,
            }));
            mockGoogleService.reverseGeocodeLocality.mockImplementation(async (lat: number) => (
                lat < 1.0 ? villageAt(0.5, 'Earlyvillage') : townAt(1.5, 'Latetown')
            ));

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            // Town is listed first but is further along the route, so it arrives later.
            const [town, village] = result.suggestions;
            expect(town.name).toBe('Latetown');
            expect(town.estimatedArrivalTime! > village.estimatedArrivalTime!).toBe(true);
        });

        it('collapses consecutive samples inside one town into a single suggestion', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            mockGoogleService.reverseGeocodeLocality.mockResolvedValue(townAt(1.0, 'Mao'));

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(result.suggestions).toHaveLength(1);
            expect(result.suggestions[0].name).toBe('Mao');
        });

        it('excludes a town whose centre is outside the route corridor', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            // ~28 km east of the route at this latitude — the Rapla case.
            mockGoogleService.reverseGeocodeLocality.mockResolvedValue({
                locality: {
                    place_id: 'place-offroute',
                    formatted_address: 'Offroute, Estonia',
                    address_components: [{ long_name: 'Offroute', short_name: 'Offroute', types: ['locality'] }],
                    types: ['locality', 'political'],
                    geometry: { location: { lat: 1.0, lng: 20.48 } },
                },
                adminAreaLevel2: 'Offroute Parish',
            });

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(result.suggestions).toHaveLength(0);
        });

        it('excludes non-town results and the route endpoints', async () => {
            mockRedis.get.mockResolvedValue(JSON.stringify(draftWithRoute()));
            mockGoogleService.reverseGeocodeLocality.mockImplementation(async (lat: number) => {
                if (lat < 1.0) return townAt(0.5, 'Fuelstop', ['gas_station']);
                const endpoint = townAt(1.5, 'Endpoint');
                return { ...endpoint, locality: { ...endpoint.locality, place_id: 'place-destination' } };
            });

            const result = await DraftRideService.getStopoversAlongRoute('driver-1');

            expect(result.suggestions).toHaveLength(0);
        });
    });
});

describe('getRecommendedPrice quote', () => {
    const calculation = {
        regionCode: 'BALTIC',
        currency: 'EUR',
        distanceKm: 150,
        minRatePerKm: 0.06,
        recommendedRatePerKm: 0.08,
        maxRatePerKm: 0.12,
        minimumSeatPrice: 3,
        recommendedPricePerSeat: 12,
        minAllowedPricePerSeat: 9,
        maxAllowedPricePerSeat: 18,
        roundingStrategy: 'NEAREST_EURO',
        serviceFeePercent: 2,
        serviceFeeFlat: 0,
    };

    const draft = {
        driverId: 'driver-1',
        currency: 'EUR',
        routeDistanceMeters: 150000,
        totalSeats: 3,
        stopovers: [],
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockRedis.get.mockResolvedValue(JSON.stringify(draft));
        mockPricingService.getPricePreview.mockResolvedValue(calculation);
        mockPricingService.resolveActiveFeeTerms.mockResolvedValue({
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
            source: 'ACTIVE_CONFIG',
        });
    });

    it('returns every amount the publish screen displays, for the candidate price', async () => {
        const result = await DraftRideService.getRecommendedPrice('driver-1', 12);

        expect(result.quote.basePricePerSeat).toBe(12);
        expect(result.quote.seats).toBe(3);
        expect(result.quote.serviceFeePercent).toBe(2);
        expect(result.quote.perSeat).toEqual({ driverNet: 12, serviceFee: 0.24, riderTotal: 12.24 });
        expect(result.quote.fullRide).toEqual({ driverNet: 36, serviceFee: 0.72, riderTotal: 36.72 });
    });

    it('quotes the recommended price when the driver has not chosen one yet', async () => {
        const result = await DraftRideService.getRecommendedPrice('driver-1');

        expect(result.quote.basePricePerSeat).toBe(12);
        expect(result.quote.perSeat.riderTotal).toBe(12.24);
    });

    it('never deducts the fee from the driver', async () => {
        const result = await DraftRideService.getRecommendedPrice('driver-1', 14);

        expect(result.quote.perSeat.driverNet).toBe(14);
        expect(result.quote.perSeat.riderTotal).toBe(14.28);
        expect(result.quote.perSeat.riderTotal).toBeGreaterThan(result.quote.perSeat.driverNet);
    });

    it('charges no fee when the rate is zero', async () => {
        mockPricingService.resolveActiveFeeTerms.mockResolvedValue({
            serviceFeePercent: 0,
            serviceFeeFlat: 0,
            source: 'ACTIVE_CONFIG',
        });

        const result = await DraftRideService.getRecommendedPrice('driver-1', 12);

        expect(result.quote.perSeat.serviceFee).toBe(0);
        expect(result.quote.perSeat.riderTotal).toBe(12);
    });

    it('falls back to a single seat when the draft has no capacity yet', async () => {
        mockRedis.get.mockResolvedValue(JSON.stringify({ ...draft, totalSeats: undefined }));

        const result = await DraftRideService.getRecommendedPrice('driver-1', 12);

        expect(result.quote.seats).toBe(1);
        expect(result.quote.fullRide).toEqual(result.quote.perSeat);
    });
});
