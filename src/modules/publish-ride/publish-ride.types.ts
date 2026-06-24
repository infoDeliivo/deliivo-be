import { RideStatus, WaypointType } from '@prisma/client';

/* ================= WAYPOINT INPUT ================= */
export interface WaypointInput {
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: WaypointType;
    orderIndex: number;
    pricePerSeat?: number;
}

/* ================= CREATE RIDE INPUT ================= */
export interface CreateRideInput {
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

    // Schedule
    departureDate: Date;
    departureTime: string; // HH:mm format

    // Capacity & Pricing
    totalSeats: number;
    basePricePerSeat: number;
    currency?: string;

    // Optional vehicle
    vehicleId?: string;

    // Optional waypoints
    waypoints?: WaypointInput[];

    // Optional route data
    routePolyline?: string;
    routeDistanceMeters?: number;
    routeDurationSeconds?: number;

    // Optional notes
    notes?: string;
}

/* ================= UPDATE WAYPOINTS INPUT ================= */
export interface UpdateWaypointsInput {
    waypoints: WaypointInput[];
}

/* ================= UPDATE ROUTE INPUT ================= */
export interface UpdateRouteInput {
    routePolyline: string;
    routeDistanceMeters: number;
    routeDurationSeconds: number;
}

/* ================= UPDATE PRICING INPUT ================= */
export interface StopoverPricingInput {
    placeId: string;
    pricePerSeat: number;
    estimatedArrivalTime?: string;
}

export interface UpdatePricingInput {
    basePricePerSeat: number;
    stopoverPricing?: StopoverPricingInput[];
}

/* ================= UPDATE NOTES INPUT ================= */
export interface UpdateNotesInput {
    notes: string;
}

/* ================= STEP 1: ORIGIN INPUT ================= */
export interface CreateOriginInput {
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    pickup?: LocationInput;
}

/* ================= STEP 2: DESTINATION INPUT ================= */
export interface UpdateDestinationInput {
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    dropoff?: LocationInput;
}

/* ================= STEP 3: SCHEDULE INPUT (Date/Time) ================= */
export interface UpdateScheduleInput {
    departureDate: Date;
    departureTime: string; // HH:mm format
}

/* ================= STEP 4: CAPACITY INPUT (Seats) ================= */
export interface UpdateCapacityInput {
    totalSeats: number;
    maxLuggagePerPerson?: number;
    backSeatOnly?: boolean;
    noSmoking?: boolean;
    noBicycles?: boolean;
    childSeatAvailable?: boolean;
}

/* ================= VEHICLE INFO ================= */
export interface VehicleInfo {
    id: string;
    brand: string | null;
    model_num: string | null;
    model_name: string | null;
    type: string | null;
    color: string | null;
    year: number | null;
    imageUrl: string | null;
    isVerified: boolean;
}

/* ================= RIDE RESPONSE ================= */
export interface RideResponse {
    id: string;
    driverId: string;
    vehicleId: string | null;

    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;

    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;

    routePolyline: string | null;
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;

    departureDate: Date;
    departureTime: string;

    totalSeats: number;
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;

    notes: string | null;
    status: RideStatus;

    waypoints?: WaypointResponse[];
    vehicle?: VehicleInfo | null;

    createdAt: Date;
    updatedAt: Date;
}

/* ================= WAYPOINT RESPONSE ================= */
export interface WaypointResponse {
    id: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: WaypointType;
    orderIndex: number;
    pricePerSeat: number | null;
}

/* ================= LIST RIDES QUERY ================= */
export interface ListRidesQuery {
    status?: RideStatus | string;
    page?: number;
    limit?: number;
}

/* ================= PHASE 1: SEPARATE WAYPOINT TYPES ================= */

export interface LocationInput {
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    estimatedArrivalTime?: string; // HH:mm format
    recommendedPrice?: number;
    minPrice?: number;
    maxPrice?: number;
}

export interface UpdatePickupsInput {
    pickups: LocationInput[];
}

export interface UpdateDropoffsInput {
    dropoffs: LocationInput[];
}

export interface UpdateStopoversInput {
    stopovers: LocationInput[];
}

/* ================= PHASE 2: ROUTE COMPUTATION TYPES ================= */

export interface RouteOption {
    index: number;
    polyline: string;
    distanceMeters: number;
    durationSeconds: number;
    distanceText: string;
    durationText: string;
    description?: string;
    warnings?: string[];
    isPublishable?: boolean;
    blockedReason?: string;
}

export interface ComputeRoutesResult {
    routes: RouteOption[];
    selectedIndex: number | null;
}

export interface SelectRouteInput {
    routeIndex: number;
}

/* ================= PHASE 3: PRICING TYPES ================= */

export interface PriceRecommendation {
    recommendedPrice: number;
    minPrice: number;
    maxPrice: number;
    currency: string;
    breakdown: {
        fuelCost: number;
        distanceKm: number;
        pricePerKm: number;
        fuelPricePerLiter?: number;
        fuelPriceCurrency?: string;
        fuelCountryCode?: string;
        fuelSource?: string;
        fuelPriceEffectiveDate?: string | null;
        efficiencyKmPerLiter?: number;
        fuelPriceIsFallback?: boolean;
        fuelPriceIsCached?: boolean;
    };
}

/* ================= STOPPER POINT SUGGESTIONS ================= */

export interface StopoverSuggestion {
    placeId: string;
    name: string;
    address: string;
    lat: number;
    lng: number;
    distanceFromOriginKm: number;
    distanceFromOriginMeters: number;
    types: string[];        // Google Places types (e.g. "locality", "point_of_interest")
    pricePerSeat?: number;  // Auto-calculated based on distance + base price
    estimatedArrivalTime?: string;  // HH:MM format - calculated if departure time is set
}

export interface StopoverSuggestionsResult {
    suggestions: StopoverSuggestion[];
    routeDistanceKm: number;
    basePricePerSeat: number | null;
}

export type RouteLocationMode = 'INTRACITY' | 'INTERCITY';

export interface StopoverPointGroup {
    stopover: StopoverSuggestion;
    directSelectable: boolean;
    pointSuggestions: StopoverSuggestion[];
}

export interface RouteLocationSuggestionsResult {
    routeMode: RouteLocationMode;
    originPickupSuggestions: StopoverSuggestion[];
    destinationDropoffSuggestions: StopoverSuggestion[];
    stopoverGroups: StopoverPointGroup[];
    routeDistanceKm: number;
    basePricePerSeat: number | null;
}

/* ================= PHASE 4: DRAFT MANAGEMENT TYPES ================= */

export interface DraftSummary {
    id: string;
    originAddress: string | null;
    destinationAddress: string | null;
    departureDate: Date;
    status: RideStatus;
    createdAt: Date;
    updatedAt: Date;
    completionPercentage: number;
}

export interface ListDraftsQuery {
    page?: number;
    limit?: number;
}
