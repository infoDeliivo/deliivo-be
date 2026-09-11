// createBooking resolves the booking twice: once outside the transaction (to know the
// amount before the PaymentIntent is created) and once inside it. Both reads must see
// the same rows, so the non-transactional mocks delegate to the current tx fixture.
let currentTx: ReturnType<typeof buildTx>;

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
    ride: {
        findFirst: (...args: unknown[]) => currentTx.ride.findFirst(...args),
    },
    userBlock: {
        findFirst: (...args: unknown[]) => currentTx.userBlock.findFirst(...args),
    },
    rideBooking: {
        update: jest.fn(),
        findFirst: (...args: unknown[]) => currentTx.rideBooking.findFirst(...args),
    },
    paymentMethod: {
        findFirst: jest.fn().mockResolvedValue(null),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    // withPrismaFallback: unlisted models/methods resolve empty instead of throwing.
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

const mockResolveRideFeeTerms = jest.fn().mockResolvedValue({
    serviceFeePercent: 0,
    serviceFeeFlat: 0,
    source: 'ACTIVE_CONFIG',
});

jest.mock('../pricing/pricing.service.js', () => ({
    __esModule: true,
    resolveRideFeeTerms: (...args: unknown[]) => mockResolveRideFeeTerms(...args),
}));

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    createBookingPaymentIntent: jest.fn(),
    cancelPaymentIntent: jest.fn().mockResolvedValue({}),
    refundPaymentIntent: jest.fn(),
    getStripeClient: () => ({ paymentIntents: { retrieve: mockRetrieveIntent } }),
}));

jest.mock('../payments/payment.service.js', () => ({
    __esModule: true,
    PAYMENT_STATUSES: {
        CREATED: 'CREATED',
        PAYMENT_PENDING: 'PAYMENT_PENDING',
        PAID: 'PAID',
    },
    createPayment: jest.fn().mockResolvedValue({ id: 'payment-mock-id' }),
    markBookingPaymentPaid: jest.fn().mockResolvedValue({}),
    markBookingPaymentRefunded: jest.fn().mockResolvedValue({}),
    markPaymentPaid: jest.fn().mockResolvedValue({}),
}));

const mockRetrieveIntent = jest.fn();
const mockCreateNotification = jest.fn();

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../../queue/deadline.queue.js', () => ({
    __esModule: true,
    enqueueDeadlineCheck: jest.fn().mockResolvedValue(undefined),
    enqueuePaymentExpiryCheck: jest.fn().mockResolvedValue(undefined),
    reschedulePaymentExpiryCheck: jest.fn().mockResolvedValue(undefined),
    bookingPaymentWindowMs: () => 15 * 60 * 1000,
    expireUnpaidBooking: jest.fn().mockResolvedValue(false),
}));

jest.mock('./segment-capacity.utils.js', () => ({
    __esModule: true,
    releaseSegmentSeats: jest.fn().mockResolvedValue(undefined),
    releaseBookingSeats: jest.fn().mockResolvedValue(true),
}));

import { Prisma } from '@prisma/client';
import { createBooking } from './ride-booking.service';
import { cancelPaymentIntent, createBookingPaymentIntent } from '../payments/stripe.service.js';
import { createPayment } from '../payments/payment.service.js';

const mockedCreateBookingPaymentIntent = createBookingPaymentIntent as jest.Mock;
const mockedCancelPaymentIntent = cancelPaymentIntent as jest.Mock;
const mockedCreatePayment = createPayment as jest.Mock;
const mockedCreateNotification = mockCreateNotification;

