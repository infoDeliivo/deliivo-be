import { z } from 'zod';

/* ================= SEARCH RIDE QUERY SCHEMA ================= */
export const searchRideQuerySchema = z.object({
    // Origin coordinates
    originLat: z.coerce.number().min(-90).max(90),
    originLng: z.coerce.number().min(-180).max(180),

    // Destination coordinates
    destinationLat: z.coerce.number().min(-90).max(90),
    destinationLng: z.coerce.number().min(-180).max(180),

    // Date and time
    departureDate: z.coerce.date().refine(
        (date) => {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return date >= today;
        },
        { message: 'Departure date cannot be in the past' }
    ),
    departureTime: z.string().regex(
        /^([01]\d|2[0-3]):([0-5]\d)$/,
        'Time must be in HH:mm format'
    ).optional(),

    // Seat requirements
    seatsRequired: z.coerce.number().int().min(1).max(10).optional(),

    // Filters
    femaleOnly: z.coerce.boolean().optional(),
    maxPrice: z.coerce.number().positive().optional(),

    // Sorting
    sortBy: z.enum(['price', 'departure', 'distance']).default('departure'),
    sortOrder: z.enum(['asc', 'desc']).default('asc'),

    // Pagination
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(50).default(10),

    // Radius for geo search (km) — default 5km
    radiusKm: z.coerce.number().min(1).max(100).default(5),
});

/* ================= RIDE ID PARAM SCHEMA ================= */
export const rideIdParamSchema = z.object({
    id: z.string().uuid('Invalid ride ID'),
});

export const rideDetailsQuerySchema = z.object({
    segmentId: z.string().min(1, 'segmentId is required').optional(),
});

/* ================= NOTIFY REQUEST SCHEMA ================= */
export const notifyRideSchema = z.object({
    originLat: z.number().min(-90).max(90),
    originLng: z.number().min(-180).max(180),
    destinationLat: z.number().min(-90).max(90),
    destinationLng: z.number().min(-180).max(180),
    departureDate: z.coerce.date().refine(
        (date) => date > new Date(),
        { message: 'Departure date must be in the future' }
    ),
    radiusKm: z.number().min(1).max(100).default(5),
});

/* ================= RECENT SEARCHES QUERY SCHEMA ================= */
export const recentSearchesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(20).default(5),
});

/* ================= ENHANCED SEARCH RIDE QUERY SCHEMA ================= */
export const enhancedSearchRideQuerySchema = searchRideQuerySchema.extend({
    // User's preferred route polyline (encoded)
    userRoutePolyline: z.string().optional(),
    // Minimum polyline similarity threshold 0-1 (default 0.75)
    minSimilarity: z.coerce.number().min(0).max(1).default(0.75),
    // Include alternate routes in results
    includeAlternates: z.coerce.boolean().default(true),
});
