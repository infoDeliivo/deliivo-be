import redis from '../../cache/redis.js';
import { prisma } from '../../config/index.js';
import { RideStatus } from '@prisma/client';
import {
    CreateOriginInput,
    UpdateDestinationInput,
    UpdateScheduleInput,
    UpdateCapacityInput,
    UpdatePickupsInput,
    UpdateDropoffsInput,
    UpdateStopoversInput,
    UpdateRouteInput,
    UpdatePricingInput,
    RouteOption,
    ComputeRoutesResult,
    PriceRecommendation,
    DraftSummary,
    ListDraftsQuery,
    LocationInput,
    StopoverSuggestion,
    StopoverSuggestionsResult,
} from './publish-ride.types.js';
import { getFuelPriceForCurrency } from '../../services/fuel-price.service.js';
import { buildStopoverPricingByPlaceId, getStopoverPriceByPlaceId } from './stopover-pricing.utils.js';
import { calculateWaypointArrivalTimes } from './waypoint-time.utils.js';

// ============================================================
//  CONSTANTS
// ============================================================

const DRAFT_TTL = 3600; // 10 minutes
const ROUTES_TTL = 300;  // 5 minutes for computed routes

// ============================================================
//  CACHE KEY HELPERS
// ============================================================

const draftKey = (userId: string) => `rideDraft:${userId}`;
const routesCacheKey = (userId: string) => `rideDraft:routes:${userId}`;

// ============================================================
//  DRAFT RESPONSE HELPER (strip id/driverId/step, add next)
// ============================================================

const NEXT_STEP: Record<number, string> = {
    1: 'destination',
    4: 'compute-routes',
    7: 'stopovers',
    8: 'schedule',
    9: 'capacity',
    10: 'pricing',
    12: 'notes',
    13: 'publish',
};

export const formatDraftResponse = (draft: DraftRide) => {
    const { userId, step, ...rest } = draft;
    return {
        ...rest,
        next: NEXT_STEP[step] || null,
    };
};

// ============================================================
//  INTERNAL: READ / WRITE DRAFT
// ============================================================

interface DraftRide {
    userId: string;
    step: number;
    createdAt: string;
    updatedAt: string;

    // Origin (Step 1)
    originPlaceId?: string;
    originAddress?: string;
    originLat?: number;
    originLng?: number;

    // Pickups (Step 1)
    pickups?: LocationInput[];

    // Destination (Step 2)
    destinationPlaceId?: string;
    destinationAddress?: string;
    destinationLat?: number;
    destinationLng?: number;

    // Dropoffs (Step 5-6)
    dropoffs?: LocationInput[];

    // Route (Step 7)
    routePolyline?: string;
    routeDistanceMeters?: number;
    routeDurationSeconds?: number;

    // Stopovers (Step 8)
    stopovers?: LocationInput[];

    // Schedule (Step 9)
    departureDate?: string;
    departureTime?: string;

    // Capacity (Step 10)
    totalSeats?: number;
    basePricePerSeat?: number;
    currency?: string;
    vehicleId?: string | null;
    maxLuggagePerPerson?: number;
    backSeatOnly?: boolean;
    stopoverPricingByPlaceId?: Record<string, number>;

    // Notes (Step 13)
    notes?: string;
}

/**
 * Get a draft from Redis. Throws if not found.
 */
const getDraft = async (userId: string): Promise<DraftRide> => {
    const key = draftKey(userId);
    const data = await redis.get(key);
    if (!data) {
        throw new Error('DRAFT_NOT_FOUND');
    }
    return JSON.parse(data) as DraftRide;
};

/**
 * Save (create/update) a draft to Redis with TTL refresh.
 */
const saveDraft = async (draft: DraftRide): Promise<DraftRide> => {
    const key = draftKey(draft.userId);
    draft.updatedAt = new Date().toISOString();
    await redis.setex(key, DRAFT_TTL, JSON.stringify(draft));
    return draft;
};

// ============================================================
//  STEP 1: CREATE WITH ORIGIN + PICKUP
// ============================================================