/** Point both the transactional and non-transactional prisma mocks at one fixture. */
const useTx = (tx: ReturnType<typeof buildTx>) => {
    currentTx = tx;
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback(tx));
};

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
                stripePaymentIntentId: null,
                ...data,
                id: data.id ?? 'booking-1',
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
        mockResolveRideFeeTerms.mockResolvedValue({
            serviceFeePercent: 0,
            serviceFeeFlat: 0,
            source: 'ACTIVE_CONFIG',
        });
        process.env.BOOKING_PAYMENT_MODE = 'stripe';

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
        useTx(tx);

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
        useTx(tx);

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
        useTx(tx);

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
        useTx(tx);

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
        useTx(tx);

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
            })
        ).rejects.toThrow('DROPOFF_POINT_REQUIRED');
    });

    it('charges full-route fare when booking from a pickup point to a drop-off point at the route endpoints', async () => {
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
                    pricePerSeat: null,
                },
                ...(baseRide?.waypoints ?? []),
                {
                    id: 'dropoff-1',
                    placeId: 'place-dropoff',
                    address: 'Drop-off point',
                    lat: 3.9,
                    lng: 3.9,
                    orderIndex: 100,
                    waypointType: 'DROPOFF',
                    pricePerSeat: null,
                },
            ],
        });
        useTx(tx);

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'pickup-1',
            dropoffWaypointId: 'dropoff-1',
        });

        expect(booking.totalPrice).toBe(30);
        expect(booking.priceBreakdown?.basePricePerSeat).toBe(30);
        expect(tx.rideBooking.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                pickupWaypointId: 'pickup-1',
                dropoffWaypointId: 'dropoff-1',
                pickupAddress: 'Pickup point',
                dropoffAddress: 'Drop-off point',
                segmentFare: 30,
            }),
        }));
    });

    it('creates a driver-pending booking and notifies the driver when payment mode is bypass', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        const tx = buildTx();
        useTx(tx);

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
                body: 'Rider wants B to C',
                data: expect.objectContaining({
                    bookingId: booking.id,
                    rideId: 'ride-1',
                    passengerName: 'Rider',
                    passengerAvatarUrl: '',
                    originAddress: 'B',
                    destinationAddress: 'C',
                    seatsBooked: '1',
                    totalPrice: '10',
                    currency: 'GBP',
                    deepLink: `app://driver/booking-request/${booking.id}`,
                }),
            })
        );
    });
});

