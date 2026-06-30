import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { HttpStatus, sendError, sendSuccess, logError } from '../../utils/index.js';
import { emitToRide } from '../../socket/index.js';
import { deleteCache, deleteCachePattern } from '../../services/cache.service.js';
import * as RideOpsService from './ride-operations.service.js';

const cacheKeys = {
    bookingPattern: (id: string) => `booking:${id}:*`,
    ride: (id: string) => `ride:${id}`,
    rideDetailsPattern: (id: string) => `ride:details:${id}:*`,
};

const invalidateRideCaches = async (rideId: string) => {
    await deleteCache(cacheKeys.ride(rideId));
    await deleteCachePattern(cacheKeys.rideDetailsPattern(rideId));
};

const invalidateBookingRideCaches = async (bookingId: string, rideId?: string) => {
    await deleteCachePattern(cacheKeys.bookingPattern(bookingId));
    if (rideId) {
        await invalidateRideCaches(rideId);
    }
};

// ============================================================
//  ERROR MAPPING
// ============================================================
const mapRideOpsError = (error: Error) => {
    switch (error.message) {
        case 'RIDE_NOT_FOUND':
            return { status: HttpStatus.NOT_FOUND, message: 'Ride not found' };
        case 'BOOKING_NOT_FOUND':
            return { status: HttpStatus.NOT_FOUND, message: 'Booking not found' };
        case 'FORBIDDEN_DRIVER':
            return { status: HttpStatus.FORBIDDEN, message: 'Only the assigned driver can perform this action' };
        case 'FORBIDDEN_PASSENGER':
            return { status: HttpStatus.FORBIDDEN, message: 'Only the passenger can perform this action' };
        case 'INVALID_RIDE_STATE_TRANSITION':
            return { status: HttpStatus.CONFLICT, message: 'Ride is not in a valid state for this transition' };
        case 'RIDE_NOT_IN_PROGRESS':
            return { status: HttpStatus.CONFLICT, message: 'Ride is not in progress' };
        case 'RIDE_TOO_EARLY':
            return { status: HttpStatus.CONFLICT, message: 'Ride cannot be started more than 10 minutes before the scheduled departure time' };
        case 'DEV_SIMULATION_DISABLED':
            return { status: HttpStatus.FORBIDDEN, message: 'Ride simulation is disabled' };
        case 'BOOKINGS_NOT_ALL_TERMINAL':
            return { status: HttpStatus.CONFLICT, message: 'All bookings must be completed, dropped, or cancelled before finishing the ride' };
        case 'BOOKING_NOT_WAITING_FOR_PICKUP':
            return { status: HttpStatus.CONFLICT, message: 'Booking is not waiting for pickup' };
        case 'BOOKING_NOT_AT_PICKUP':
            return { status: HttpStatus.CONFLICT, message: 'Booking is not at the pickup stage' };
        case 'BOOKING_NOT_READY_FOR_OTP':
            return { status: HttpStatus.CONFLICT, message: 'Booking is not ready for OTP verification' };
        case 'BOOKING_NOT_ONBOARD':
            return { status: HttpStatus.CONFLICT, message: 'Passenger is not onboard' };
        case 'BOOKING_NOT_DROP_PENDING':
            return { status: HttpStatus.CONFLICT, message: 'Booking is not awaiting drop-off confirmation' };
        case 'WAIT_TIME_NOT_ELAPSED':
            return { status: HttpStatus.CONFLICT, message: 'Required wait time has not elapsed yet' };
        case 'PICKUP_OTP_NOT_AVAILABLE':
            return { status: HttpStatus.BAD_REQUEST, message: 'Pickup OTP is not available for this booking' };
        case 'PICKUP_OTP_EXPIRED':
            return { status: HttpStatus.BAD_REQUEST, message: 'Pickup OTP has expired' };
        case 'INVALID_PICKUP_OTP':
            return { status: HttpStatus.BAD_REQUEST, message: 'Pickup OTP is invalid' };
        case 'OTP_ATTEMPT_LIMIT_EXCEEDED':
            return { status: HttpStatus.CONFLICT, message: 'Maximum OTP attempts exceeded' };
        default:
            return { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to process ride operation' };
    }
};

const handleError = (res: Response, error: unknown, context: string) => {
    logError(`Ride operation failed: ${context}`, error);
    const mapped = mapRideOpsError(error as Error);
    return sendError(res, mapped);
};

// ============================================================
//  RIDE LIFECYCLE
// ============================================================
export const startRide = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.rideId as string;
        const result = await RideOpsService.startRide(req.user.id, rideId, req.body);
        await invalidateRideCaches(result.rideId);
        return sendSuccess(res, { message: 'Ride started', data: result });
    } catch (error) {
        return handleError(res, error, 'startRide');
    }
};

