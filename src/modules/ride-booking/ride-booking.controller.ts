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
            status: booking.resumed ? HttpStatus.OK : HttpStatus.CREATED,
            message: booking.resumed
                ? 'You already have an unpaid booking for this ride; finish paying for it'
                : 'Booking created, payment required',
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
            case 'CHILD_SEAT_ACK_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Riders travelling with a child aged 2 or younger must confirm they will bring their own child seat';
                break;
            case 'INVALID_BOOKING_SEGMENT':
                status = HttpStatus.BAD_REQUEST;
                message = 'Selected ride segment is invalid';
                break;
            case 'PICKUP_POINT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Choose a pickup point for this ride';
                break;
            case 'DROPOFF_POINT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Choose a drop-off point for this ride';
                break;
            case 'INVALID_RIDE_DEPARTURE_TIME':
                status = HttpStatus.BAD_REQUEST;
                message = 'Ride departure time is invalid';
                break;
            case 'BOOKING_WINDOW_CLOSED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Same-day rides must be booked at least 1 hour before departure';
                break;
            case 'PAYMENT_INITIALIZATION_FAILED':
                status = HttpStatus.INTERNAL_ERROR;
                message = 'Could not initialize payment intent';
                break;
            case 'BOOKING_PRICE_CHANGED':
                status = HttpStatus.CONFLICT;
                message = 'The fare for this ride changed. Review the price and book again';
                break;
            case 'PAYMENT_VERIFICATION_UNAVAILABLE':
                status = HttpStatus.SERVICE_UNAVAILABLE;
                message = 'Could not check your existing payment right now. Try again in a moment';
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
/**
 * Payment-confirmation failures. Each is a real, actionable state — the endpoint
 * must never answer 200 for a booking whose payment has not gone through.
 */
const PAYMENT_CONFIRM_ERRORS: Record<string, { status: HttpStatus; message: string }> = {
    PAYMENT_REQUIRES_ACTION: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Payment needs to be authenticated. Complete the verification with your bank and try again.',
    },
    PAYMENT_METHOD_REQUIRED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Payment was not completed. Add or select another payment method and try again.',
    },
    PAYMENT_NOT_CONFIRMED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Payment has not been submitted yet. Complete the payment to confirm your booking.',
    },
    PAYMENT_PROCESSING: {
        status: HttpStatus.BAD_REQUEST,
        message: "Payment is still processing. We'll confirm your booking as soon as it clears.",
    },
    PAYMENT_CANCELLED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'Payment was cancelled. Book this ride again to continue.',
    },
    PAYMENT_NOT_INITIALIZED: {
        status: HttpStatus.BAD_REQUEST,
        message: 'No payment was started for this booking. Book this ride again to continue.',
    },
    BOOKING_NOT_PAYABLE: {
        status: HttpStatus.BAD_REQUEST,
        message: 'This booking can no longer be paid for.',
    },
    PAYMENT_VERIFICATION_UNAVAILABLE: {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        message: 'Could not verify the payment right now. Try again in a moment.',
    },
};

export const resumeBookingPayment = async (req: AuthRequest, res: Response) => {
    const bookingId = req.params.id as string;

    try {
        const booking = await BookingService.resumeBookingPayment(req.user.id, bookingId);

        if (!booking) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Booking not found',
            });
        }

        return sendSuccess(res, {
            message: 'Payment ready to be completed',
            data: booking,
        });
    } catch (error: unknown) {
        const code = error instanceof Error ? error.message : '';
        const mapped = PAYMENT_CONFIRM_ERRORS[code];

        if (mapped) {
            await deleteCache(cacheKeys.booking(bookingId));

            return sendError(res, {
                status: mapped.status,
                message: mapped.message,
                error: code,
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to resume booking payment',
        });
    }
};

export const confirmBookingPaymentStatus = async (req: AuthRequest, res: Response) => {
    const bookingId = req.params.id as string;

    try {
        const booking = await BookingService.confirmBookingPayment(req.user.id, bookingId);

        if (!booking) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Booking not found',
            });
        }

        await deleteCache(cacheKeys.booking(bookingId));

        return sendSuccess(res, {
            message: 'Booking payment confirmed successfully',
            data: booking,
        });
    } catch (error: unknown) {
        const code = error instanceof Error ? error.message : '';
        const mapped = PAYMENT_CONFIRM_ERRORS[code];

        if (mapped) {
            // The booking state may have changed (e.g. cancelled intent), so drop the cache.
            await deleteCache(cacheKeys.booking(bookingId));

            return sendError(res, {
                status: mapped.status,
                message: mapped.message,
                error: code,
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to confirm booking payment',
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

        if (error.message === 'CANCELLATION_WINDOW_CLOSED') {
            return sendError(res, {
                status: HttpStatus.CONFLICT,
                message: 'Confirmed bookings cannot be cancelled within 3 hours of departure',
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
            case 'PICKUP_POINT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Choose a pickup point for this ride';
                break;
            case 'DROPOFF_POINT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Choose a drop-off point for this ride';
                break;
            case 'PASSENGER_TOO_YOUNG':
                status = HttpStatus.FORBIDDEN;
                message = 'Passengers must be at least 8 years old to book a ride';
                break;
            case 'CHILD_SEAT_ACK_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Riders travelling with a child aged 2 or younger must confirm they will bring their own child seat';
                break;
        }

        return sendError(res, { status, message });
    }
};