describe('createBooking atomicity', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockResolveRideFeeTerms.mockResolvedValue({
            serviceFeePercent: 0,
            serviceFeeFlat: 0,
            source: 'ACTIVE_CONFIG',
        });
        process.env.BOOKING_PAYMENT_MODE = 'stripe';

        mockedCreateBookingPaymentIntent.mockResolvedValue({
            paymentIntentId: 'pi_123',
            clientSecret: 'pi_123_secret_456',
            currency: 'GBP',
        });
        mockedCancelPaymentIntent.mockResolvedValue({});
        mockedCreatePayment.mockResolvedValue({ id: 'payment-mock-id' });
    });

    it('creates the PaymentIntent before writing the booking row', async () => {
        const tx = buildTx();
        useTx(tx);

        await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(mockedCreateBookingPaymentIntent.mock.invocationCallOrder[0])
            .toBeLessThan(tx.rideBooking.create.mock.invocationCallOrder[0]);
    });

    it('writes the intent id on the booking row itself, with no follow-up update', async () => {
        const tx = buildTx();
        useTx(tx);

        await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(tx.rideBooking.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: 'PAYMENT_PENDING',
                stripePaymentIntentId: 'pi_123',
                paymentAmount: 10,
                paymentCurrency: 'GBP',
            }),
        }));
        expect(mockPrisma.rideBooking.update).not.toHaveBeenCalled();
    });

    it('writes the Payment row inside the booking transaction', async () => {
        const tx = buildTx();
        useTx(tx);

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(mockedCreatePayment).toHaveBeenCalledWith(expect.objectContaining({
            tx,
            status: 'PAYMENT_PENDING',
            bookingId: booking.id,
            stripePaymentIntentId: 'pi_123',
            amountTotal: 10,
        }));
    });

    it('charges the service fee on top and leaves the driver the full fare', async () => {
        mockResolveRideFeeTerms.mockResolvedValue({
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
            source: 'ACTIVE_CONFIG',
        });
        const tx = buildTx();
        useTx(tx);

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        // Segment B -> C is a 10.00 fare; the rider pays 10.20 and the driver still earns 10.00.
        expect(booking.totalPrice).toBe(10.2);
        expect(mockedCreatePayment).toHaveBeenCalledWith(expect.objectContaining({
            amountTotal: 10.2,
            fareAmount: 10,
            platformFeeAmount: 0.2,
        }));

        const [{ fareAmount, platformFeeAmount, amountTotal }] = mockedCreatePayment.mock.calls[0] as [
            { fareAmount: number; platformFeeAmount: number; amountTotal: number }
        ];
        expect(Math.round(fareAmount * 100) + Math.round(platformFeeAmount * 100))
            .toBe(Math.round(amountTotal * 100));
    });

    it('persists the fee it charged on the booking row', async () => {
        mockResolveRideFeeTerms.mockResolvedValue({
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
            source: 'ACTIVE_CONFIG',
        });
        const tx = buildTx();
        useTx(tx);

        await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(tx.rideBooking.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                serviceFeeAmount: 0.2,
                serviceFeePercent: 2,
            }),
        }));
    });

    it('resolves the fee once per booking, not per plan resolution', async () => {
        const tx = buildTx();
        useTx(tx);

        await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        // createBooking resolves the plan twice (pre-flight + in-transaction) but the rate must be
        // read a single time, outside the transaction.
        expect(mockResolveRideFeeTerms).toHaveBeenCalledTimes(1);
        expect(mockResolveRideFeeTerms).toHaveBeenCalledWith('ride-1');
    });

    it('cancels the PaymentIntent when the booking transaction rolls back', async () => {
        const tx = buildTx();
        useTx(tx);
        tx.rideBooking.create.mockRejectedValue(new Error('DB_DOWN'));

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
                dropoffWaypointId: 'wp-c',
            })
        ).rejects.toThrow('DB_DOWN');

        expect(mockedCancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    });

    it('maps a unique-constraint race to BOOKING_ALREADY_EXISTS and releases the intent', async () => {
        const tx = buildTx();
        useTx(tx);
        tx.rideBooking.create.mockRejectedValue(
            new Prisma.PrismaClientKnownRequestError('duplicate', {
                code: 'P2002',
                clientVersion: 'test',
            })
        );

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
                dropoffWaypointId: 'wp-c',
            })
        ).rejects.toThrow('BOOKING_ALREADY_EXISTS');

        expect(mockedCancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    });

    it('never charges an amount the rider did not see', async () => {
        const tx = buildTx();
        useTx(tx);
        const baseRide = await tx.ride.findFirst();

        // Pre-flight sees the published fare; the in-transaction read sees a higher one.
        tx.ride.findFirst
            .mockResolvedValueOnce(baseRide)
            .mockResolvedValue({
                ...baseRide,
                waypoints: (baseRide?.waypoints ?? []).map((wp: { id: string; pricePerSeat: number | null }) =>
                    wp.id === 'wp-c' ? { ...wp, pricePerSeat: 25 } : wp
                ),
            });

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
                dropoffWaypointId: 'wp-c',
            })
        ).rejects.toThrow('BOOKING_PRICE_CHANGED');

        expect(tx.rideBooking.create).not.toHaveBeenCalled();
        expect(mockedCancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    });

    it('holds no seats for an unpaid booking', async () => {
        const tx = buildTx();
        useTx(tx);

        await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        // Capacity is untouched until the payment confirms, so an abandoned checkout
        // cannot lock a seat away from a rider who is ready to pay.
        expect(tx.rideSegmentCapacity.updateMany).not.toHaveBeenCalled();
        expect(tx.ride.updateMany).not.toHaveBeenCalled();
        expect(tx.ride.update).not.toHaveBeenCalled();
        expect(tx.rideBooking.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ seatsReservedAt: undefined }),
        }));
    });

    it('still reserves seats at booking time in bypass mode, where payment is settled', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        const tx = buildTx();
        useTx(tx);

        await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(tx.rideSegmentCapacity.updateMany).toHaveBeenCalled();
        expect(tx.rideBooking.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ seatsReservedAt: expect.any(Date) }),
        }));
    });

    it('rolls back rather than overselling a bypass-mode booking', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        const tx = buildTx();
        useTx(tx);

        const freeEdges = [
            { rideId: 'ride-1', fromPosition: 0, toPosition: 1, occupiedSeats: 2 },
            { rideId: 'ride-1', fromPosition: 1, toPosition: 2, occupiedSeats: 2 },
        ];
        // Pre-check sees room for one more seat; the re-read after the increment shows
        // the ride is over capacity because another booking landed in between.
        tx.rideSegmentCapacity.findMany
            .mockResolvedValueOnce(freeEdges)
            .mockResolvedValue([
                { rideId: 'ride-1', fromPosition: 0, toPosition: 1, occupiedSeats: 4 },
            ]);

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
                dropoffWaypointId: 'wp-c',
            })
        ).rejects.toThrow('INSUFFICIENT_SEATS');

        expect(tx.rideBooking.create).not.toHaveBeenCalled();
    });
});

