import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { cacheKeys, deleteCache } from '../../services/cache.service.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { submitBookingRating } from './ratings.service.js';

const mapRatingError = (error: Error) => {
  switch (error.message) {
    case 'BOOKING_NOT_FOUND':
      return { status: HttpStatus.NOT_FOUND, message: 'Booking not found' };
    case 'NOT_BOOKING_PARTICIPANT':
      return {
        status: HttpStatus.FORBIDDEN,
        message: 'You are not a participant in this booking',
      };
    case 'BOOKING_NOT_COMPLETED':
      return {
        status: HttpStatus.CONFLICT,
        message: 'Rating is allowed only after trip completion',
      };
    case 'RATING_ALREADY_SUBMITTED':
      return {
        status: HttpStatus.CONFLICT,
        message: 'Rating already submitted for this booking',
      };
    case 'INVALID_RATING_VALUE':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Stars must be an integer between 1 and 5',
      };
    case 'SELF_RATING_NOT_ALLOWED':
      return {
        status: HttpStatus.BAD_REQUEST,
        message: 'Self rating is not allowed',
      };
    default:
      return { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to submit rating' };
  }
};

export const submitRating = async (req: AuthRequest, res: Response) => {
  try {
    const bookingId = req.params.bookingId as string;
    const rating = await submitBookingRating(req.user.id, bookingId, req.body);

    // Invalidate ratee's profile cache
    try {
      await deleteCache(cacheKeys.userProfile(rating.rateeId));
      await deleteCache(cacheKeys.publicProfile(rating.rateeId));
    } catch (cacheError) {
      console.error('Cache invalidation failed:', cacheError);
      // Continue - rating was successfully saved
    }

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Rating submitted successfully',
      data: rating,
    });
  } catch (error: any) {
    return sendError(res, mapRatingError(error as Error));
  }
};