export const finishRide = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.rideId as string;
        const result = await RideOpsService.finishRide(req.user.id, rideId, req.body);
        await invalidateRideCaches(result.rideId);
        return sendSuccess(res, { message: 'Ride completed', data: result });
    } catch (error) {
        return handleError(res, error, 'finishRide');
    }
};

// ============================================================
//  LIVE LOCATION TRACKING
// ============================================================
export const submitLocation = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.rideId as string;
        const result = await RideOpsService.submitLocation(req.user.id, rideId, req.body);

        // Real-time push to everyone watching this ride's room
        emitToRide(rideId, 'ride:location', result);

        return sendSuccess(res, { message: 'Location recorded', data: result });
    } catch (error) {
        return handleError(res, error, 'submitLocation');
    }
};

export const getLatestLocation = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.rideId as string;
        const result = await RideOpsService.getLatestLocation(rideId);
        if (!result) {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'No location available for this ride yet' });
        }
        return sendSuccess(res, { message: 'Latest location', data: result });
    } catch (error) {
        return handleError(res, error, 'getLatestLocation');
    }
};

// ============================================================
//  BOOKING OPERATIONAL ACTIONS
// ============================================================
export const driverArrived = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.driverArrived(req.user.id, { ...req.body, bookingId });
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Driver marked as arrived', data: result });
    } catch (error) {
        return handleError(res, error, 'driverArrived');
    }
};

export const riderArrivedAtPickup = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.riderArrivedAtPickup(req.user.id, bookingId, req.body);
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Rider arrival recorded', data: result });
    } catch (error) {
        return handleError(res, error, 'riderArrivedAtPickup');
    }
};

export const verifyPickupOtp = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const { otp } = req.body as { otp: string };
        const result = await RideOpsService.verifyPickupAndBoard(req.user.id, bookingId, otp, req.body);
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Pickup verified, passenger onboard', data: result });
    } catch (error) {
        return handleError(res, error, 'verifyPickupOtp');
    }
};

export const markNoShow = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.markNoShow(req.user.id, { ...req.body, bookingId });
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Passenger marked as no-show', data: result });
    } catch (error) {
        return handleError(res, error, 'markNoShow');
    }
};

export const confirmDropoff = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.confirmDropoff(req.user.id, { ...req.body, bookingId });
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Drop-off confirmed by driver', data: result });
    } catch (error) {
        return handleError(res, error, 'confirmDropoff');
    }
};

export const devSimulatePickup = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.devSimulatePickup(req.user.id, bookingId, req.body);
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Dev pickup simulated', data: result });
    } catch (error) {
        return handleError(res, error, 'devSimulatePickup');
    }
};

export const devSimulateDropoff = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.devSimulateDropoff(req.user.id, bookingId, req.body);
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Dev drop-off simulated', data: result });
    } catch (error) {
        return handleError(res, error, 'devSimulateDropoff');
    }
};

export const riderConfirmDropoff = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.riderConfirmDropoff(req.user.id, bookingId, req.body);
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Drop-off confirmed', data: result });
    } catch (error) {
        return handleError(res, error, 'riderConfirmDropoff');
    }
};

export const reportMissedPickup = async (req: AuthRequest, res: Response) => {
    try {
        const bookingId = req.params.id as string;
        const result = await RideOpsService.reportMissedPickup(req.user.id, bookingId, req.body);
        await invalidateBookingRideCaches(result.bookingId, result.rideId);
        return sendSuccess(res, { message: 'Missed pickup reported', data: result });
    } catch (error) {
        return handleError(res, error, 'reportMissedPickup');
    }
};

// ============================================================
//  OFFLINE SYNC
// ============================================================
export const offlineSync = async (req: AuthRequest, res: Response) => {
    try {
        const result = await RideOpsService.syncOfflineActions(req.user.id, req.body.actions);
        return sendSuccess(res, { message: 'Offline actions synced', data: result });
    } catch (error) {
        return handleError(res, error, 'offlineSync');
    }
};
