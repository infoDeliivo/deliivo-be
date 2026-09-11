const mockPrisma = {
    $transaction: jest.fn(),
    rideBooking: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    reconciliationIssue: {
        create: jest.fn().mockResolvedValue({}),
    },
    rideSegmentCapacity: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    ride: {
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    // withPrismaFallback: unlisted models/methods resolve empty instead of throwing.
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

const mockRetrieve = jest.fn();

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    getStripeClient: () => ({ paymentIntents: { retrieve: mockRetrieve } }),
    createBookingPaymentIntent: jest.fn(),
    cancelPaymentIntent: jest.fn().mockResolvedValue({}),
    refundPaymentIntent: jest.fn().mockResolvedValue({}),
}));

jest.mock('../payments/payment.service.js', () => ({
    __esModule: true,
    PAYMENT_STATUSES: { PAYMENT_PENDING: 'PAYMENT_PENDING' },
    createPayment: jest.fn(),
    markBookingPaymentPaid: jest.fn().mockResolvedValue({}),
    markBookingPaymentRefunded: jest.fn(),
    markPaymentPaid: jest.fn(),
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

import { confirmBookingPayment } from './ride-booking.service';
import { releaseBookingSeats } from './segment-capacity.utils.js';
import { refundPaymentIntent } from '../payments/stripe.service.js';

const mockedReleaseBookingSeats = releaseBookingSeats as jest.Mock;
const mockedRefundPaymentIntent = refundPaymentIntent as jest.Mock;

const pendingBooking = {
    status: 'PAYMENT_PENDING',
    stripePaymentIntentId: 'pi_123',
};

/** Shape applyStripePaymentSucceededToBooking reads back to reserve the seats. */
const reservableBooking = {
    rideId: 'ride-1',
    seatsBooked: 2,
    pickupPosition: 0,
    dropoffPosition: 2,
    ride: { totalSeats: 4 },
};

const intentWith = (status: string) => ({
    id: 'pi_123',
    status,
    currency: 'gbp',
    amount: 1000,
    amount_received: status === 'succeeded' ? 1000 : 0,
    latest_charge: 'ch_123',
    metadata: { bookingId: 'booking-1' },
});

describe('confirmBookingPayment', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.BOOKING_PAYMENT_MODE = 'stripe';
        // First read is the status check; later reads belong to getBookingById, which
        // is not what these tests assert on.
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);
        mockPrisma.rideBooking.findFirst.mockResolvedValueOnce(pendingBooking);
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 0 });
        mockPrisma.rideSegmentCapacity.findMany.mockResolvedValue([]);
        mockPrisma.rideSegmentCapacity.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.ride.updateMany.mockResolvedValue({ count: 1 });
        mockedRefundPaymentIntent.mockResolvedValue({});
        mockPrisma.$transaction.mockImplementation(
            async (callback: (tx: unknown) => unknown) => callback(mockPrisma)
        );
    });

    it('returns null when the booking does not belong to the rider', async () => {
        mockPrisma.rideBooking.findFirst.mockReset();
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).resolves.toBeNull();
        expect(mockRetrieve).not.toHaveBeenCalled();
    });

    it.each([
        ['requires_payment_method', 'PAYMENT_METHOD_REQUIRED'],
        ['requires_confirmation', 'PAYMENT_NOT_CONFIRMED'],
        ['requires_action', 'PAYMENT_REQUIRES_ACTION'],
        ['processing', 'PAYMENT_PROCESSING'],
    ])('rejects an unconfirmed intent (%s) instead of reporting success', async (intentStatus, code) => {
        mockRetrieve.mockResolvedValue(intentWith(intentStatus));

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).rejects.toThrow(code);

        // The booking must not advance out of PAYMENT_PENDING.
        expect(mockPrisma.rideBooking.updateMany).not.toHaveBeenCalled();
        expect(mockedReleaseBookingSeats).not.toHaveBeenCalled();
    });

    it('fails the booking and gives the seats back when Stripe reports the intent was cancelled', async () => {
        mockRetrieve.mockResolvedValue(intentWith('canceled'));
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            rideId: 'ride-1',
            seatsBooked: 2,
            pickupPosition: 0,
            dropoffPosition: 2,
            ride: { totalSeats: 4 },
        });
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('PAYMENT_CANCELLED');

        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalledWith({
            where: { id: 'booking-1', status: 'PAYMENT_PENDING' },
            data: { status: 'PAYMENT_FAILED' },
        });
        expect(mockedReleaseBookingSeats).toHaveBeenCalledTimes(1);
    });

    it('does not release seats twice when another writer already failed the booking', async () => {
        mockRetrieve.mockResolvedValue(intentWith('canceled'));
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            rideId: 'ride-1',
            seatsBooked: 2,
            pickupPosition: 0,
            dropoffPosition: 2,
            ride: { totalSeats: 4 },
        });
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 0 });

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('PAYMENT_CANCELLED');

        expect(mockedReleaseBookingSeats).not.toHaveBeenCalled();
    });

    it('rejects when no payment was ever started for the booking', async () => {
        mockPrisma.rideBooking.findFirst.mockReset();
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);
        mockPrisma.rideBooking.findFirst.mockResolvedValueOnce({
            status: 'PAYMENT_PENDING',
            stripePaymentIntentId: null,
        });

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('PAYMENT_NOT_INITIALIZED');
        expect(mockRetrieve).not.toHaveBeenCalled();
    });

    it('rejects a booking that can no longer be paid for', async () => {
        mockPrisma.rideBooking.findFirst.mockReset();
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);
        mockPrisma.rideBooking.findFirst.mockResolvedValueOnce({
            status: 'CANCELLED',
            stripePaymentIntentId: 'pi_123',
        });

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('BOOKING_NOT_PAYABLE');
    });

    it('surfaces a Stripe outage as its own error instead of an unpaid booking', async () => {
        mockRetrieve.mockRejectedValue(new Error('stripe unreachable'));

        await expect(confirmBookingPayment('passenger-1', 'booking-1'))
            .rejects.toThrow('PAYMENT_VERIFICATION_UNAVAILABLE');
        expect(mockPrisma.rideBooking.updateMany).not.toHaveBeenCalled();
    });

    it('advances a paid booking out of PAYMENT_PENDING under a status guard', async () => {
        mockRetrieve.mockResolvedValue(intentWith('succeeded'));
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.rideBooking.findUniqueOrThrow.mockResolvedValue(reservableBooking);
        mockPrisma.rideBooking.findUnique.mockResolvedValue(null);

        await confirmBookingPayment('passenger-1', 'booking-1');

        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'booking-1', status: 'PAYMENT_PENDING' },
            data: expect.objectContaining({ status: 'DRIVER_PENDING' }),
        }));
    });

    it('takes the seats only once the payment has confirmed', async () => {
        mockRetrieve.mockResolvedValue(intentWith('succeeded'));
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.rideBooking.findUniqueOrThrow.mockResolvedValue(reservableBooking);
        mockPrisma.rideBooking.findUnique.mockResolvedValue(null);
        mockPrisma.rideSegmentCapacity.findMany.mockResolvedValue([
            { rideId: 'ride-1', fromPosition: 0, toPosition: 2, occupiedSeats: 0 },
        ]);

        await confirmBookingPayment('passenger-1', 'booking-1');

        // seatsReservedAt is stamped in the same write as the status flip, so the row
        // records that it now holds capacity.
        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ seatsReservedAt: expect.any(Date) }),
        }));
        expect(mockPrisma.rideSegmentCapacity.updateMany).toHaveBeenCalled();
    });

    it('refunds the rider when the ride filled up before their payment landed', async () => {
        mockRetrieve.mockResolvedValue(intentWith('succeeded'));
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.rideBooking.findUniqueOrThrow.mockResolvedValue(reservableBooking);
        // Every edge is already full, so reservation cannot succeed.
        mockPrisma.rideSegmentCapacity.findMany.mockResolvedValue([
            { rideId: 'ride-1', fromPosition: 0, toPosition: 2, occupiedSeats: 4 },
        ]);
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            passengerId: 'passenger-1',
            paymentAmount: 25,
            totalPrice: 25,
            ride: { id: 'ride-1', driverId: 'driver-1', originAddress: 'A', destinationAddress: 'B' },
        });

        await confirmBookingPayment('passenger-1', 'booking-1');

        expect(mockedRefundPaymentIntent).toHaveBeenCalledWith('pi_123', 2500);
        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'booking-1', status: 'PAYMENT_PENDING' },
            data: expect.objectContaining({ status: 'RIDE_FULL_REFUNDED' }),
        }));
    });

    it('is idempotent once the booking has already been paid for', async () => {
        mockPrisma.rideBooking.findFirst.mockReset();
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);
        mockPrisma.rideBooking.findFirst.mockResolvedValueOnce({
            status: 'CONFIRMED',
            stripePaymentIntentId: 'pi_123',
        });

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).resolves.not.toThrow();
        expect(mockRetrieve).not.toHaveBeenCalled();
        expect(mockPrisma.rideBooking.updateMany).not.toHaveBeenCalled();
    });

    it('does not call Stripe when payments are bypassed', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        await expect(confirmBookingPayment('passenger-1', 'booking-1')).rejects.toThrow('PAYMENT_NOT_INITIALIZED');
        expect(mockRetrieve).not.toHaveBeenCalled();
    });
});
