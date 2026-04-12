import { BookingStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import { SubmitRatingInput, SubmittedRating } from './ratings.types.js';

const round2 = (value: number): number => Number(value.toFixed(2));

export const submitBookingRating = async (
  raterId: string,
  bookingId: string,
  input: SubmitRatingInput
): Promise<SubmittedRating> => {
  // Validate stars are integer 1-5
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) {
    throw new Error('INVALID_RATING_VALUE');
  }

  // Check booking exists and get details
  const booking = await prisma.rideBooking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      rideId: true,
      status: true,
      passengerId: true,
      ride: {
        select: {
          driverId: true,
        },
      },
    },
  });

  if (!booking) throw new Error('BOOKING_NOT_FOUND');
  if (booking.status !== BookingStatus.COMPLETED) throw new Error('BOOKING_NOT_COMPLETED');

  // Check rater is participant (passenger or driver)
  const isPassenger = booking.passengerId === raterId;
  const isDriver = booking.ride.driverId === raterId;

  if (!isPassenger && !isDriver) throw new Error('NOT_BOOKING_PARTICIPANT');

  // Determine ratee based on rater role
  const rateeId = isPassenger ? booking.ride.driverId : booking.passengerId;
  
  // Prevent self-rating
  if (rateeId === raterId) throw new Error('SELF_RATING_NOT_ALLOWED');

  // Check for duplicate rating
  const existing = await prisma.rideRating.findUnique({
    where: {
      bookingId_raterId: {
        bookingId,
        raterId,
      },
    },
    select: { id: true },
  });

  if (existing) throw new Error('RATING_ALREADY_SUBMITTED');

  // Normalize review text (trim, null if empty/whitespace)
  const reviewText = input.reviewText?.trim() ? input.reviewText.trim() : null;

  // Transactional write: create rating + update stats
  const created = await prisma.$transaction(async (tx) => {
    // Create rating event
    const rating = await tx.rideRating.create({
      data: {
        bookingId: booking.id,
        rideId: booking.rideId,
        raterId,
        rateeId,
        stars: input.stars,
        reviewText,
      },
    });

    // Query existing stats for ratee
    const existingStats = await tx.userRatingStats.findUnique({
      where: { userId: rateeId },
    });

    if (!existingStats) {
      // First rating: create stats row
      await tx.userRatingStats.create({
        data: {
          userId: rateeId,
          totalRatings: 1,
          totalStars: input.stars,
          averageRating: round2(input.stars),
        },
      });
    } else {
      // Subsequent rating: update stats
      const totalRatings = existingStats.totalRatings + 1;
      const totalStars = existingStats.totalStars + input.stars;
      await tx.userRatingStats.update({
        where: { userId: rateeId },
        data: {
          totalRatings,
          totalStars,
          averageRating: round2(totalStars / totalRatings),
        },
      });
    }

    return rating;
  });

  return {
    id: created.id,
    bookingId: created.bookingId,
    rideId: created.rideId,
    raterId: created.raterId,
    rateeId: created.rateeId,
    stars: created.stars,
    reviewText: created.reviewText,
    createdAt: created.createdAt,
  };
};