export const createWithOrigin = async (driverId: string, input: CreateOriginInput): Promise<DraftRide> => {
    // Delete any existing draft for this user
    await redis.del(draftKey(driverId));
    await redis.del(routesCacheKey(driverId));

    const draft: DraftRide = {
        userId: driverId,
        step: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        originPlaceId: input.originPlaceId,
        originAddress: input.originAddress,
        originLat: input.originLat,
        originLng: input.originLng,
        pickups: input.pickup ? [input.pickup] : undefined,
    };

    return saveDraft(draft);
};

// ============================================================
//  STEP 2-3: UPDATE PICKUPS
// ============================================================

export const updatePickups = async (
    driverId: string,
    input: UpdatePickupsInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.pickups = input.pickups;
    draft.step = Math.max(draft.step, 2);
    return saveDraft(draft);
};

// ============================================================
//  STEP 2: UPDATE DESTINATION + DROPOFF
// ============================================================

export const updateDestination = async (
    driverId: string,
    input: UpdateDestinationInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.destinationPlaceId = input.destinationPlaceId;
    draft.destinationAddress = input.destinationAddress;
    draft.destinationLat = input.destinationLat;
    draft.destinationLng = input.destinationLng;
    if (input.dropoff) {
        draft.dropoffs = [input.dropoff];
    }
    draft.step = Math.max(draft.step, 2);
    return saveDraft(draft);
};

// ============================================================
//  STEP 5-6: UPDATE DROPOFFS
// ============================================================

export const updateDropoffs = async (
    driverId: string,
    input: UpdateDropoffsInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.dropoffs = input.dropoffs;
    draft.step = Math.max(draft.step, 5);
    return saveDraft(draft);
};

// ============================================================
//  STEP 7: COMPUTE ROUTE OPTIONS
// ============================================================

export const computeRouteOptions = async (
    driverId: string,
    includeAlternatives: boolean = true
): Promise<ComputeRoutesResult> => {
    const draft = await getDraft(driverId);

    if (!draft.originLat || !draft.destinationLat) {
        throw new Error('ORIGIN_AND_DESTINATION_REQUIRED');
    }

    // Build origin and destination
    const origin = { latitude: draft.originLat, longitude: draft.originLng };
    const destination = { latitude: draft.destinationLat, longitude: draft.destinationLng };

    // Build intermediate waypoints from stopovers
    const intermediateWaypoints = (draft.stopovers || [])
        .map(wp => ({ latitude: wp.lat, longitude: wp.lng }));

    // Call Google Routes API
    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY || '',
            'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify({
            origin: { location: { latLng: origin } },
            destination: { location: { latLng: destination } },
            intermediates: intermediateWaypoints.map(wp => ({ location: { latLng: wp } })),
            travelMode: 'DRIVE',
            computeAlternativeRoutes: includeAlternatives,
        }),
    });

    const data = await response.json();

    if (!data.routes || data.routes.length === 0) {
        throw new Error('NO_ROUTES_FOUND');
    }

    // Format route options
    const routes: RouteOption[] = data.routes.map((route: any, index: number) => {
        const distanceMeters = route.distanceMeters || 0;
        const durationSeconds = parseInt(route.duration?.replace('s', '') || '0');

        return {
            index,
            polyline: route.polyline?.encodedPolyline || '',
            distanceMeters,
            durationSeconds,
            distanceText: `${(distanceMeters / 1000).toFixed(1)} km`,
            durationText: formatDuration(durationSeconds),
        };
    });

    // Cache computed routes for selection (5 min)
    await redis.setex(routesCacheKey(driverId), ROUTES_TTL, JSON.stringify(routes));

    return {
        routes,
        selectedIndex: draft.routePolyline ? 0 : null,
    };
};

// ============================================================
//  STEP 7b: SELECT ROUTE
// ============================================================

export const selectRoute = async (
    driverId: string,
    routeIndex: number
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);

    // Get cached routes
    const cachedData = await redis.get(routesCacheKey(driverId));
    if (!cachedData) {
        throw new Error('ROUTES_EXPIRED');
    }

    const routes: RouteOption[] = JSON.parse(cachedData);

    if (routeIndex < 0 || routeIndex >= routes.length) {
        throw new Error('INVALID_ROUTE_INDEX');
    }

    const selectedRoute = routes[routeIndex];
    draft.routePolyline = selectedRoute.polyline;
    draft.routeDistanceMeters = selectedRoute.distanceMeters;
    draft.routeDurationSeconds = selectedRoute.durationSeconds;
    draft.step = Math.max(draft.step, 7);

    return saveDraft(draft);
};

