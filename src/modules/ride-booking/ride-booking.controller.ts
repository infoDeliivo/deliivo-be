import { Response } from 'express';
import { deleteCache, deleteCachePattern, getCache, setCache } from '../../services/cache.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import * as BookingService from './ride-booking.service.js';

const cacheKeys = {
    booking: (id: string) => `booking:${id}`,
    bookingPattern: (id: string) => `booking:${id}:*`,
    userBookings: (userId: string) => `user:${userId}:bookings`,
    ride: (id: string) => `ride:${id}`,
    rideDetailsPattern: (id: string) => `ride:details:${id}:*`,
};

/* ================= CREATE BOOKING ================= */
export const createBooking = async (req: AuthRequest, res: Response) => {
    try {
        const booking = await BookingService.createBooking(req.user.id, req.body);

        await deleteCache(cacheKeys.userBookings(req.user.id));
        await deleteCache(cacheKeys.ride(req.body.rideId));
        await deleteCachePattern(cacheKeys.rideDetailsPattern(req.body.rideId));

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Booking created, payment required',
            data: booking,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to create booking';

        switch (error.message) {
            case 'RIDE_NOT_FOUND':
                status = HttpStatus.NOT_FOUND;
                message = 'Ride not found or not available';
                break;
            case 'CANNOT_BOOK_OWN_RIDE':
                status = HttpStatus.BAD_REQUEST;
                message = 'You cannot book your own ride';
                break;
            case 'INSUFFICIENT_SEATS':
                status = HttpStatus.BAD_REQUEST;
                message = 'Not enough seats available';
                break;
            case 'MINIMUM_ONE_SEAT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'At least one seat must be booked';
                break;
            case 'MAXIMUM_SEATS_EXCEEDED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Maximum 4 seats per booking';
                break;
            case 'BOOKING_ALREADY_EXISTS':
                status = HttpStatus.CONFLICT;
                message = 'You already have an active booking for this ride';
                break;
            case 'TOS_NOT_ACCEPTED':
                status = HttpStatus.FORBIDDEN;
                message = 'You must accept the Terms of Service and Privacy Policy before booking a ride';
                break;
            case 'USER_BANNED':
                status = HttpStatus.FORBIDDEN;
                message = 'Your account has been suspended';
                break;
            case 'USER_BLOCKED':
                status = HttpStatus.FORBIDDEN;
                message = 'You cannot book this ride';
                break;
            case 'FEMALE_ONLY_RIDE':
                status = HttpStatus.FORBIDDEN;
                message = 'This ride is for female passengers only';
                break;
            case 'PASSENGER_TOO_YOUNG':
                status = HttpStatus.FORBIDDEN;
                message = 'Passengers must be at least 8 years old to book a ride';
                break;
            case 'CHILD_SEAT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'This booking requires a ride with a child seat';
                break;
            case 'INVALID_BOOKING_SEGMENT':
                status = HttpStatus.BAD_REQUEST;
                message = 'Selected ride segment is invalid';
                break;
            case 'INVALID_RIDE_DEPARTURE_TIME':
                status = HttpStatus.BAD_REQUEST;
                message = 'Ride departure time is invalid';
                break;
            case 'PAYMENT_INITIALIZATION_FAILED':
                status = HttpStatus.INTERNAL_ERROR;
                message = 'Could not initialize payment intent';
                break;
        }

        if (status === HttpStatus.INTERNAL_ERROR && process.env.NODE_ENV !== 'production') {
            const detail = error?.message ? ` (${error.message})` : '';
            message = `Failed to create booking${detail}`;
        }

        return sendError(res, { status, message });
    }
};

/* ================= CHECK PAYMENT STATUS ================= */
export const confirmBookingPaymentStatus = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const booking = await BookingService.getBookingPaymentStatus(req.user.id, bookingId);

        if (!booking) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Booking not found',
            });
        }

        await deleteCache(cacheKeys.booking(bookingId));

        return sendSuccess(res, {
            message: 'Booking payment status fetched successfully',
            data: booking,
        });
    } catch {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch booking payment status',
        });
    }
};

/* ================= EXTEND WAIT FOR DRIVER ================= */
export const extendWaitForDriver = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await BookingService.extendWaitForDriver(req.user.id, bookingId);

        await deleteCache(cacheKeys.booking(bookingId));
        await deleteCachePattern(cacheKeys.bookingPattern(bookingId));

        return sendSuccess(res, {
            message: 'Waiting period extended successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to extend waiting period';

        switch (error.message) {
            case 'BOOKING_NOT_FOUND':
                status = HttpStatus.NOT_FOUND;
                message = 'Booking not found';
                break;
            case 'BOOKING_NOT_DRIVER_PENDING':
                status = HttpStatus.CONFLICT;
                message = 'Booking is not waiting for driver confirmation';
                break;
            case 'DEADLINE_NOT_EXPIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Deadline has not expired yet';
                break;
            case 'ALREADY_EXTENDED':
                status = HttpStatus.CONFLICT;
                message = 'Waiting period already extended';
                break;
        }

        return sendError(res, { status, message });
    }
};

