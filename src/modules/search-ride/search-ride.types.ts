import { RideStatus, BookingStatus } from '@prisma/client';

/* ================= SEARCH RIDE QUERY ================= */
export interface SearchRideQuery {
    // Origin location
    originLat: number;
    originLng: number;

    // Destination location
    destinationLat: number;
    destinationLng: number;

    // Date and time filters
    departureDate: Date;
    departureTime?: string; // Optional: HH:mm format

    // Seat requirements
    seatsRequired?: number;

    // Filter options
    femaleOnly?: boolean;
    maxPrice?: number;
    sortBy?: 'price' | 'departure' | 'distance';
    sortOrder?: 'asc' | 'desc';

    // Pagination
    page?: number;
    limit?: number;

    // Radius in kilometers for geo search
    radiusKm?: number;
}

/* ================= SEARCH RESULT ================= */
export interface SearchRideResult {
    id: string;
    driverId: string;

    // Driver info
    driver: {
        id: string;
        name: string | null;
        avatarUrl: string | null;
        rating?: number;
    };

    // Vehicle info
    vehicle?: {
        id: string;
        brand: string | null;
        model_num: string | null;
        model_name?: string | null;
        type: string | null;
        color: string | null;
        year?: number | null;
        imageUrl: string | null;
        isVerified?: boolean;
    } | null;

    bookings?: SearchRideBooking[];

    // Origin
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;

    // Destination
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;

    // Route info
    routePolyline?: string | null;
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;

    // Schedule
    departureDate: Date;
    departureTime: string;

    // Pricing & Availability
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;

    // Status
    status: RideStatus;

    // Flags
    femaleOnly?: boolean;

    // Distance from search origin/destination (km)
    distanceFromOrigin?: number;
    distanceFromDestination?: number;

    // User booking status
    hasActiveBooking?: boolean; // True if the searching user already has an active booking for this ride
}

export interface SearchRideBookedRider {
    id: string;
    name: string | null;
    nickName: string | null;
    phone: string | null;
    avatarUrl: string | null;
}

export interface SearchRideBooking {
    id?: string;
    rideId?: string;
    passengerId: string;
    seatsBooked: number;
    totalPrice?: number;
    status: BookingStatus;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    createdAt?: Date;
    updatedAt?: Date;
    rider?: SearchRideBookedRider;
}

