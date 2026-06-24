import { Response } from 'express';
import * as DraftRideService from './draft-ride.service.js';
import { formatDraftResponse } from './draft-ride.service.js';
import * as PublishRideService from './publish-ride.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { getCache, setCache, deleteCache } from '../../services/cache.service.js';
import { getCurrentFuelPrice, refreshFuelPrice as refreshFuelPriceSvc } from '../../services/fuel-price.service.js';
import { logError } from '../../utils/logger.js';

// Cache key helpers (for published rides only)
const cacheKeys = {
    ride: (id: string) => `ride:${id}`,
    userRides: (userId: string) => `user:${userId}:rides`,
};

/* ============================================================
   STEP-BY-STEP WIZARD FLOW — ALL DRAFT STEPS USE REDIS
   ============================================================ */

/* ================= STEP 1: CREATE WITH ORIGIN ================= */
export const createWithOrigin = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.createWithOrigin(req.user.id, req.body);

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Draft ride created with origin',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: error.message || 'Failed to create draft',
        });
    }
};

/* ================= STEP 2-3: UPDATE PICKUPS ================= */
export const updatePickups = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updatePickups(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Pickup locations updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to update pickup locations';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'MAX_PICKUP_POINTS_EXCEEDED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Maximum 3 pickup points allowed';
        }

        return sendError(res, {
            status,
            message,
        });
    }
};

/* ================= STEP 4: UPDATE DESTINATION ================= */
export const updateDestination = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updateDestination(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Destination updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        const status = error.message === 'DRAFT_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'DRAFT_NOT_FOUND'
                ? 'Draft not found'
                : 'Failed to update destination',
        });
    }
};

/* ================= STEP 5-6: UPDATE DROPOFFS ================= */
export const updateDropoffs = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updateDropoffs(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Dropoff locations updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to update dropoff locations';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'MAX_DROPOFF_POINTS_EXCEEDED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Maximum 3 dropoff points allowed';
        }

        return sendError(res, {
            status,
            message,
        });
    }
};

/* ================= STEP 7: COMPUTE ROUTES ================= */
export const computeRoutes = async (req: AuthRequest, res: Response) => {
    try {
        const includeAlternatives = req.query.includeAlternatives !== 'false';

        const result = await DraftRideService.computeRouteOptions(
            req.user.id,
            includeAlternatives
        );

        return sendSuccess(res, {
            message: 'Routes computed successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to compute routes';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'ORIGIN_AND_DESTINATION_REQUIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Origin and destination are required before computing routes';
        } else if (error.message === 'NO_ROUTES_FOUND') {
            status = HttpStatus.BAD_REQUEST;
            message = 'No routes found between origin and destination';
        }

        return sendError(res, { status, message });
    }
};

/* ================= STEP 7b: SELECT ROUTE ================= */
export const selectRoute = async (req: AuthRequest, res: Response) => {
    try {
        const { routeIndex } = req.body;

        const draft = await DraftRideService.selectRoute(req.user.id, routeIndex);

        return sendSuccess(res, {
            message: 'Route selected successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to select route';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'ROUTES_EXPIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Routes expired. Please compute routes again.';
        } else if (error.message === 'INVALID_ROUTE_INDEX') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Invalid route selection';
        }

        return sendError(res, { status, message });
    }
};

/* ================= STEP 5: GET STOPPER POINT SUGGESTIONS ================= */
export const getStopoverSuggestions = async (req: AuthRequest, res: Response) => {
    try {
        const result = await DraftRideService.getStopoversAlongRoute(req.user.id);

        return sendSuccess(res, {
            message: 'Stopper point suggestions fetched successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to get stopper point suggestions';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'ROUTE_REQUIRED_FOR_SUGGESTIONS') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Please select a route before getting stopper point suggestions';
        } else if (error.message === 'INVALID_POLYLINE') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Invalid route polyline';
        }

        return sendError(res, { status, message });
    }
};

/* ================= STEP 6: UPDATE STOPOVERS ================= */
export const updateStopovers = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updateStopovers(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Stopovers updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to update stopovers';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'MAX_STOPOVER_POINTS_EXCEEDED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Maximum 1 stopover allowed';
        }

        return sendError(res, {
            status,
            message,
        });
    }
};

export const getLocationSuggestions = async (req: AuthRequest, res: Response) => {
    try {
        const result = await DraftRideService.getRouteLocationSuggestions(req.user.id);

        return sendSuccess(res, {
            message: 'Route location suggestions fetched successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to get route location suggestions';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'ROUTE_REQUIRED_FOR_SUGGESTIONS') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Please select a route before getting route location suggestions';
        } else if (error.message === 'INVALID_POLYLINE') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Invalid route polyline';
        }

        return sendError(res, { status, message });
    }
};

/* ================= STEP 9: UPDATE SCHEDULE ================= */
export const updateSchedule = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updateSchedule(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Schedule updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        const status = error.message === 'DRAFT_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'DRAFT_NOT_FOUND'
                ? 'Draft not found'
                : 'Failed to update schedule',
        });
    }
};

