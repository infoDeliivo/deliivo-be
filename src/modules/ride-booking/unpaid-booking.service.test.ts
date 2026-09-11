const mockPrisma = {
    $transaction: jest.fn(),
    rideBooking: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    // withPrismaFallback: unlisted models/methods resolve empty instead of throwing.
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

const mockRetrieveIntent = jest.fn();

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    getStripeClient: () => ({ paymentIntents: { retrieve: mockRetrieveIntent } }),
    createBookingPaymentIntent: jest.fn(),
    cancelPaymentIntent: jest.fn().mockResolvedValue({}),
    refundPaymentIntent: jest.fn().mockResolvedValue({}),
}));

jest.mock('../payments/payment.service.js', () => ({
    __esModule: true,
    PAYMENT_STATUSES: { PAYMENT_PENDING: 'PAYMENT_PENDING' },
    createPayment: jest.fn(),
    markBookingPaymentPaid: jest.fn().mockResolvedValue({}),
    markBookingPaymentRefunded: jest.fn().mockResolvedValue({}),
    markPaymentPaid: jest.fn().mockResolvedValue({}),
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: jest.fn().mockResolvedValue(undefined),
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

import { cancelBooking, listUserBookings, resumeBookingPayment } from './ride-booking.service';
import { cancelPaymentIntent, refundPaymentIntent } from '../payments/stripe.service.js';
import { releaseBookingSeats } from './segment-capacity.utils.js';

const mockedCancelPaymentIntent = cancelPaymentIntent as jest.Mock;
const mockedRefundPaymentIntent = refundPaymentIntent as jest.Mock;
const mockedReleaseBookingSeats = releaseBookingSeats as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    process.env.BOOKING_PAYMENT_MODE = 'stripe';
    mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => unknown) => callback(mockPrisma)
    );
    mockPrisma.rideBooking.findMany.mockResolvedValue([]);
    mockPrisma.rideBooking.count.mockResolvedValue(0);
    mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });
    mockedReleaseBookingSeats.mockResolvedValue(true);
});

describe('listUserBookings hides unpaid bookings', () => {
    it('excludes PAYMENT_PENDING when no status filter is given', async () => {
        await listUserBookings('passenger-1', {});

        expect(mockPrisma.rideBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                passengerId: 'passenger-1',
                status: { not: 'PAYMENT_PENDING' },
            }),
        }));
    });

    it('returns them when the caller asks for that status by name', async () => {
        await listUserBookings('passenger-1', { status: 'PAYMENT_PENDING' });

        expect(mockPrisma.rideBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ status: 'PAYMENT_PENDING' }),
        }));
    });

    it('does not add the exclusion to a multi-status filter', async () => {
        await listUserBookings('passenger-1', { status: 'PAYMENT_PENDING,DRIVER_PENDING' });

        expect(mockPrisma.rideBooking.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                status: { in: ['PAYMENT_PENDING', 'DRIVER_PENDING'] },
            }),
        }));
    });
});

/** Enough of a booking row for mapBookingResponse to render it. */
const bookingRow = {
    id: 'booking-1',
    rideId: 'ride-1',
    passengerId: 'passenger-1',
    status: 'PAYMENT_PENDING',
    seatsBooked: 1,
    totalPrice: 12,
    serviceFeeAmount: 0,
    serviceFeePercent: 0,
    segmentFare: 12,
    pickupWaypointId: null,
    dropoffWaypointId: null,
    pickupAddress: 'A',
    dropoffAddress: 'B',
    pickupPosition: 0,
    dropoffPosition: 1,
    stripePaymentIntentId: 'pi_123',
    paymentAmount: 12,
    paymentCurrency: 'GBP',
    paymentCapturedAt: null,
    driverDecisionDeadlineAt: null,
    deadlineExtendedAt: null,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    ride: {
        id: 'ride-1',
        driverId: 'driver-1',
        originPlaceId: 'place-a',
        originAddress: 'A',
        originLat: 1,
        originLng: 1,
        destinationPlaceId: 'place-b',
        destinationAddress: 'B',
        destinationLat: 2,
        destinationLng: 2,
        departureDate: new Date('2026-09-17T00:00:00.000Z'),
        departureTime: '10:00',
        totalSeats: 3,
        availableSeats: 3,
        basePricePerSeat: 12,
        currency: 'GBP',
        status: 'PUBLISHED',
        routePolyline: 'abcd',
        routeDistanceMeters: 1000,
        routeDurationSeconds: 600,
        driver: { id: 'driver-1', firstName: 'Driver', avatarUrl: null },
        vehicle: null,
        waypoints: [],
    },
};