// ============================================================
//  STEP 5: GET STOPPER POINT SUGGESTIONS ALONG ROUTE
// ============================================================

/**
 * Decode a Google-encoded polyline string into an array of {lat, lng} points.
 */
function decodePolyline(encoded: string): { lat: number; lng: number }[] {
    const points: { lat: number; lng: number }[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
        let shift = 0;
        let result = 0;
        let byte: number;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const dlat = result & 1 ? ~(result >> 1) : result >> 1;
        lat += dlat;

        shift = 0;
        result = 0;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const dlng = result & 1 ? ~(result >> 1) : result >> 1;
        lng += dlng;

        points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }

    return points;
}

/**
 * Calculate distance in meters between two lat/lng points using Haversine formula.
 */
function haversineDistance(
    p1: { lat: number; lng: number },
    p2: { lat: number; lng: number }
): number {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg: number) => (deg * Math.PI) / 180;

    const dLat = toRad(p2.lat - p1.lat);
    const dLng = toRad(p2.lng - p1.lng);

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * Math.sin(dLng / 2) ** 2;

    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Sample points along a decoded polyline at regular intervals.
 */
function samplePointsAlongRoute(
    points: { lat: number; lng: number }[],
    intervalMeters: number = 30000 // every ~30km
): { lat: number; lng: number; distanceFromOrigin: number }[] {
    if (points.length < 2) return [];

    const sampled: { lat: number; lng: number; distanceFromOrigin: number }[] = [];
    let totalDistance = 0;
    let nextSampleAt = intervalMeters;

    // Skip first and last points (origin/destination)
    for (let i = 1; i < points.length; i++) {
        const segmentDist = haversineDistance(points[i - 1], points[i]);
        totalDistance += segmentDist;

        if (totalDistance >= nextSampleAt) {
            sampled.push({
                lat: points[i].lat,
                lng: points[i].lng,
                distanceFromOrigin: totalDistance,
            });
            nextSampleAt += intervalMeters;
        }
    }

    return sampled;
}

/**
 * Get stopper point suggestions — famous cities/places along the selected route.
 * Decodes polyline → samples points every ~30km → queries Google Places Nearby Search.
 */
export const getStopoversAlongRoute = async (
    driverId: string,
): Promise<StopoverSuggestionsResult> => {
    const draft = await getDraft(driverId);

    if (!draft.routePolyline) {
        throw new Error('ROUTE_REQUIRED_FOR_SUGGESTIONS');
    }

    // 1. Decode the polyline
    const decodedPoints = decodePolyline(draft.routePolyline);
    if (decodedPoints.length < 2) {
        throw new Error('INVALID_POLYLINE');
    }

    // 2. Sample points along the route (every ~30km)
    const sampledPoints = samplePointsAlongRoute(decodedPoints, 30000);

    if (sampledPoints.length === 0) {
        // Route is too short for stopovers
        return {
            suggestions: [],
            routeDistanceKm: (draft.routeDistanceMeters || 0) / 1000,
            basePricePerSeat: draft.basePricePerSeat || null,
        };
    }

    // 3. Query Google Places Nearby Search for each sampled point
    const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
    const allSuggestions: StopoverSuggestion[] = [];
    const seenPlaceIds = new Set<string>();

    // Limit to max 5 sample points to avoid excessive API calls
    const pointsToQuery = sampledPoints.slice(0, 5);

    for (const point of pointsToQuery) {
        try {
            const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
            url.searchParams.set('location', `${point.lat},${point.lng}`);
            url.searchParams.set('radius', '15000'); // 15km radius
            url.searchParams.set('type', 'locality');  // cities/towns
            url.searchParams.set('key', GOOGLE_API_KEY);

            const response = await fetch(url.toString());
            const data = await response.json() as any;

            if (data.results && Array.isArray(data.results)) {
                for (const place of data.results.slice(0, 3)) { // max 3 per sample
                    if (seenPlaceIds.has(place.place_id)) continue;
                    seenPlaceIds.add(place.place_id);

                    const distFromOrigin = haversineDistance(
                        { lat: draft.originLat!, lng: draft.originLng! },
                        { lat: place.geometry.location.lat, lng: place.geometry.location.lng }
                    );

                    allSuggestions.push({
                        placeId: place.place_id,
                        name: place.name,
                        address: place.vicinity || place.name,
                        lat: place.geometry.location.lat,
                        lng: place.geometry.location.lng,
                        distanceFromOriginKm: Math.round((distFromOrigin / 1000) * 10) / 10,
                        distanceFromOriginMeters: Math.round(distFromOrigin),
                        types: place.types || [],
                    });
                }
            }
        } catch (err) {
            // Skip failed queries silently, continue with other points
            console.error('Places API error for point:', point, err);
        }
    }

    // 4. Sort by distance from origin
    allSuggestions.sort((a, b) => a.distanceFromOriginMeters - b.distanceFromOriginMeters);

    // 5. Auto-calculate per-stopper pricing if base price exists
    const totalDistanceKm = (draft.routeDistanceMeters || 0) / 1000;
    if (draft.basePricePerSeat && totalDistanceKm > 0) {
        for (const suggestion of allSuggestions) {
            const distanceRatio = suggestion.distanceFromOriginKm / totalDistanceKm;
            suggestion.pricePerSeat = Math.round(draft.basePricePerSeat * distanceRatio * 100) / 100;
        }
    }

    return {
        suggestions: allSuggestions,
        routeDistanceKm: Math.round(totalDistanceKm * 10) / 10,
        basePricePerSeat: draft.basePricePerSeat || null,
    };
};

