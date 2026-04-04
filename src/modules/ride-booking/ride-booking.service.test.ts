const mockPrisma = {
    $transaction: jest.fn(),
    rideBooking: {
        update: jest.fn(),
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

import { createBooking } from './ride-booking.service';
import { createBookingPaymentIntent } from '../payments/stripe.service.js';

const mockedCreateBookingPaymentIntent = createBookingPaymentIntent as jest.Mock;

const buildTx = () => {
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
        departureDate: new Date('2026-03-30T00:00:00.000Z'),
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
        ride: {
            findFirst: jest.fn().mockResolvedValue(ride),
            update: jest.fn().mockResolvedValue(null),
        },
        rideBooking: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation(async ({ data }) => ({
                id: 'booking-1',
                ...data,
                stripePaymentIntentId: null,
                paymentCurrency: data.paymentCurrency,
                createdAt: new Date('2026-03-01T00:00:00.000Z'),
                updatedAt: new Date('2026-03-01T00:00:00.000Z'),
                ride: {
                    ...ride,
                },
            })),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };
};

describe('createBooking segment pricing + payment intent', () => {
    beforeEach(() => {
        jest.clearAllMocks();

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
                departureDate: new Date('2026-03-30T00:00:00.000Z'),
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
});
