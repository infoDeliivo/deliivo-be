const mockPrisma = {
    $transaction: jest.fn(),
    user: {
        findUnique: jest.fn().mockResolvedValue({
            tosAcceptedAt: new Date(),
            privacyAcceptedAt: new Date(),
            isBanned: false,
            dob: new Date('1990-01-01T00:00:00.000Z'),
        }),
    },
    rideBooking: {
        update: jest.fn(),
    },
    paymentMethod: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    createBookingPaymentIntent: jest.fn(),
    refundPaymentIntent: jest.fn(),
}));

jest.mock('../payments/payment.service.js', () => ({
    __esModule: true,
    createPayment: jest.fn().mockResolvedValue({ id: 'payment-mock-id' }),
    markPaymentPending: jest.fn().mockResolvedValue({}),
    markPaymentPaid: jest.fn().mockResolvedValue({}),
}));

const mockCreateNotification = jest.fn();

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../../queue/deadline.queue.js', () => ({
    __esModule: true,
    enqueueDeadlineCheck: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./segment-capacity.utils.js', () => ({
    __esModule: true,
    releaseSegmentSeats: jest.fn().mockResolvedValue(undefined),
}));

import { createBooking } from './ride-booking.service';
import { createBookingPaymentIntent } from '../payments/stripe.service.js';

const mockedCreateBookingPaymentIntent = createBookingPaymentIntent as jest.Mock;
const mockedCreateNotification = mockCreateNotification;

