const mockPrisma = {
    rideBooking: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    ride: {
        update: jest.fn(),
    },
    driverPenaltyEvent: {
        create: jest.fn(),
    },
    $transaction: jest.fn(),
};

const mockCreateNotification = jest.fn();
const mockRefundPaymentIntent = jest.fn();
const mockGenerateBookingOtp = jest.fn();
const mockHashOtp = jest.fn();
const mockIsOtpValid = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    refundPaymentIntent: (...args: unknown[]) => mockRefundPaymentIntent(...args),
}));

jest.mock('../ride-booking/booking-otp.utils.js', () => ({
    __esModule: true,
    generateBookingOtp: (...args: unknown[]) => mockGenerateBookingOtp(...args),
    hashOtp: (...args: unknown[]) => mockHashOtp(...args),
    isOtpValid: (...args: unknown[]) => mockIsOtpValid(...args),
}));

import { BookingStatus } from '@prisma/client';
import {
    acceptBooking,
    rejectBooking,
    cancelAfterAccept,
    verifyPickupOtp,
} from './driver-booking.service.js';

describe('driver booking service', () => {
    beforeEach(() => {
        process.env.BOOKING_PAYMENT_MODE = 'stripe';
        jest.clearAllMocks();
        mockHashOtp.mockImplementation((otp: string) => `hash-${otp}`);
    });

    it('allows ride driver to accept DRIVER_PENDING booking before deadline', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-1',
            rideId: 'ride-1',
            passengerId: 'passenger-1',
            status: BookingStatus.DRIVER_PENDING,
            driverDecisionDeadlineAt: new Date(Date.now() + 60_000),
            passenger: { id: 'passenger-1', name: 'Rider', avatarUrl: null },
            ride: {
                id: 'ride-1',
                driverId: 'driver-1',
                originAddress: 'Mathura',
                destinationAddress: 'Delhi',
            },
        });

        mockGenerateBookingOtp
            .mockReturnValueOnce('111111')
            .mockReturnValueOnce('222222');

        mockPrisma.rideBooking.update.mockResolvedValue({
            id: 'booking-1',
            rideId: 'ride-1',
            passengerId: 'passenger-1',
            status: BookingStatus.CONFIRMED,
        });

        const result = await acceptBooking('driver-1', 'booking-1');

        expect(result.status).toBe(BookingStatus.CONFIRMED);
        expect(mockPrisma.rideBooking.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: BookingStatus.CONFIRMED,
                }),
            })
        );
        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'passenger-1',
                type: 'booking.driver.accepted',
            })
        );
    });

    it('reject flow triggers refund and seat restore', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-2',
            rideId: 'ride-2',
            passengerId: 'passenger-2',
            status: BookingStatus.DRIVER_PENDING,
            paymentCapturedAt: new Date(),
            paymentAmount: 500,
            totalPrice: 500,
            stripePaymentIntentId: 'pi_2',
            driverDecisionDeadlineAt: new Date(Date.now() + 60_000),
            passenger: { id: 'passenger-2', name: 'Rider', avatarUrl: null },
            ride: {
                id: 'ride-2',
                driverId: 'driver-2',
                originAddress: 'A',
                destinationAddress: 'B',
            },
        });

        mockRefundPaymentIntent.mockResolvedValue({ id: 're_2' });

        const tx = {
            rideBooking: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'booking-2',
                    status: BookingStatus.DRIVER_PENDING,
                    rideId: 'ride-2',
                    passengerId: 'passenger-2',
                    seatsBooked: 1,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            ride: {
                update: jest.fn().mockResolvedValue({}),
            },
        };

        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const result = await rejectBooking('driver-2', 'booking-2');

        expect(result.status).toBe(BookingStatus.CANCELLED);
        expect(mockRefundPaymentIntent).toHaveBeenCalled();
        expect(tx.ride.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { availableSeats: { increment: 1 } },
            })
        );
    });

    it('moves booking CONFIRMED -> IN_PROGRESS on valid pickup OTP', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-3',
            rideId: 'ride-3',
            passengerId: 'passenger-3',
            status: BookingStatus.CONFIRMED,
            pickupOtpHash: 'hash-111111',
            pickupOtpExpiresAt: new Date(Date.now() + 60_000),
            otpAttemptCount: 0,
            passenger: { id: 'passenger-3', name: 'Rider', avatarUrl: null },
            ride: {
                id: 'ride-3',
                driverId: 'driver-3',
                originAddress: 'A',
                destinationAddress: 'B',
            },
        });

        mockIsOtpValid.mockReturnValue(true);
        mockPrisma.rideBooking.update.mockResolvedValue({
            id: 'booking-3',
            rideId: 'ride-3',
            passengerId: 'passenger-3',
            status: BookingStatus.IN_PROGRESS,
        });

        const result = await verifyPickupOtp('driver-3', 'booking-3', '111111');

        expect(result.status).toBe(BookingStatus.IN_PROGRESS);
        expect(mockPrisma.rideBooking.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: BookingStatus.IN_PROGRESS,
                }),
            })
        );
    });

    it('increments attempt count on invalid pickup OTP', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-4',
            rideId: 'ride-4',
            passengerId: 'passenger-4',
            status: BookingStatus.CONFIRMED,
            pickupOtpHash: 'hash-111111',
            pickupOtpExpiresAt: new Date(Date.now() + 60_000),
            otpAttemptCount: 0,
            passenger: { id: 'passenger-4', name: 'Rider', avatarUrl: null },
            ride: {
                id: 'ride-4',
                driverId: 'driver-4',
                originAddress: 'A',
                destinationAddress: 'B',
            },
        });

        mockIsOtpValid.mockReturnValue(false);
        mockPrisma.rideBooking.update.mockResolvedValue({});

        await expect(
            verifyPickupOtp('driver-4', 'booking-4', '999999')
        ).rejects.toThrow('INVALID_PICKUP_OTP');

        expect(mockPrisma.rideBooking.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { otpAttemptCount: { increment: 1 } },
            })
        );
    });

    it('reject in bypass mode does not call Stripe refund and still marks refund fields', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-bypass-reject',
            rideId: 'ride-2',
            passengerId: 'passenger-2',
            status: BookingStatus.DRIVER_PENDING,
            paymentCapturedAt: new Date(),
            paymentAmount: 500,
            totalPrice: 500,
            stripePaymentIntentId: null,
            driverDecisionDeadlineAt: new Date(Date.now() + 60_000), // Avoid BOOKING_DECISION_DEADLINE_PASSED
            passenger: { id: 'passenger-2', name: 'Rider', avatarUrl: null },
            ride: { id: 'ride-2', driverId: 'driver-2', originAddress: 'A', destinationAddress: 'B' },
        });

        const tx = {
            rideBooking: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'booking-bypass-reject',
                    status: BookingStatus.DRIVER_PENDING,
                    rideId: 'ride-2',
                    passengerId: 'passenger-2',
                    seatsBooked: 1,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            ride: { update: jest.fn().mockResolvedValue({}) },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        await rejectBooking('driver-2', 'booking-bypass-reject');

        expect(mockRefundPaymentIntent).not.toHaveBeenCalled();
        expect(tx.rideBooking.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    refundPercent: 100,
                    refundAmount: 500,
                }),
            })
        );
    });

    it('cancel-after-accept in bypass mode does not call Stripe refund', async () => {
        process.env.BOOKING_PAYMENT_MODE = 'bypass';

        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-bypass-cancel',
            rideId: 'ride-3',
            passengerId: 'passenger-3',
            status: BookingStatus.CONFIRMED,
            paymentCapturedAt: new Date(),
            paymentAmount: 900,
            totalPrice: 900,
            stripePaymentIntentId: null,
            passenger: { id: 'passenger-3', name: 'Rider', avatarUrl: null },
            ride: { id: 'ride-3', driverId: 'driver-3', originAddress: 'A', destinationAddress: 'B' },
        });

        const tx = {
            rideBooking: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'booking-bypass-cancel',
                    status: BookingStatus.CONFIRMED,
                    rideId: 'ride-3',
                    passengerId: 'passenger-3',
                    seatsBooked: 1,
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            ride: { update: jest.fn().mockResolvedValue({}) },
            driverPenaltyEvent: { create: jest.fn().mockResolvedValue({}) },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        await cancelAfterAccept('driver-3', 'booking-bypass-cancel');

        expect(mockRefundPaymentIntent).not.toHaveBeenCalled();
        expect(tx.driverPenaltyEvent.create).toHaveBeenCalled();
    });
});