describe('createBooking re-entry on an unpaid booking', () => {
    const unpaidBooking = {
        id: 'booking-unpaid',
        stripePaymentIntentId: 'pi_old',
        ride: { status: 'PUBLISHED' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.BOOKING_PAYMENT_MODE = 'stripe';

        mockedCreateBookingPaymentIntent.mockResolvedValue({
            paymentIntentId: 'pi_123',
            clientSecret: 'pi_123_secret_456',
            currency: 'GBP',
        });
        mockedCancelPaymentIntent.mockResolvedValue({});
        mockedCreatePayment.mockResolvedValue({ id: 'payment-mock-id' });
    });

    it('hands back the same booking with a client secret while its payment is still payable', async () => {
        const tx = buildTx();
        useTx(tx);
        tx.rideBooking.findFirst.mockResolvedValue(unpaidBooking);
        mockRetrieveIntent.mockResolvedValue({
            id: 'pi_old',
            status: 'requires_payment_method',
            currency: 'gbp',
            client_secret: 'pi_old_secret',
        });

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(booking.resumed).toBe(true);
        expect(booking.payment?.clientSecret).toBe('pi_old_secret');
        expect(booking.payment?.paymentIntentId).toBe('pi_old');
        // No second booking and no second intent — that is what would double-charge.
        expect(tx.rideBooking.create).not.toHaveBeenCalled();
        expect(mockedCreateBookingPaymentIntent).not.toHaveBeenCalled();
    });

    it('replaces the unpaid booking when its payment is dead', async () => {
        const tx = buildTx();
        useTx(tx);
        tx.rideBooking.findFirst
            .mockResolvedValueOnce(unpaidBooking)
            .mockResolvedValue(null);
        mockRetrieveIntent.mockResolvedValue({
            id: 'pi_old',
            status: 'canceled',
            currency: 'gbp',
            client_secret: null,
        });

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(booking.resumed).toBeUndefined();
        expect(tx.rideBooking.create).toHaveBeenCalled();
        expect(mockedCreateBookingPaymentIntent).toHaveBeenCalled();
    });

    it('refuses to create anything while Stripe cannot be reached', async () => {
        const tx = buildTx();
        useTx(tx);
        tx.rideBooking.findFirst.mockResolvedValue(unpaidBooking);
        mockRetrieveIntent.mockRejectedValue(new Error('stripe unreachable'));

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
                dropoffWaypointId: 'wp-c',
            })
        ).rejects.toThrow('PAYMENT_VERIFICATION_UNAVAILABLE');

        expect(tx.rideBooking.create).not.toHaveBeenCalled();
        expect(mockedCreateBookingPaymentIntent).not.toHaveBeenCalled();
    });
});

describe('createBooking after the rider cancelled', () => {
    // The rider's earlier booking on this ride, ended by their own cancellation. It stays as a
    // CANCELLED row — nothing deletes it — so every lookup on the re-book path has to step over it.
    const cancelledBooking = {
        id: 'booking-cancelled',
        rideId: 'ride-1',
        passengerId: 'passenger-1',
        status: 'CANCELLED',
        cancelledByRole: 'PASSENGER',
        stripePaymentIntentId: 'pi_old',
        ride: { status: 'PUBLISHED' },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.BOOKING_PAYMENT_MODE = 'stripe';

        mockedCreateBookingPaymentIntent.mockResolvedValue({
            paymentIntentId: 'pi_new',
            clientSecret: 'pi_new_secret',
            currency: 'GBP',
        });
        mockedCreatePayment.mockResolvedValue({ id: 'payment-mock-id' });
    });

    it('books the ride again and leaves the cancelled booking alone', async () => {
        const tx = buildTx();
        useTx(tx);

        // Honour the status filter the way the database would. The duplicate guard asks for
        // ACTIVE_BOOKING_STATUSES and the unpaid re-entry lookup for PAYMENT_PENDING; a cancelled
        // row matches neither, which is exactly what lets the re-book through.
        tx.rideBooking.findFirst.mockImplementation(async (args: any) => {
            const status = args?.where?.status;
            const wanted = status?.in ?? (status ? [status] : []);
            return wanted.includes(cancelledBooking.status) ? cancelledBooking : null;
        });

        const booking = await createBooking('passenger-1', {
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });

        expect(booking.resumed).toBeUndefined();
        expect(tx.rideBooking.create).toHaveBeenCalled();
        expect(mockedCreateBookingPaymentIntent).toHaveBeenCalled();

        // History, not something to revive: the cancelled row keeps its status and its own refund
        // state, and the rider's new seat is a brand new booking with a brand new intent.
        expect(tx.rideBooking.update).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'booking-cancelled' } })
        );
        expect(mockedCancelPaymentIntent).not.toHaveBeenCalledWith('pi_old');
    });

    it('still refuses a second active booking on the same ride', async () => {
        const tx = buildTx();
        useTx(tx);
        tx.rideBooking.findFirst.mockImplementation(async (args: any) => {
            const status = args?.where?.status;
            const wanted = status?.in ?? (status ? [status] : []);
            return wanted.includes('CONFIRMED')
                ? { ...cancelledBooking, id: 'booking-live', status: 'CONFIRMED' }
                : null;
        });

        await expect(
            createBooking('passenger-1', {
                rideId: 'ride-1',
                seatsBooked: 1,
                pickupWaypointId: 'wp-b',
                dropoffWaypointId: 'wp-c',
            })
        ).rejects.toThrow('BOOKING_ALREADY_EXISTS');

        expect(tx.rideBooking.create).not.toHaveBeenCalled();
    });
});
