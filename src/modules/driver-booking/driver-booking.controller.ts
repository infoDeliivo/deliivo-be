import { Response } from 'express';
import { deleteCache, deleteCachePattern } from '../../services/cache.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import * as DriverBookingService from './driver-booking.service.js';

const cacheKeys = {
    booking: (id: string) => `booking:${id}`,
    ride: (id: string) => `ride:${id}`,
    rideDetailsPattern: (id: string) => `ride:details:${id}:*`,
    userBookings: (userId: string) => `user:${userId}:bookings`,
};

const invalidateBookingCaches = async (bookingId: string, rideId: string, passengerId: string) => {
    await deleteCache(cacheKeys.booking(bookingId));
    await deleteCache(cacheKeys.ride(rideId));
    await deleteCache(cacheKeys.userBookings(passengerId));
    await deleteCachePattern(cacheKeys.rideDetailsPattern(rideId));
};

const mapDriverActionError = (error: Error) => {
    switch (error.message) {
        case 'BOOKING_NOT_FOUND':
            return { status: HttpStatus.NOT_FOUND, message: 'Booking not found' };
        case 'FORBIDDEN_DRIVER':
            return { status: HttpStatus.FORBIDDEN, message: 'Only the assigned driver can perform this action' };
        case 'DRIVER_NOT_VERIFIED':
            return { status: HttpStatus.FORBIDDEN, message: 'Your driving licence must be verified before accepting bookings' };
        case 'BOOKING_NOT_DRIVER_PENDING':
            return { status: HttpStatus.CONFLICT, message: 'Booking is not waiting for driver decision' };
        case 'BOOKING_DECISION_DEADLINE_PASSED':
            return { status: HttpStatus.CONFLICT, message: 'Driver decision deadline has passed' };
        case 'BOOKING_NOT_CONFIRMED':
            return { status: HttpStatus.CONFLICT, message: 'Booking is not in confirmed state' };
        case 'INVALID_BOOKING_STATUS':
            return { status: HttpStatus.CONFLICT, message: 'Booking status does not allow this OTP verification' };
        case 'PICKUP_OTP_NOT_AVAILABLE':
        case 'DROP_OTP_NOT_AVAILABLE':
            return { status: HttpStatus.BAD_REQUEST, message: 'OTP is not available for this booking' };
        case 'PICKUP_OTP_EXPIRED':
        case 'DROP_OTP_EXPIRED':
            return { status: HttpStatus.BAD_REQUEST, message: 'OTP has expired' };
        case 'INVALID_PICKUP_OTP':
        case 'INVALID_DROP_OTP':
            return { status: HttpStatus.BAD_REQUEST, message: 'OTP is invalid' };
        case 'OTP_ATTEMPT_LIMIT_EXCEEDED':
            return { status: HttpStatus.CONFLICT, message: 'Maximum OTP attempts exceeded' };
        default:
            return { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to process driver booking action' };
    }
};

export const acceptBooking = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        console.log(bookingId,"hii");
        
        const result = await DriverBookingService.acceptBooking(req.user.id, bookingId);
        await invalidateBookingCaches(result.bookingId, result.rideId, result.passengerId);

        return sendSuccess(res, {
            message: 'Booking accepted successfully',
            data: result,
        });
    } catch (error: any) {
        console.log("hii",error);
        const mapped = mapDriverActionError(error as Error);
        return sendError(res, mapped);
    }
};

export const rejectBooking = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const { reason } = req.body as { reason: string };
        const result = await DriverBookingService.rejectBooking(req.user.id, bookingId, reason);
        await invalidateBookingCaches(result.bookingId, result.rideId, result.passengerId);

        return sendSuccess(res, {
            message: 'Booking rejected successfully',
            data: result,
        });
    } catch (error: any) {
        const mapped = mapDriverActionError(error as Error);
        return sendError(res, mapped);
    }
};

export const cancelAfterAccept = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const { reason } = req.body as { reason: string };
        const result = await DriverBookingService.cancelAfterAccept(req.user.id, bookingId, reason);
        await invalidateBookingCaches(result.bookingId, result.rideId, result.passengerId);

        return sendSuccess(res, {
            message: 'Booking cancelled successfully',
            data: result,
        });
    } catch (error: any) {
        const mapped = mapDriverActionError(error as Error);
        return sendError(res, mapped);
    }
};

export const verifyPickupOtp = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const { otp } = req.body as { otp: string };
        const result = await DriverBookingService.verifyPickupOtp(req.user.id, bookingId, otp);
        await invalidateBookingCaches(result.bookingId, result.rideId, result.passengerId);

        return sendSuccess(res, {
            message: 'Pickup OTP verified successfully',
            data: result,
        });
    } catch (error: any) {
        const mapped = mapDriverActionError(error as Error);
        return sendError(res, mapped);
    }
};

export const verifyDropOtp = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const { otp } = req.body as { otp: string };
        const result = await DriverBookingService.verifyDropOtp(req.user.id, bookingId, otp);
        await invalidateBookingCaches(result.bookingId, result.rideId, result.passengerId);

        return sendSuccess(res, {
            message: 'Drop OTP verified successfully',
            data: result,
        });
    } catch (error: any) {
        const mapped = mapDriverActionError(error as Error);
        return sendError(res, mapped);
    }
};