const buildTx = () => {
    const futureDepartureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    futureDepartureDate.setUTCHours(0, 0, 0, 0);
    const ride = {
        id: 'ride-1',
        driverId: 'driver-1',
        availableSeats: 3,
        basePricePerSeat: 30,
        currency: 'GBP',
        status: 'PUBLISHED',
        driver: { id: 'driver-1', name: 'Driver', avatarUrl: null },
        originPlaceId: 'place-a',
        originAddress: 'A',
        originLat: 1,
        originLng: 1,
        destinationPlaceId: 'place-d',
        destinationAddress: 'D',
        destinationLat: 4,
        destinationLng: 4,
        departureDate: futureDepartureDate,
        departureTime: '10:00',
        totalSeats: 3,
        routePolyline: 'abcd',
        routeDistanceMeters: 1000,
        routeDurationSeconds: 600,
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
    };

    return {
        user: {
            findUnique: jest.fn().mockResolvedValue({
                name: 'Passenger',
                avatarUrl: null,
            }),
        },
        ride: {
            findFirst: jest.fn().mockResolvedValue(ride),
            update: jest.fn().mockResolvedValue(null),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        rideBooking: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async ({ data }) => ({
                id: 'booking-1',
                ...data,
                stripePaymentIntentId: null,
                paymentAmount: data.paymentAmount ?? null,
                paymentCurrency: data.paymentCurrency,
                paymentCapturedAt: data.paymentCapturedAt ?? null,
                driverDecisionDeadlineAt: data.driverDecisionDeadlineAt ?? null,
                createdAt: new Date('2026-03-01T00:00:00.000Z'),
                updatedAt: new Date('2026-03-01T00:00:00.000Z'),
                ride: {
                    ...ride,
                },
            })),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
        rideSegmentCapacity: {
            findMany: jest.fn().mockResolvedValue([
                { rideId: 'ride-1', fromPosition: 0, toPosition: 1, occupiedSeats: 0 },
                { rideId: 'ride-1', fromPosition: 1, toPosition: 2, occupiedSeats: 0 },
                { rideId: 'ride-1', fromPosition: 2, toPosition: 3, occupiedSeats: 0 },
            ]),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        userBlock: {
            findFirst: jest.fn().mockResolvedValue(null),
        },
    };
};

describe('createBooking segment pricing + payment intent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.BOOKING_PAYMENT_MODE = 'stripe';
        process.env.PLATFORM_FEE_PERCENT = '0';

        mockedCreateBookingPaymentIntent.mockResolvedValue({
            paymentIntentId: 'pi_123',
            clientSecret: 'pi_123_secret_456',
            currency: 'GBP',
        });

        mockPrisma.rideBooking.update.mockImplementation(async ({ data }) => ({
            id: 'booking-1',
            rideId: 'ride-1',
            passengerId: 'passenger-1',
            seatsBooked: 1,
            totalPrice: data.paymentAmount ?? 10,
            status: 'PAYMENT_PENDING',
            pickupWaypointId: 'wp-c',
            dropoffWaypointId: null,
            stripePaymentIntentId: data.stripePaymentIntentId,
            paymentCurrency: data.paymentCurrency,
            createdAt: new Date('2026-03-01T00:00:00.000Z'),
            updatedAt: new Date('2026-03-01T00:00:00.000Z'),
            ride: {
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
                routePolyline: 'abcd',
                routeDistanceMeters: 1000,
                routeDurationSeconds: 600,
                departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                departureTime: '10:00',
                totalSeats: 3,
                availableSeats: 2,
                basePricePerSeat: 30,
                currency: 'GBP',
                driver: { id: 'driver-1', name: 'Driver', avatarUrl: null },
                waypoints: [
                    {
                        id: 'wp-b',
                        placeId: 'place-b',
                        address: 'B',
                        lat: 2,
                        lng: 2,
                        waypointType: 'STOPOVER',
                        orderIndex: 50,
                        pricePerSeat: 10,
                    },
                    {
                        id: 'wp-c',
                        placeId: 'place-c',
                        address: 'C',
                        lat: 3,
                        lng: 3,
                        waypointType: 'STOPOVER',
                        orderIndex: 51,
                        pricePerSeat: 20,
                    },
                ],
            },
        }));
    });

    it('charges B -> C as the difference between cumulative waypoint prices and returns payment info', async () => {
        const tx = buildTx();
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 2,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(booking.totalPrice).toBe(20);
        expect(booking.payment?.paymentIntentId).toBe('pi_123');
        expect(mockedCreateBookingPaymentIntent).toHaveBeenCalled();
    });

    it('charges C -> D as destination minus stopover cumulative price', async () => {
        const tx = buildTx();
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-c',
        });

        expect(booking.totalPrice).toBe(10);
        expect(booking.payment?.provider).toBe('stripe');
    });

    it('rejects reversed or unresolved segment selections', async () => {
        const tx = buildTx();
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-c',
                dropoffWaypointId: 'wp-b',
            })
        ).rejects.toThrow('INVALID_BOOKING_SEGMENT');
    });

    it('requires an explicit pickup point when the ride has published pickup waypoints', async () => {
        const tx = buildTx();
        const baseRide = await tx.ride.findFirst();
        tx.ride.findFirst.mockResolvedValue({
            ...baseRide,
            waypoints: [
                {
                    id: 'pickup-1',
                    placeId: 'place-pickup',
                    address: 'Pickup point',
                    lat: 1.1,
                    lng: 1.1,
                    orderIndex: 0,
                    waypointType: 'PICKUP',
                    pricePerSeat: 0,
                },
                ...(baseRide?.waypoints ?? []),
            ],
        });
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
            })
        ).rejects.toThrow('PICKUP_POINT_REQUIRED');
    });

    it('requires an explicit drop-off point when the ride has published drop-off waypoints', async () => {
        const tx = buildTx();
        const baseRide = await tx.ride.findFirst();
        tx.ride.findFirst.mockResolvedValue({
            ...baseRide,
            waypoints: [
                ...(baseRide?.waypoints ?? []),
                {
                    id: 'dropoff-1',
                    placeId: 'place-dropoff',
                    address: 'Drop-off point',
                    lat: 3.9,
                    lng: 3.9,
                    orderIndex: 100,
                    waypointType: 'DROPOFF',
                    pricePerSeat: 30,
                },
            ],
        });
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
            })
        ).rejects.toThrow('DROPOFF_POINT_REQUIRED');
    });

    it('creates a driver-pending booking and notifies the driver when payment mode is bypass', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        const tx = buildTx();
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(booking.status).toBe('DRIVER_PENDING');
        expect(booking.payment).toBeNull();
        expect(mockedCreateBookingPaymentIntent).not.toHaveBeenCalled();
        expect(mockedCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'driver-1',
                type: 'booking.request.driver_decision',
                title: 'New ride request',
                body: 'Passenger wants B to C',
                data: expect.objectContaining({
                    bookingId: 'booking-1',
                    rideId: 'ride-1',
                    passengerName: 'Passenger',
                    passengerAvatarUrl: '',
                    originAddress: 'B',
                    destinationAddress: 'C',
                    seatsBooked: '1',
                    totalPrice: '10',
                    currency: 'GBP',
                    deepLink: 'app://driver/booking-request/booking-1',
                }),
            })
        );
    });
});