/* ================= SEARCH RESPONSE ================= */
export interface SearchRideResponse {
    rides: SearchRideResult[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

/* ================= RIDE DETAILS RESPONSE ================= */
export interface RideDetailsResponse extends SearchRideResult {
    notes: string | null;
    femaleOnly?: boolean;
    waypoints: WaypointInfo[];
    totalSeats: number;
    isSegmentView?: boolean;
    segmentId?: string;
    bookingContext?: BookingContext;
    segment?: SegmentDiagnostics;
    fullRide?: RideSnapshot;
    segmentRide?: SegmentRideSnapshot | null;
}

/* ================= WAYPOINT INFO ================= */
export interface WaypointInfo {
    id: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: string;
    orderIndex: number;
    pricePerSeat: number | null;
    estimatedArrivalTime?: string | null;
}

export interface RideSnapshot {
    id: string;
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    routePolyline?: string | null;
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;
    departureDate: Date;
    departureTime: string;
    totalSeats?: number;
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;
    status: RideStatus;
    waypoints?: WaypointInfo[];
}

export interface SegmentRideSnapshot extends RideSnapshot {
    bookingContext: BookingContext;
    segment: SegmentDiagnostics;
    segmentId?: string;
}

/* ================= RECENT SEARCH ================= */
export interface RecentSearch {
    id: string;
    userId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    searchedAt: Date;
}

/* ================= NOTIFY REQUEST ================= */
export interface NotifyRideRequest {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    departureDate: Date;
    radiusKm?: number;
}

/* ================= ENHANCED SEARCH TYPES (SPEC §3-§10) ================= */

/**
 * 4-Condition match types as defined in spec §3 + ALT_ROUTE (§4.3)
 *
 * COND_1: Exact Origin & Destination Match (Ro→Do, Rd→Dd)
 * COND_2: Rider Points Match Anywhere on Route (i < j in D_POINTS)
 * COND_3: Waypoint to Waypoint Match (Ro→Wi, Rd→Wj, i < j)
 * COND_4: Waypoint to Destination Match (Ro→Wi, Rd→Dd)
 * ALT_ROUTE: Alternative Route Match (polyline proximity)
 */
export enum RideMatchType {
    COND_1 = 'COND_1',
    COND_2 = 'COND_2',
    COND_3 = 'COND_3',
    COND_4 = 'COND_4',
    ALT_ROUTE = 'ALT_ROUTE',
}

/** A single point in the D_POINTS array */
export interface DPoint {
    index: number;
    lat: number;
    lng: number;
    address: string;
    waypointId?: string;
    /** 'ORIGIN' | 'WAYPOINT' | 'DEST' */
    pointType: 'ORIGIN' | 'WAYPOINT' | 'DEST';
}

/** Spec §10 — Output response per matched ride */
export interface MatchResult {
    /** Best pickup D_POINTS index */
    pickupIndex: number;
    /** Best drop D_POINTS index */
    dropIndex: number;
    /** Which type of point was matched for pickup */
    pickupMatchedPoint: 'ORIGIN' | 'WAYPOINT' | 'DEST';
    /** Which type of point was matched for drop */
    dropMatchedPoint: 'ORIGIN' | 'WAYPOINT' | 'DEST';
    /** Distance from rider origin to matched pickup point (km) */
    pickupDistanceKm: number;
    /** Distance from rider destination to matched drop point (km) */
    dropDistanceKm: number;
    /** Match type classification */
    matchType: RideMatchType;
    /** Score per spec §8 */
    score: number;
}

/** Waypoint match diagnostic info */
export interface WaypointMatch {
    waypointId: string;
    waypointAddress: string;
    distanceKm: number;
    matchType: 'PICKUP' | 'DROPOFF';
}

export interface BookingContext {
    rideId: string;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
}

export interface SegmentDiagnostics {
    pickupCumulativePrice: number;
    dropCumulativePrice: number;
    segmentFare: number;
}

/**
 * Enhanced search query with polyline support
 */
export interface EnhancedSearchRideQuery extends SearchRideQuery {
    /** User's preferred route polyline (encoded) */
    userRoutePolyline?: string;
    /** Minimum polyline similarity threshold 0-1 (default 0.75) */
    minSimilarity?: number;
    /** Include alternate routes in results (default true) */
    includeAlternates?: boolean;
}

/**
 * Enhanced search result — matches spec §10 output
 */
export interface EnhancedSearchRideResult extends SearchRideResult {
    /** Condition that matched */
    matchType: RideMatchType;
    /** Score per spec §8 (base 1000) */
    score: number;
    /** Which D_POINT type matched for pickup */
    pickupMatchedPoint: 'ORIGIN' | 'WAYPOINT' | 'DEST';
    /** Which D_POINT type matched for drop */
    dropMatchedPoint: 'ORIGIN' | 'WAYPOINT' | 'DEST';
    /** Distance from rider origin to matched pickup (km) */
    pickupDistanceKm: number;
    /** Distance from rider destination to matched drop (km) */
    dropDistanceKm: number;
    /** Encoded route polyline */
    routePolyline?: string | null;
    /** Relevant waypoints near rider */
    relevantWaypoints?: WaypointInfo[];
    isSegmentView?: boolean;
    segmentId?: string;
    bookingContext?: BookingContext;
    segment?: SegmentDiagnostics;
    fullRide?: RideSnapshot;
    segmentRide?: SegmentRideSnapshot | null;
}

/**
 * Enhanced search response
 */
export interface EnhancedSearchRideResponse {
    rides: EnhancedSearchRideResult[];
    /** Grouped results by match type */
    grouped?: {
        cond1: EnhancedSearchRideResult[];
        cond2: EnhancedSearchRideResult[];
        cond3: EnhancedSearchRideResult[];
        cond4: EnhancedSearchRideResult[];
        altRoute: EnhancedSearchRideResult[];
    };
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