describe('resumeBookingPayment', () => {
    it('returns the client secret for a booking that was never paid for', async () => {
        // First read is the status check; the second belongs to getBookingById.
        mockPrisma.rideBooking.findFirst
            .mockResolvedValueOnce({
                status: 'PAYMENT_PENDING',
                stripePaymentIntentId: 'pi_123',
            })
            .mockResolvedValue(bookingRow);
        mockRetrieveIntent.mockResolvedValue({
            id: 'pi_123',
            status: 'requires_payment_method',
            currency: 'gbp',
            client_secret: 'pi_123_secret',
        });

        const booking = await resumeBookingPayment('passenger-1', 'booking-1');

        expect(mockRetrieveIntent).toHaveBeenCalledWith('pi_123');
        expect(booking?.resumed).toBe(true);
        expect(booking?.payment).toEqual({
            provider: 'stripe',
            paymentIntentId: 'pi_123',
            clientSecret: 'pi_123_secret',
            currency: 'GBP',
        });
        // Still unpaid — resuming hands over the means to pay, it does not pay.
        expect(booking?.status).toBe('PAYMENT_PENDING');
    });

    it('closes the booking out when its payment is dead, so the ride can be booked again', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({
            status: 'PAYMENT_PENDING',
            stripePaymentIntentId: 'pi_123',
        });
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            rideId: 'ride-1',
            seatsBooked: 1,
            pickupPosition: 0,
            dropoffPosition: 1,
            ride: { totalSeats: 3 },
        });
        mockRetrieveIntent.mockResolvedValue({
            id: 'pi_123',
            status: 'canceled',
            currency: 'gbp',
            client_secret: null,
        });

        await expect(resumeBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('PAYMENT_CANCELLED');

        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'booking-1', status: 'PAYMENT_PENDING' },
            data: { status: 'PAYMENT_FAILED' },
        }));
    });

    it('reports a Stripe outage rather than pretending the payment is missing', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({
            status: 'PAYMENT_PENDING',
            stripePaymentIntentId: 'pi_123',
        });
        mockRetrieveIntent.mockRejectedValue(new Error('stripe down'));

        await expect(resumeBookingPayment('passenger-1', 'booking-1'))
            .rejects.toThrow('PAYMENT_VERIFICATION_UNAVAILABLE');
    });

    it('rejects a booking that can no longer be paid for', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({
            status: 'CANCELLED',
            stripePaymentIntentId: 'pi_123',
        });

        await expect(resumeBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('BOOKING_NOT_PAYABLE');
        expect(mockRetrieveIntent).not.toHaveBeenCalled();
    });
});

describe('cancelBooking on an unpaid booking', () => {
    const unpaid = {
        id: 'booking-1',
        rideId: 'ride-1',
        status: 'PAYMENT_PENDING',
        seatsBooked: 1,
        totalPrice: 12,
        paymentAmount: 12,
        paymentCapturedAt: null,
        stripePaymentIntentId: 'pi_123',
        pickupPosition: 0,
        dropoffPosition: 1,
        driverDecisionDeadlineAt: null,
        ride: {
            id: 'ride-1',
            driverId: 'driver-1',
            departureDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            departureTime: '10:00',
            originAddress: 'A',
            destinationAddress: 'B',
        },
    };

    it('cancels the live PaymentIntent so it can never be charged later', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue(unpaid);

        await cancelBooking('passenger-1', 'booking-1');

        expect(mockedCancelPaymentIntent).toHaveBeenCalledWith('pi_123');
        // Nothing was captured, so there is nothing to refund.
        expect(mockedRefundPaymentIntent).not.toHaveBeenCalled();
    });

    it('does not refund a booking that was never charged', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue(unpaid);

        const result = await cancelBooking('passenger-1', 'booking-1');

        expect(result.refundAmount).toBe(0);
        expect(result.refundInitiated).toBe(false);
    });

    it('refunds instead of cancelling once the payment has been captured', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({
            ...unpaid,
            status: 'CONFIRMED',
            paymentCapturedAt: new Date(),
        });

        await cancelBooking('passenger-1', 'booking-1');

        expect(mockedRefundPaymentIntent).toHaveBeenCalled();
        expect(mockedCancelPaymentIntent).not.toHaveBeenCalled();
    });
});