/* ================= CANCEL BOOKING ================= */
export const cancelBooking = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await BookingService.cancelBooking(req.user.id, bookingId, req.body?.reason);

        await deleteCache(cacheKeys.booking(bookingId));
        await deleteCachePattern(cacheKeys.bookingPattern(bookingId));
        await deleteCache(cacheKeys.userBookings(req.user.id));
        await deleteCache(cacheKeys.ride(result.rideId));
        await deleteCachePattern(cacheKeys.rideDetailsPattern(result.rideId));

        return sendSuccess(res, {
            message: 'Booking cancelled successfully',
            data: {
                refundPercent: result.refundPercent,
                refundAmount: result.refundAmount,
                refundInitiated: result.refundInitiated,
            },
        });
    } catch (error: any) {
        if (error.message === 'BOOKING_NOT_FOUND') {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Booking not found or cannot be cancelled',
            });
        }

        if (error.message === 'BOOKING_NOT_CANCELLABLE') {
            return sendError(res, {
                status: HttpStatus.CONFLICT,
                message: 'Booking can no longer be cancelled',
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to cancel booking',
        });
    }
};

/* ================= GET BOOKING BY ID ================= */
export const getBookingById = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const booking = await BookingService.getBookingById(req.user.id, bookingId);

        if (!booking) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Booking not found',
            });
        }

        return sendSuccess(res, {
            message: 'Booking fetched successfully',
            data: booking,
        });
    } catch {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch booking',
        });
    }
};

/* ================= LIST USER BOOKINGS ================= */
export const listUserBookings = async (req: AuthRequest, res: Response) => {
    try {
        const result = await BookingService.listUserBookings(req.user.id, req.query as any);

        return sendSuccess(res, {
            message: 'Bookings fetched successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Failed to fetch bookings:', error);

        let message = 'Failed to fetch bookings';
        if (process.env.NODE_ENV !== 'production' && error?.message) {
            message = `Failed to fetch bookings (${error.message})`;
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message,
        });
    }
};

/* ================= WITHDRAW BOOKING REQUEST ================= */
export const withdrawBooking = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await BookingService.withdrawBooking(req.user.id, bookingId, req.body?.reason);

        await deleteCache(cacheKeys.booking(bookingId));
        await deleteCachePattern(cacheKeys.bookingPattern(bookingId));
        await deleteCache(cacheKeys.userBookings(req.user.id));

        return sendSuccess(res, {
            message: 'Booking request withdrawn successfully',
            data: result,
        });
    } catch (error: any) {
        if (error.message === 'BOOKING_NOT_FOUND') {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Booking not found or not in pending state',
            });
        }
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to withdraw booking',
        });
    }
};

/* ================= DRIVER RESPONSE METRICS ================= */
export const getDriverResponseMetrics = async (req: AuthRequest, res: Response) => {
    try {
        const metrics = await BookingService.getDriverResponseMetrics(req.user.id);
        return sendSuccess(res, {
            message: 'Driver response metrics',
            data: metrics,
        });
    } catch {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch metrics',
        });
    }
};

/* ================= PRICE PREVIEW ================= */
export const getBookingPricePreview = async (req: AuthRequest, res: Response) => {
    try {
        const result = await BookingService.getBookingPricePreview(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Price preview calculated successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to calculate price preview';

        switch (error.message) {
            case 'RIDE_NOT_FOUND':
                status = HttpStatus.NOT_FOUND;
                message = 'Ride not found or not available';
                break;
            case 'CANNOT_BOOK_OWN_RIDE':
                status = HttpStatus.BAD_REQUEST;
                message = 'You cannot book your own ride';
                break;
            case 'INSUFFICIENT_SEATS':
                status = HttpStatus.BAD_REQUEST;
                message = 'Not enough seats available';
                break;
            case 'MINIMUM_ONE_SEAT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'At least one seat must be booked';
                break;
            case 'MAXIMUM_SEATS_EXCEEDED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Maximum 4 seats per booking';
                break;
            case 'INVALID_BOOKING_SEGMENT':
                status = HttpStatus.BAD_REQUEST;
                message = 'Selected ride segment is invalid';
                break;
            case 'PASSENGER_TOO_YOUNG':
                status = HttpStatus.FORBIDDEN;
                message = 'Passengers must be at least 8 years old to book a ride';
                break;
            case 'CHILD_SEAT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'This booking requires a ride with a child seat';
                break;
        }

        return sendError(res, { status, message });
    }
};
