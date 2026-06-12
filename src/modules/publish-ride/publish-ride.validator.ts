import { RideStatus, WaypointType } from '@prisma/client';
import { z } from 'zod';

/* ================= WAYPOINT SCHEMA ================= */
export const waypointSchema = z.object({
    placeId: z.string().trim().min(1, 'Place ID is required'),
    address: z.string().trim().min(1, 'Address is required'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    waypointType: z.nativeEnum(WaypointType),
    orderIndex: z.number().int().min(0),
    pricePerSeat: z.number().positive().optional(),
});

/* ================= CREATE RIDE SCHEMA ================= */
export const createRideSchema = z.object({
    // Origin
    originPlaceId: z.string().trim().min(1, 'Origin place ID is required'),
    originAddress: z.string().trim().min(1, 'Origin address is required'),
    originLat: z.number().min(-90).max(90),
    originLng: z.number().min(-180).max(180),

    // Destination
    destinationPlaceId: z.string().trim().min(1, 'Destination place ID is required'),
    destinationAddress: z.string().trim().min(1, 'Destination address is required'),
    destinationLat: z.number().min(-90).max(90),
    destinationLng: z.number().min(-180).max(180),

    // Schedule
    departureDate: z.coerce.date().refine(
        (date) => date > new Date(),
        { message: 'Departure date must be in the future' }
    ),
    departureTime: z.string().regex(
        /^([01]\d|2[0-3]):([0-5]\d)$/,
        'Time must be in HH:mm format'
    ),

    // Capacity & Pricing
    totalSeats: z.number().int().min(1, 'At least 1 seat required').max(50, 'Maximum 50 seats'),
    basePricePerSeat: z.number().positive('Price must be positive'),
    currency: z.string().default('EUR'),

    // Optional vehicle
    vehicleId: z.string().uuid().optional(),

    // Optional waypoints
    waypoints: z.array(waypointSchema).optional(),

    // Optional route data
    routePolyline: z.string().optional(),
    routeDistanceMeters: z.number().int().positive().optional(),
    routeDurationSeconds: z.number().int().positive().optional(),

    // Optional notes
    notes: z.string().max(500, 'Notes must be 500 characters or less').optional(),
});

/* ================= UPDATE WAYPOINTS SCHEMA ================= */
export const updateWaypointsSchema = z.object({
    waypoints: z.array(waypointSchema).min(1, 'At least one waypoint required'),
});

/* ================= UPDATE ROUTE SCHEMA ================= */
export const updateRouteSchema = z.object({
    routePolyline: z.string().min(1, 'Route polyline is required'),
    routeDistanceMeters: z.number().int().positive(),
    routeDurationSeconds: z.number().int().positive(),
});

/* ================= UPDATE PRICING SCHEMA ================= */
export const updatePricingSchema = z.object({
    basePricePerSeat: z.number().positive('Price must be positive'),
    stopoverPricing: z.array(
        z.object({
            placeId: z.string().trim().min(1, 'Place ID is required'),
            pricePerSeat: z.number().positive(),
            estimatedArrivalTime: z.string().regex(
                /^([01]\d|2[0-3]):([0-5]\d)$/,
                'Time must be in HH:mm format'
            ).optional(),
        })
    ).optional(),
});

/* ================= UPDATE NOTES SCHEMA ================= */
export const updateNotesSchema = z.object({
    notes: z.string().max(150, 'Notes must be 150 characters or less'),
    femaleOnly: z.boolean().optional(),
});

/* ================= PUBLISH RIDE SCHEMA ================= */
export const publishRideSchema = z.object({
    rideId: z.string().uuid(),
});

/* ================= LIST RIDES QUERY SCHEMA ================= */
export const listRidesQuerySchema = z.object({
    status: z.nativeEnum(RideStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(10),
});

/* ================= RIDE ID PARAM SCHEMA ================= */
export const rideIdParamSchema = z.object({
    id: z.string().uuid('Invalid ride ID'),
});

/* ================= LOCATION SCHEMA (Reusable) ================= */
const locationSchema = z.object({
    placeId: z.string().trim().min(1, 'Place ID is required'),
    address: z.string().trim().min(1, 'Address is required'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    estimatedArrivalTime: z.string().regex(
        /^([01]\d|2[0-3]):([0-5]\d)$/,
        'Time must be in HH:mm format'
    ).optional(),
});

/* ================= STEP 1: CREATE WITH ORIGIN + PICKUP ================= */
export const createOriginSchema = z.object({
    originPlaceId: z.string().trim().min(1, 'Origin place ID is required'),
    originAddress: z.string().trim().min(1, 'Origin address is required'),
    originLat: z.number().min(-90).max(90),
    originLng: z.number().min(-180).max(180),
    pickup: locationSchema.optional(),
});

/* ================= STEP 2: UPDATE DESTINATION + DROPOFF ================= */
export const updateDestinationSchema = z.object({
    destinationPlaceId: z.string().trim().min(1, 'Destination place ID is required'),
    destinationAddress: z.string().trim().min(1, 'Destination address is required'),
    destinationLat: z.number().min(-90).max(90),
    destinationLng: z.number().min(-180).max(180),
    dropoff: locationSchema.optional(),
});

/* ================= STEP 3: UPDATE SCHEDULE (Date/Time) ================= */
export const updateScheduleSchema = z.object({
    departureDate: z.coerce.date().refine(
        (date) => date > new Date(),
        { message: 'Departure date must be in the future' }
    ),
    departureTime: z.string().regex(
        /^([01]\d|2[0-3]):([0-5]\d)$/,
        'Time must be in HH:mm format'
    ),
});

/* ================= STEP 4: UPDATE CAPACITY (Seats/Price) ================= */
export const updateCapacitySchema = z.object({
    totalSeats: z.number().int().min(1, 'At least 1 seat required').max(50, 'Maximum 50 seats'),
    maxLuggagePerPerson: z.number().int().min(0, 'Luggage count cannot be negative').max(10, 'Maximum 10 bags per person').default(2),
    backSeatOnly: z.boolean().default(false),
});



/* ================= PHASE 1: SEPARATE WAYPOINT ENDPOINTS ================= */

// Pickups (Screens 2-3)
export const updatePickupsSchema = z.object({
    pickups: z.array(locationSchema).min(1, 'At least one pickup location required'),
});

// Dropoffs (Screens 5-6)
export const updateDropoffsSchema = z.object({
    dropoffs: z.array(locationSchema).min(1, 'At least one dropoff location required'),
});

// Stopovers (Screen 8)
export const updateStopoversSchema = z.object({
    stopovers: z.array(locationSchema).optional().default([]),
});

/* ================= PHASE 2: ROUTE COMPUTATION ================= */

// Request route options
export const computeRoutesSchema = z.object({
    includeAlternatives: z.boolean().default(true),
});

// Select a route
export const selectRouteSchema = z.object({
    routeIndex: z.number().int().min(0, 'Route index must be 0 or greater'),
});

/* ================= PHASE 4: DRAFT MANAGEMENT ================= */
export const listDraftsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(20).default(10),
});
