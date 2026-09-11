const mockPrisma = {
    $transaction: jest.fn(),
    rideBooking: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
};

jest.mock('../config/index.js', () => ({
    __esModule: true,
    // withPrismaFallback: unlisted models/methods resolve empty instead of throwing.
    prisma: require('../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

jest.mock('./redisConnection.js', () => ({
    __esModule: true,
    bullRedis: {},
}));

const mockQueueAdd = jest.fn().mockResolvedValue({});

jest.mock('bullmq', () => ({
    __esModule: true,
    Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd })),
    Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

jest.mock('../modules/notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../modules/payments/stripe.service.js', () => ({
    __esModule: true,
    cancelPaymentIntent: jest.fn().mockResolvedValue({}),
    refundPaymentIntent: jest.fn().mockResolvedValue({}),
}));

jest.mock('../modules/ride-booking/segment-capacity.utils.js', () => ({
    __esModule: true,
    releaseSegmentSeats: jest.fn().mockResolvedValue(undefined),
    releaseBookingSeats: jest.fn().mockResolvedValue(false),
}));

import { bookingPaymentWindowMs, expireUnpaidBooking } from './deadline.queue';
import { cancelPaymentIntent } from '../modules/payments/stripe.service.js';
import { releaseBookingSeats } from '../modules/ride-booking/segment-capacity.utils.js';
import { createNotification } from '../modules/notification/notification.service.js';

const mockedCancelPaymentIntent = cancelPaymentIntent as jest.Mock;
const mockedReleaseBookingSeats = releaseBookingSeats as jest.Mock;
const mockedCreateNotification = createNotification as jest.Mock;

const unpaidBooking = {
    id: 'booking-1',
    status: 'PAYMENT_PENDING',
    rideId: 'ride-1',
    passengerId: 'passenger-1',
    seatsBooked: 1,
    pickupPosition: 0,
    dropoffPosition: 1,
    stripePaymentIntentId: 'pi_123',
    ride: { totalSeats: 3, originAddress: 'A', destinationAddress: 'B' },
};

describe('bookingPaymentWindowMs', () => {
    afterEach(() => {
        delete process.env.BOOKING_PAYMENT_WINDOW_MINUTES;
    });

    it('defaults to 15 minutes', () => {
        expect(bookingPaymentWindowMs()).toBe(15 * 60 * 1000);
    });

    it('is configurable', () => {
        process.env.BOOKING_PAYMENT_WINDOW_MINUTES = '5';
        expect(bookingPaymentWindowMs()).toBe(5 * 60 * 1000);
    });
});

describe('expireUnpaidBooking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.$transaction.mockImplementation(
            async (callback: (tx: unknown) => unknown) => callback(mockPrisma)
        );
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });
        mockedReleaseBookingSeats.mockResolvedValue(false);
        mockedCancelPaymentIntent.mockResolvedValue({});
    });

    it('closes out a booking the rider never paid for', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(unpaidBooking);

        await expect(expireUnpaidBooking('booking-1')).resolves.toBe(true);

        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'booking-1', status: 'PAYMENT_PENDING' },
            data: expect.objectContaining({ status: 'PAYMENT_FAILED' }),
        }));
    });

    it('cancels the PaymentIntent so it cannot be charged afterwards', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(unpaidBooking);

        await expireUnpaidBooking('booking-1');

        expect(mockedCancelPaymentIntent).toHaveBeenCalledWith('pi_123');
    });

    it('tells the rider their booking was closed and can be made again', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(unpaidBooking);

        await expireUnpaidBooking('booking-1');

        expect(mockedCreateNotification).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'passenger-1',
            type: 'booking.payment.expired',
        }));
    });

    it('leaves a booking alone once its payment has landed', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            ...unpaidBooking,
            status: 'DRIVER_PENDING',
        });

        await expect(expireUnpaidBooking('booking-1')).resolves.toBe(false);

        expect(mockPrisma.rideBooking.updateMany).not.toHaveBeenCalled();
        expect(mockedCancelPaymentIntent).not.toHaveBeenCalled();
    });

    it('does nothing when another writer claimed the booking first', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(unpaidBooking);
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 0 });

        await expect(expireUnpaidBooking('booking-1')).resolves.toBe(false);

        expect(mockedCancelPaymentIntent).not.toHaveBeenCalled();
        expect(mockedCreateNotification).not.toHaveBeenCalled();
    });

    it('is a no-op for a booking that no longer exists', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue(null);

        await expect(expireUnpaidBooking('gone')).resolves.toBe(false);
    });
});
