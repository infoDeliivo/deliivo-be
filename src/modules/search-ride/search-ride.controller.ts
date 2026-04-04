import { Request, Response } from 'express';
import * as SearchRideService from './search-ride.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { getCache, setCache } from '../../services/cache.service.js';
import { SearchRideQuery, EnhancedSearchRideQuery } from './search-ride.types.js';

// Cache key helpers
const cacheKeys = {
    searchResults: (query: SearchRideQuery, viewerId?: string) =>
        `search:v2:${query.originLat}:${query.originLng}:${query.destinationLat}:${query.destinationLng}:${query.departureDate}:${viewerId || 'anon'}`,
    rideDetails: (id: string, segmentId?: string) =>
        `ride:details:${id}:${segmentId || 'full'}:v2`,
};

// Cache TTL in seconds
const CACHE_TTL = 60; // 1 minute for search results

/* ================= SEARCH RIDES ================= */
export const searchRides = async (req: AuthRequest, res: Response) => {
    try {
        const query = req.query as unknown as SearchRideQuery;
        const viewerId = req.user?.id;

        // Parse departureDate if it's a string
        if (typeof query.departureDate === 'string') {
            query.departureDate = new Date(query.departureDate);
        }

        // Generate cache key
        const cacheKey = cacheKeys.searchResults(query, viewerId);

        // Try cache first for identical searches
        const cachedResult = await getCache(cacheKey);
        if (cachedResult) {
            return sendSuccess(res, {
                message: 'Rides fetched successfully',
                data: cachedResult,
            });
        }

        const result = await SearchRideService.searchRides(query, viewerId);

        // Cache the result
        await setCache(cacheKey, result, CACHE_TTL);

        return sendSuccess(res, {
            message: 'Rides fetched successfully',
            data: result,
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: error.message || 'Failed to search rides',
        });
    }
};

/* ================= GET RIDE DETAILS ================= */
export const getRideDetails = async (req: Request, res: Response) => {
    try {
        const rideId = req.params.id as string;
        const query = req.query as { segmentId?: string };
        const segmentId = query.segmentId;
        const cacheKey = cacheKeys.rideDetails(rideId, segmentId);

        // Try cache first
        const cachedRide = await getCache(cacheKey);
        if (cachedRide) {
            return sendSuccess(res, {
                message: 'Ride details fetched successfully',
                data: cachedRide,
            });
        }

        const ride = segmentId
            ? await SearchRideService.getRideSegmentById(segmentId)
            : await SearchRideService.getRideDetails(rideId);

        if (!ride) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Ride not found or not available',
            });
        }

        if (ride.id !== rideId) {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Invalid segment selection for ride',
            });
        }

        // Cache the result
        await setCache(cacheKey, ride);

        return sendSuccess(res, {
            message: 'Ride details fetched successfully',
            data: ride,
        });
    } catch (error: any) {
        if (error.message === 'INVALID_SEGMENT_ID') {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Invalid segment selection for ride',
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: error.message || 'Failed to fetch ride details',
        });
    }
};

/* ================= GET RIDE VIEW DETAILS BY TOKEN ================= */
export const getRideViewByToken = async (req: Request, res: Response) => {
    try {
        const viewToken = req.params.viewToken as string;
        const ride = await SearchRideService.getRideViewByToken(viewToken);

        if (!ride) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Ride not found or not available',
            });
        }

        return sendSuccess(res, {
            message: 'Ride details fetched successfully',
            data: ride,
        });
    } catch (error: any) {
        const status = error.message === 'INVALID_VIEW_TOKEN'
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.INTERNAL_ERROR;

        return sendError(res, {
            status,
            message: status === HttpStatus.BAD_REQUEST
                ? 'Invalid ride view token'
                : 'Failed to fetch ride details',
        });
    }
};

/* ================= GET RIDE SEGMENT DETAILS BY ID ================= */
export const getRideSegmentById = async (req: Request, res: Response) => {
    try {
        const segmentId = req.params.segmentId as string;
        const ride = await SearchRideService.getRideSegmentById(segmentId);

        if (!ride) {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Ride not found or not available',
            });
        }

        return sendSuccess(res, {
            message: 'Ride details fetched successfully',
            data: ride,
        });
    } catch (error: any) {
        const status = error.message === 'INVALID_SEGMENT_ID'
            ? HttpStatus.BAD_REQUEST
            : HttpStatus.INTERNAL_ERROR;

        return sendError(res, {
            status,
            message: status === HttpStatus.BAD_REQUEST
                ? 'Invalid ride segment id'
                : 'Failed to fetch ride details',
        });
    }
};

/* ================= GET RECENT SEARCHES ================= */
export const getRecentSearches = async (req: AuthRequest, res: Response) => {
    try {
        return sendSuccess(res, {
            message: 'Recent searches fetched successfully',
            data: [],
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch recent searches',
        });
    }
};

/* ================= CREATE RIDE ALERT ================= */
export const createRideAlert = async (req: AuthRequest, res: Response) => {
    try {
        const { originLat, originLng, destinationLat, destinationLng, departureDate, radiusKm } =
            req.body;

        const result = await SearchRideService.createRideAlert(
            req.user.id,
            originLat,
            originLng,
            destinationLat,
            destinationLng,
            departureDate,
            radiusKm || 5
        );

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: result.message,
            data: result,
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: error.message || 'Failed to create ride alert',
        });
    }
};

/* ================= ADVANCED SEARCH RIDES (4-CONDITION) ================= */
const advancedCacheKey = (query: EnhancedSearchRideQuery) =>
    `search:advanced:v2:${query.originLat}:${query.originLng}:${query.destinationLat}:${query.destinationLng}:${query.departureDate}:${query.radiusKm || 5}:${query.minSimilarity || 0.75}`;

export const searchRidesAdvanced = async (req: AuthRequest, res: Response) => {
    try {
        const query = req.query as unknown as EnhancedSearchRideQuery;
        const viewerId = req.user?.id;

        // Parse departureDate if it's a string
        if (typeof query.departureDate === 'string') {
            query.departureDate = new Date(query.departureDate);
        }

        // Generate cache key
        const cacheKey = `${advancedCacheKey(query)}:${viewerId || 'anon'}`;

        // Try cache first
        const cachedResult = await getCache(cacheKey);
        if (cachedResult) {
            return sendSuccess(res, {
                message: 'Rides fetched successfully (cached)',
                data: cachedResult,
            });
        }

        const result = await SearchRideService.searchRidesAdvanced(query, viewerId);

        // Cache the result for 60 seconds
        await setCache(cacheKey, result, CACHE_TTL);

        return sendSuccess(res, {
            message: 'Rides fetched successfully',
            data: result,
        });
    } catch (error: any) {
        console.error('Advanced search error:', error);
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: error.message || 'Failed to search rides',
        });
    }
};