/* ================= STEP 10: UPDATE CAPACITY ================= */
export const updateCapacity = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updateCapacity(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Capacity updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        const status = error.message === 'DRAFT_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'DRAFT_NOT_FOUND'
                ? 'Draft not found'
                : 'Failed to update capacity',
        });
    }
};

/* ================= STEP 11: GET RECOMMENDED PRICE ================= */
export const getRecommendedPrice = async (req: AuthRequest, res: Response) => {
    try {
        const recommendation = await DraftRideService.getRecommendedPrice(req.user.id);

        return sendSuccess(res, {
            message: 'Price recommendation calculated',
            data: recommendation,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to calculate price recommendation';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'ROUTE_REQUIRED_FOR_PRICING') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Please select a route before getting price recommendations';
        }

        return sendError(res, { status, message });
    }
};

/* ================= STEP 12: UPDATE PRICING ================= */
export const updatePricing = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updatePricing(req.user.id, req.body);

        return sendSuccess(res, {
            message: 'Pricing updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        const status = error.message === 'DRAFT_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'DRAFT_NOT_FOUND'
                ? 'Draft not found'
                : 'Failed to update pricing',
        });
    }
};

/* ================= STEP 13: UPDATE NOTES ================= */
export const updateNotes = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.updateNotes(req.user.id, req.body.notes, req.body.femaleOnly);

        return sendSuccess(res, {
            message: 'Notes updated successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to update notes';
        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'FEMALE_ONLY_NOT_ALLOWED') {
            status = HttpStatus.FORBIDDEN;
            message = 'Only female drivers can publish female-only rides';
        }
        return sendError(res, { status, message });
    }
};

/* ================= STEP 14: PUBLISH RIDE (Redis → DB) ================= */
export const publishRide = async (req: AuthRequest, res: Response) => {
    try {
        const ride = await DraftRideService.publishRide(req.user.id);

        // Invalidate user rides cache (published rides cache)
        await deleteCache(cacheKeys.userRides(req.user.id));

        return sendSuccess(res, {
            message: 'Ride published successfully',
            data: ride,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to publish ride';

        if (error.message === 'DRAFT_NOT_FOUND') {
            status = HttpStatus.NOT_FOUND;
            message = 'Draft not found';
        } else if (error.message === 'ORIGIN_AND_DESTINATION_REQUIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Origin and destination are required';
        } else if (error.message === 'ROUTE_REQUIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Route is required before publishing';
        } else if (error.message === 'SCHEDULE_REQUIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Schedule is required before publishing';
        } else if (error.message === 'CAPACITY_AND_PRICING_REQUIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Seats and pricing are required before publishing';
        } else if (error.message === 'FEMALE_ONLY_NOT_ALLOWED') {
            status = HttpStatus.FORBIDDEN;
            message = 'Only female drivers can publish female-only rides';
        } else if (error.message === 'NON_ROAD_ROUTE_NOT_ALLOWED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'Routes that include ferry or water transport cannot be published';
        } else if (error.message === 'TOS_NOT_ACCEPTED') {
            status = HttpStatus.FORBIDDEN;
            message = 'You must accept the Terms of Service before publishing a ride';
        } else if (error.message === 'DRIVER_NOT_VERIFIED') {
            status = HttpStatus.FORBIDDEN;
            message = 'Your driving licence must be verified before publishing a ride';
        } else if (error.message === 'VEHICLE_REQUIRED') {
            status = HttpStatus.BAD_REQUEST;
            message = 'A vehicle is required before publishing a ride';
        } else if (error.message === 'VEHICLE_NOT_VERIFIED') {
            status = HttpStatus.FORBIDDEN;
            message = 'Your vehicle must be verified before publishing a ride';
        }

        return sendError(res, { status, message });
    }
};

/* ============================================================
   DRAFT MANAGEMENT — REDIS
   ============================================================ */

/* ================= LIST DRAFTS ================= */
export const listDrafts = async (req: AuthRequest, res: Response) => {
    try {
        const result = await DraftRideService.getUserDraft(req.user.id);

        return sendSuccess(res, {
            message: 'Draft fetched successfully',
            data: formatDraftResponse(result),
        });
    } catch (error: any) {
        if (error.message === 'DRAFT_NOT_FOUND') {
            return sendSuccess(res, {
                message: 'No active draft',
                data: null,
            });
        }
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch draft',
        });
    }
};

/* ================= GET DRAFT ================= */
export const getDraftById = async (req: AuthRequest, res: Response) => {
    try {
        const draft = await DraftRideService.getUserDraft(req.user.id);

        return sendSuccess(res, {
            message: 'Draft fetched successfully',
            data: formatDraftResponse(draft),
        });
    } catch (error: any) {
        const status = error.message === 'DRAFT_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'DRAFT_NOT_FOUND'
                ? 'Draft not found'
                : 'Failed to fetch draft',
        });
    }
};

/* ================= DELETE DRAFT ================= */
export const deleteDraft = async (req: AuthRequest, res: Response) => {
    try {
        await DraftRideService.deleteDraft(req.user.id);

        return sendSuccess(res, {
            message: 'Draft deleted successfully',
        });
    } catch (error: any) {
        const status = error.message === 'DRAFT_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'DRAFT_NOT_FOUND'
                ? 'Draft not found'
                : 'Failed to delete draft',
        });
    }
};

