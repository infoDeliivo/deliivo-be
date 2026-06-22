const mockPrisma = {
    rideBooking: {
        findUnique: jest.fn(),
    },
    rideRating: {
        findUnique: jest.fn(),
    },
    userRatingStats: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
    },
    $transaction: jest.fn(),
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { BookingStatus } from '@prisma/client';
import { submitBookingRating } from './ratings.service.js';

describe('submitBookingRating', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('allows passenger to rate driver on completed booking and creates stats row', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-1',
            rideId: 'ride-1',
            status: BookingStatus.COMPLETED,
            passengerId: 'passenger-1',
            ride: { driverId: 'driver-1' },
        });
        mockPrisma.rideRating.findUnique.mockResolvedValue(null);

        const tx = {
            rideRating: {
                create: jest.fn().mockResolvedValue({
                    id: 'rating-1',
                    bookingId: 'booking-1',
                    rideId: 'ride-1',
                    raterId: 'passenger-1',
                    rateeId: 'driver-1',
                    stars: 5,
                    reviewText: 'Great trip',
                    createdAt: new Date('2026-04-08T12:00:00.000Z'),
                }),
            },
            userRatingStats: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn(),
            },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const result = await submitBookingRating('passenger-1', 'booking-1', {
            stars: 5,
            reviewText: 'Great trip',
        });

        expect(result).toEqual({
            id: 'rating-1',
            bookingId: 'booking-1',
            rideId: 'ride-1',
            raterId: 'passenger-1',
            rateeId: 'driver-1',
            stars: 5,
            reviewText: 'Great trip',
            createdAt: new Date('2026-04-08T12:00:00.000Z'),
        });
        expect(tx.userRatingStats.create).toHaveBeenCalledWith({
            data: {
                userId: 'driver-1',
                totalRatings: 1,
                totalStars: 5,
                averageRating: 5,
            },
        });
    });

    it('allows driver to rate passenger on completed booking and updates stats row', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-2',
            rideId: 'ride-2',
            status: BookingStatus.COMPLETED,
            passengerId: 'passenger-2',
            ride: { driverId: 'driver-2' },
        });
        mockPrisma.rideRating.findUnique.mockResolvedValue(null);

        const tx = {
            rideRating: {
                create: jest.fn().mockResolvedValue({
                    id: 'rating-2',
                    bookingId: 'booking-2',
                    rideId: 'ride-2',
                    raterId: 'driver-2',
                    rateeId: 'passenger-2',
                    stars: 4,
                    reviewText: null,
                    createdAt: new Date('2026-04-08T12:10:00.000Z'),
                }),
            },
            userRatingStats: {
                findUnique: jest.fn().mockResolvedValue({
                    userId: 'passenger-2',
                    totalRatings: 2,
                    totalStars: 8,
                    averageRating: 4,
                }),
                create: jest.fn(),
                update: jest.fn().mockResolvedValue({}),
            },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const result = await submitBookingRating('driver-2', 'booking-2', { stars: 4 });

        expect(result.rateeId).toBe('passenger-2');
        expect(tx.userRatingStats.update).toHaveBeenCalledWith({
            where: { userId: 'passenger-2' },
            data: {
                totalRatings: 3,
                totalStars: 12,
                averageRating: 4,
            },
        });
    });

    it('rejects duplicate rating by same rater for same booking', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-3',
            rideId: 'ride-3',
            status: BookingStatus.COMPLETED,
            passengerId: 'passenger-3',
            ride: { driverId: 'driver-3' },
        });
        mockPrisma.rideRating.findUnique.mockResolvedValue({ id: 'existing-rating' });

        await expect(
            submitBookingRating('passenger-3', 'booking-3', { stars: 3 })
        ).rejects.toThrow('RATING_ALREADY_SUBMITTED');
    });

    it('allows rating after a failed pickup outcome', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-noshow',
            rideId: 'ride-noshow',
            status: BookingStatus.NO_SHOW,
            passengerId: 'passenger-noshow',
            ride: { driverId: 'driver-noshow' },
        });
        mockPrisma.rideRating.findUnique.mockResolvedValue(null);

        const tx = {
            rideRating: {
                create: jest.fn().mockResolvedValue({
                    id: 'rating-noshow',
                    bookingId: 'booking-noshow',
                    rideId: 'ride-noshow',
                    raterId: 'driver-noshow',
                    rateeId: 'passenger-noshow',
                    stars: 1,
                    reviewText: 'Passenger did not arrive',
                    createdAt: new Date('2026-04-08T12:20:00.000Z'),
                }),
            },
            userRatingStats: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({}),
                update: jest.fn(),
            },
        };
        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const result = await submitBookingRating('driver-noshow', 'booking-noshow', {
            stars: 1,
            reviewText: 'Passenger did not arrive',
        });

        expect(result.id).toBe('rating-noshow');
        expect(result.rateeId).toBe('passenger-noshow');
    });

    it('rejects when booking is not completed', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-4',
            rideId: 'ride-4',
            status: BookingStatus.CONFIRMED,
            passengerId: 'passenger-4',
            ride: { driverId: 'driver-4' },
        });

        await expect(
            submitBookingRating('passenger-4', 'booking-4', { stars: 5 })
        ).rejects.toThrow('BOOKING_NOT_COMPLETED');
    });

    it('rejects users not part of the booking', async () => {
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-5',
            rideId: 'ride-5',
            status: BookingStatus.COMPLETED,
            passengerId: 'passenger-5',
            ride: { driverId: 'driver-5' },
        });

        await expect(
            submitBookingRating('intruder-user', 'booking-5', { stars: 2 })
        ).rejects.toThrow('NOT_BOOKING_PARTICIPANT');
    });
});