// ============================================================
//  STEP 6: UPDATE STOPOVERS
// ============================================================

export const updateStopovers = async (
    driverId: string,
    input: UpdateStopoversInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.stopovers = input.stopovers;
    draft.step = Math.max(draft.step, 8);
    return saveDraft(draft);
};

// ============================================================
//  STEP 9: UPDATE SCHEDULE
// ============================================================

export const updateSchedule = async (
    driverId: string,
    input: UpdateScheduleInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.departureDate = new Date(input.departureDate).toISOString();
    draft.departureTime = input.departureTime;
    draft.step = Math.max(draft.step, 9);
    return saveDraft(draft);
};

// ============================================================
//  STEP 10: UPDATE CAPACITY
// ============================================================

export const updateCapacity = async (
    driverId: string,
    input: UpdateCapacityInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);

    // Auto-fetch user's vehicle
    const vehicle = await prisma.vehicle.findFirst({
        where: { userId: driverId, deletedAt: null },
    });

    draft.totalSeats = input.totalSeats;
    draft.vehicleId = vehicle?.id || null;
    draft.maxLuggagePerPerson = input.maxLuggagePerPerson ?? 2;
    draft.backSeatOnly = input.backSeatOnly ?? false;
    draft.step = Math.max(draft.step, 10);

    return saveDraft(draft);
};

// ============================================================
//  STEP 11: GET RECOMMENDED PRICE
// ============================================================

const DEFAULT_FUEL_EFFICIENCY_KM_PER_LITER = Number(process.env.FUEL_EFFICIENCY_KM_PER_LITER || 12);