/* ============================================================
   PUBLISHED RIDE OPERATIONS — DB (unchanged)
   ============================================================ */

/* ================= GET USER RIDES ================= */
export const getUserRides = async (req: AuthRequest, res: Response) => {
    try {
        const result = await PublishRideService.getUserRides(req.user.id, req.query as any);

        return sendSuccess(res, {
            message: 'Rides fetched successfully',
            data: result,
        });
    } catch (error: any) {
        logError('Publish ride error', error);

        return sendError(res, {
            status: error.message === 'RIDE_NOT_FOUND'
                ? HttpStatus.NOT_FOUND
                : HttpStatus.INTERNAL_ERROR,
            message: error.message === 'RIDE_NOT_FOUND'
                ? 'Ride not found'
                : 'Failed to fetch rides',
        });
    }
};

/* ================= GET RIDE BY ID ================= */
export const getRideById = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.id as string;
        const ride = await PublishRideService.getRideById(req.user.id, rideId);

        return sendSuccess(res, {
            message: 'Ride fetched successfully',
            data: ride,
        });
    } catch (error: any) {
        const status = error.message === 'RIDE_NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'RIDE_NOT_FOUND'
                ? 'Ride not found'
                : 'Failed to fetch ride',
        });
    }
};

/* ================= CANCEL RIDE ================= */
export const cancelRide = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.id as string;
        await PublishRideService.cancelRide(req.user.id, rideId);

        // Invalidate caches
        await deleteCache(cacheKeys.ride(rideId));
        await deleteCache(cacheKeys.userRides(req.user.id));

        return sendSuccess(res, {
            message: 'Ride cancelled successfully',
        });
    } catch (error: any) {
        const status = error.message === 'RIDE_NOT_FOUND_OR_CANNOT_CANCEL'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'RIDE_NOT_FOUND_OR_CANNOT_CANCEL'
                ? 'Ride not found or cannot be cancelled'
                : 'Failed to cancel ride',
        });
    }
};

/* ================= START RIDE ================= */
export const startRide = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.id as string;
        await PublishRideService.startRide(req.user.id, rideId);

        await deleteCache(cacheKeys.ride(rideId));
        await deleteCache(cacheKeys.userRides(req.user.id));

        return sendSuccess(res, { message: 'Ride started successfully' });
    } catch (error: any) {
        const status = error.message === 'RIDE_NOT_FOUND_OR_CANNOT_START'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'RIDE_NOT_FOUND_OR_CANNOT_START'
                ? 'Ride not found or cannot be started'
                : 'Failed to start ride',
        });
    }
};

/* ================= COMPLETE RIDE ================= */
export const completeRide = async (req: AuthRequest, res: Response) => {
    try {
        const rideId = req.params.id as string;
        await PublishRideService.completeRide(req.user.id, rideId);

        await deleteCache(cacheKeys.ride(rideId));
        await deleteCache(cacheKeys.userRides(req.user.id));

        return sendSuccess(res, { message: 'Ride completed successfully' });
    } catch (error: any) {
        const status = error.message === 'RIDE_NOT_FOUND_OR_CANNOT_COMPLETE'
            ? HttpStatus.NOT_FOUND
            : HttpStatus.INTERNAL_ERROR;
        return sendError(res, {
            status,
            message: error.message === 'RIDE_NOT_FOUND_OR_CANNOT_COMPLETE'
                ? 'Ride not found or cannot be completed'
                : 'Failed to complete ride',
        });
    }
};

/* ============================================================
   FUEL PRICE — DEBUG & REFRESH
   ============================================================ */

/* ================= GET CURRENT FUEL PRICE ================= */
export const getFuelPrice = async (req: AuthRequest, res: Response) => {
    try {
        const currency = (req.query.currency as string) || 'EUR';
        const fuelPrice = await getCurrentFuelPrice(currency);

        return sendSuccess(res, {
            message: 'Current fuel price fetched successfully',
            data: {
                countryCode: fuelPrice.countryCode,
                currency: fuelPrice.currency,
                fuelType: fuelPrice.fuelType,
                pricePerLiter: fuelPrice.pricePerLiter,
                effectiveDate: fuelPrice.effectiveDate,
                source: fuelPrice.sourceLabel,
                isFallback: fuelPrice.isFallback,
                isCached: fuelPrice.isCached,
            },
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch fuel price',
        });
    }
};

/* ================= REFRESH FUEL PRICE ================= */
export const refreshFuelPrice = async (req: AuthRequest, res: Response) => {
    try {
        const result = await refreshFuelPriceSvc('GB');

        return sendSuccess(res, {
            message: 'UK fuel price refreshed successfully',
            data: {
                countryCode: result.countryCode,
                currency: result.currency,
                fuelType: result.fuelType,
                pricePerLiter: result.pricePerLiter,
                effectiveDate: result.effectiveDate,
                source: result.sourceLabel,
            },
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to refresh fuel price from GOV.UK',
        });
    }
};