export const getRecommendedPrice = async (
    driverId: string,
): Promise<PriceRecommendation & { stopoverPricing?: { placeId: string; address: string; distanceFromOriginKm: number; recommendedPrice: number }[] }> => {
    const draft = await getDraft(driverId);

    if (!draft.routeDistanceMeters) {
        throw new Error('ROUTE_REQUIRED_FOR_PRICING');
    }

    const fuelContext = await getFuelPriceForCurrency(draft.currency || 'GBP');
    const fuelEfficiency = DEFAULT_FUEL_EFFICIENCY_KM_PER_LITER > 0
        ? DEFAULT_FUEL_EFFICIENCY_KM_PER_LITER
        : 12;
    const pricePerKm = fuelContext.pricePerLiter / fuelEfficiency;

    const distanceKm = draft.routeDistanceMeters / 1000;
    const fuelCost = distanceKm * pricePerKm;

    const minPrice = Math.round(fuelCost * 0.8);
    const recommendedPrice = Math.round(fuelCost * 1.5);
    const maxPrice = Math.round(fuelCost * 2.5);

    // Calculate per-stopper pricing if stopovers exist
    let stopoverPricing: { placeId: string; address: string; distanceFromOriginKm: number; recommendedPrice: number }[] | undefined;

    if (draft.stopovers && draft.stopovers.length > 0 && draft.originLat && draft.originLng) {
        stopoverPricing = draft.stopovers.map(stopover => {
            const distFromOrigin = haversineDistance(
                { lat: draft.originLat!, lng: draft.originLng! },
                { lat: stopover.lat, lng: stopover.lng }
            );
            const distFromOriginKm = Math.round((distFromOrigin / 1000) * 10) / 10;
            const ratio = distFromOriginKm / distanceKm;
            const stopPrice = Math.round(recommendedPrice * ratio * 100) / 100;

            return {
                placeId: stopover.placeId,
                address: stopover.address,
                distanceFromOriginKm: distFromOriginKm,
                recommendedPrice: stopPrice,
            };
        });

        // Sort by distance
        stopoverPricing.sort((a, b) => a.distanceFromOriginKm - b.distanceFromOriginKm);
    }

    return {
        recommendedPrice,
        minPrice,
        maxPrice,
        currency: draft.currency || 'GBP',
        breakdown: {
            fuelCost: Math.round(fuelCost * 100) / 100,
            distanceKm: Math.round(distanceKm * 10) / 10,
            pricePerKm: Math.round(pricePerKm * 100) / 100,
            fuelPricePerLiter: Math.round(fuelContext.pricePerLiter * 100) / 100,
            fuelPriceCurrency: fuelContext.currency,
            fuelCountryCode: fuelContext.countryCode,
            fuelSource: fuelContext.sourceLabel,
            fuelPriceEffectiveDate: fuelContext.effectiveDate,
            efficiencyKmPerLiter: Math.round(fuelEfficiency * 100) / 100,
            fuelPriceIsFallback: fuelContext.isFallback,
            fuelPriceIsCached: fuelContext.isCached,
        },
        stopoverPricing,
    };
};

// ============================================================
//  STEP 12: UPDATE PRICING
// ============================================================

export const updatePricing = async (
    driverId: string,
    input: UpdatePricingInput
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.basePricePerSeat = input.basePricePerSeat;
    if (input.stopoverPricing !== undefined) {
        draft.stopoverPricingByPlaceId = buildStopoverPricingByPlaceId(input.stopoverPricing);
    }
    draft.step = Math.max(draft.step, 12);
    return saveDraft(draft);
};

// ============================================================
//  STEP 13: UPDATE NOTES
// ============================================================

export const updateNotes = async (
    driverId: string,
    notes: string
): Promise<DraftRide> => {
    const draft = await getDraft(driverId);
    draft.notes = notes;
    draft.step = Math.max(draft.step, 13);
    return saveDraft(draft);
};

// ============================================================
//  STEP 14: PUBLISH — Move from Redis → DB
// ============================================================

export const publishRide = async (driverId: string) => {
    const draft = await getDraft(driverId);

    // ---- Validation ---- //
    if (!draft.originPlaceId || !draft.destinationPlaceId) {
        throw new Error('ORIGIN_AND_DESTINATION_REQUIRED');
    }
    if (!draft.routePolyline) {
        throw new Error('ROUTE_REQUIRED');
    }
    if (!draft.departureDate || !draft.departureTime) {
        throw new Error('SCHEDULE_REQUIRED');
    }
    if (!draft.totalSeats || !draft.basePricePerSeat) {
        throw new Error('CAPACITY_AND_PRICING_REQUIRED');
    }

    // Validate user has a verified vehicle
    const vehicle = await prisma.vehicle.findFirst({
        where: { userId: driverId, deletedAt: null },
    });

    if (!vehicle) {
        throw new Error('VEHICLE_REQUIRED');
    }
    // if (!vehicle.isVerified) {
    //     throw new Error('VEHICLE_NOT_VERIFIED');
    // }

    // ---- Atomic DB insert ---- //
    const ride = await prisma.$transaction(async (tx) => {
        // Create the ride as PUBLISHED (skip DRAFT entirely in DB)
        const newRide = await tx.ride.create({
            data: {
                driverId,
                vehicleId: vehicle.id,

                originPlaceId: draft.originPlaceId!,
                originAddress: draft.originAddress!,
                originLat: draft.originLat!,
                originLng: draft.originLng!,

                destinationPlaceId: draft.destinationPlaceId!,
                destinationAddress: draft.destinationAddress!,
                destinationLat: draft.destinationLat!,
                destinationLng: draft.destinationLng!,

                routePolyline: draft.routePolyline,
                routeDistanceMeters: draft.routeDistanceMeters,
                routeDurationSeconds: draft.routeDurationSeconds,

                departureDate: new Date(draft.departureDate!),
                departureTime: draft.departureTime!,

                totalSeats: draft.totalSeats!,
                availableSeats: draft.totalSeats!,
                basePricePerSeat: draft.basePricePerSeat!,
                currency: draft.currency || 'GBP',

                maxLuggagePerPerson: draft.maxLuggagePerPerson ?? 2,
                backSeatOnly: draft.backSeatOnly ?? false,

                notes: draft.notes || null,
                status: RideStatus.PUBLISHED,
            },
        });

        // Create pickup waypoints
        const pickups = (draft.pickups || []).map((p, i) => ({
            rideId: newRide.id,
            placeId: p.placeId,
            address: p.address,
            lat: p.lat,
            lng: p.lng,
            waypointType: 'PICKUP' as const,
            orderIndex: i,
        }));

        // Create dropoff waypoints
        const dropoffs = (draft.dropoffs || []).map((d, i) => ({
            rideId: newRide.id,
            placeId: d.placeId,
            address: d.address,
            lat: d.lat,
            lng: d.lng,
            waypointType: 'DROPOFF' as const,
            orderIndex: i + 100,
        }));

        // Create stopover waypoints
        const stopovers = (draft.stopovers || []).map((s, i) => ({
            rideId: newRide.id,
            placeId: s.placeId,
            address: s.address,
            lat: s.lat,
            lng: s.lng,
            waypointType: 'STOPOVER' as const,
            orderIndex: i + 50,
            pricePerSeat: getStopoverPriceByPlaceId(draft.stopoverPricingByPlaceId, s.placeId),
        }));

        // Sort all waypoints by orderIndex
        const allWaypoints = [...pickups, ...dropoffs, ...stopovers].sort((a, b) => a.orderIndex - b.orderIndex);
        
        // Calculate arrival times for each waypoint
        if (allWaypoints.length > 0 && newRide.routeDurationSeconds) {
            const arrivalTimes = calculateWaypointArrivalTimes(
                newRide.departureTime,
                newRide.routeDurationSeconds,
                allWaypoints.length
            );
            
            // Add estimated arrival time to each waypoint
            allWaypoints.forEach((waypoint, index) => {
                (waypoint as any).estimatedArrivalTime = arrivalTimes[index] || null;
            });
            
            await tx.rideWaypoint.createMany({ data: allWaypoints });
        }

        return tx.ride.findUnique({
            where: { id: newRide.id },
            include: { waypoints: { orderBy: { orderIndex: 'asc' } } },
        });
    });

    // ---- Cleanup: Remove draft + route cache from Redis ---- //
    await redis.del(draftKey(driverId));
    await redis.del(routesCacheKey(driverId));

    return ride;
};

// ============================================================
//  DRAFT MANAGEMENT
// ============================================================

/**
 * Get the user's draft
 */
export const getUserDraft = async (driverId: string): Promise<DraftRide> => {
    return getDraft(driverId);
};

/**
 * Delete the user's draft from Redis
 */
export const deleteDraft = async (driverId: string) => {
    const key = draftKey(driverId);
    const exists = await redis.exists(key);

    if (!exists) {
        throw new Error('DRAFT_NOT_FOUND');
    }

    await redis.del(key);
    await redis.del(routesCacheKey(driverId));

    return { deleted: true };
};

// ============================================================
//  HELPERS
// ============================================================

function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours}h ${minutes}min`;
    }
    return `${minutes} min`;
}

function calculateDraftCompletion(draft: DraftRide): number {
    let completed = 0;
    const total = 6; // origin, destination, schedule, seats, price, route

    if (draft.originAddress) completed++;
    if (draft.destinationAddress) completed++;
    if (draft.departureDate) completed++;
    if (draft.totalSeats && draft.totalSeats > 0) completed++;
    if (draft.basePricePerSeat && draft.basePricePerSeat > 0) completed++;
    if (draft.routePolyline) completed++;

    return Math.round((completed / total) * 100);
}
