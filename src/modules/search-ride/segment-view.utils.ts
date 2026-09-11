import { decodePolyline, routeLengthKm, routeProgressKm } from './polyline.utils.js';

export type SegmentPointRef = 'origin' | 'destination' | `waypoint:${string}`;

export interface SegmentPoint {
    ref: SegmentPointRef;
    waypointId: string | null;
    waypointType: string | null;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    cumulativePrice: number;
    position: number;
}

export interface SegmentBookingContext {
    rideId: string;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
}

export interface SegmentDiagnostics {
    pickupCumulativePrice: number;
    dropCumulativePrice: number;
    segmentFare: number;
}

export interface SegmentView {
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    basePricePerSeat: number;
    /**
     * Length and duration of the segment the rider actually travels, not of the driver's whole
     * route. Null when the ride has no usable route geometry to measure against — callers should
     * omit the figures rather than fall back to the full-route ones.
     */
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;
    /**
     * When the rider is actually picked up. Differs from the ride's departure time whenever they
     * board at a mid-route stop. Null when there is no geometry to place the pickup on.
     */
    departureTime: string | null;
    bookingContext: SegmentBookingContext;
    segment: SegmentDiagnostics;
}

export interface SegmentRideWaypoint {
    id: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: string;
    orderIndex: number;
    pricePerSeat: number | null;
}

export interface SegmentRide {
    id: string;
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    basePricePerSeat: number;
    waypoints: SegmentRideWaypoint[];
    routePolyline?: string | null;
    routeDistanceMeters?: number | null;
    routeDurationSeconds?: number | null;
    departureTime?: string | null;
}

/**
 * Fills in the cumulative price of every point that has none, between the priced points around it.
 *
 * Only some waypoints carry a price: `updatePricing` embeds one on stopovers it can measure against
 * the route, and publishing writes 0 on origin-side meeting points and the base fare on
 * destination-side ones. Everything else arrives null and has to be placed somewhere sensible.
 *
 * The price is taken from the nearest priced point on each side — origin (0) and destination (the
 * full fare) always anchor the ends — and spread evenly across the gap. Spreading over the whole
 * waypoint list instead, as this used to, let the mandatory meeting points consume interpolation
 * slots: one pickup and one dropoff around two unpriced stopovers put the first at 2/5 of the fare
 * rather than 1/3, so a rider was quoted for more of the ride than the segment covers.
 */
const fillMissingCumulativePrices = (prices: (number | null)[]): number[] => {
    const filled = [...prices];

    for (let index = 0; index < filled.length; index++) {
        if (filled[index] !== null) continue;

        let previous = index - 1;
        while (previous >= 0 && filled[previous] === null) previous--;

        let next = index + 1;
        while (next < filled.length && prices[next] === null) next++;

        // The origin and destination are always priced, so both anchors exist.
        const previousPrice = filled[previous] as number;
        const nextPrice = prices[next] as number;
        const step = (nextPrice - previousPrice) / (next - previous);

        filled[index] = Math.round((previousPrice + step * (index - previous)) * 100) / 100;
    }

    return filled as number[];
};

export const buildSegmentPoints = (ride: SegmentRide): SegmentPoint[] => {
    const segmentWaypoints = [...ride.waypoints]
        .sort((a, b) => a.orderIndex - b.orderIndex);

    const cumulativePrices = fillMissingCumulativePrices([
        0,
        ...segmentWaypoints.map((waypoint) => waypoint.pricePerSeat ?? null),
        ride.basePricePerSeat,
    ]);

    return [
        {
            ref: 'origin',
            waypointId: null,
            waypointType: null,
            placeId: ride.originPlaceId,
            address: ride.originAddress,
            lat: ride.originLat,
            lng: ride.originLng,
            cumulativePrice: cumulativePrices[0],
            position: 0,
        },
        ...segmentWaypoints.map((waypoint, index) => ({
            ref: `waypoint:${waypoint.id}` as const,
            waypointId: waypoint.id,
            waypointType: waypoint.waypointType,
            placeId: waypoint.placeId,
            address: waypoint.address,
            lat: waypoint.lat,
            lng: waypoint.lng,
            cumulativePrice: cumulativePrices[index + 1],
            position: index + 1,
        })),
        {
            ref: 'destination',
            waypointId: null,
            waypointType: null,
            placeId: ride.destinationPlaceId,
            address: ride.destinationAddress,
            lat: ride.destinationLat,
            lng: ride.destinationLng,
            cumulativePrice: cumulativePrices[segmentWaypoints.length + 1],
            position: segmentWaypoints.length + 1,
        },
    ];
};

/**
 * Where two points sit along the driver's route, each as a fraction of its total length.
 *
 * Both ends are measured as progress along the polyline, so they reflect the road the rider is
 * carried over rather than the straight line between them. Returns null when the route has no
 * geometry, or when the two points project to the same place and no leg can be told apart from
 * rounding noise.
 */
const routeSharesBetween = (
    ride: SegmentRide,
    pickup: SegmentPoint,
    drop: SegmentPoint
): { pickupShare: number; legShare: number } | null => {
    if (!ride.routePolyline) return null;

    const routePoints = decodePolyline(ride.routePolyline);
    const totalKm = routeLengthKm(routePoints);
    if (totalKm <= 0) return null;

    const pickupKm = routeProgressKm(pickup, routePoints);
    const dropKm = routeProgressKm(drop, routePoints);
    if (pickupKm === null || dropKm === null) return null;

    const legShare = (dropKm - pickupKm) / totalKm;
    if (legShare <= 0) return null;

    return {
        pickupShare: Math.min(1, Math.max(0, pickupKm / totalKm)),
        legShare: Math.min(1, legShare),
    };
};

/** Move an HH:mm clock time forward by a number of seconds, wrapping past midnight. */
const shiftClockTime = (time: string, seconds: number): string => {
    const [hours, minutes] = time.split(':').map(Number);
    if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;

    const shifted = (hours * 60 + minutes + Math.round(seconds / 60)) % (24 * 60);
    const wrapped = (shifted + 24 * 60) % (24 * 60);

    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
};

const segmentRouteMetrics = (
    ride: SegmentRide,
    pickup: SegmentPoint,
    drop: SegmentPoint
): {
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;
    departureTime: string | null;
} => {
    const rideDepartureTime = ride.departureTime ?? null;

    // The whole route's endpoints: nothing to trim, so the ride's own figures already describe it.
    if (pickup.ref === 'origin' && drop.ref === 'destination') {
        return {
            routeDistanceMeters: ride.routeDistanceMeters ?? null,
            routeDurationSeconds: ride.routeDurationSeconds ?? null,
            departureTime: rideDepartureTime,
        };
    }

    const shares = routeSharesBetween(ride, pickup, drop);
    if (shares === null) {
        return { routeDistanceMeters: null, routeDurationSeconds: null, departureTime: null };
    }

    // Scale the provider's own totals by the share, rather than reporting the polyline's length:
    // the polyline is a simplified trace and runs a little short of the real road distance.
    const routeDurationSeconds =
        ride.routeDurationSeconds != null
            ? Math.round(ride.routeDurationSeconds * shares.legShare)
            : null;

    // The rider boards partway along, so their departure is the driver's plus the drive up to the
    // pickup. Derived from the same geometry as the distance, not from the waypoint arrival times
    // publishing writes, which space stops evenly by list position instead of by distance.
    const departureTime =
        rideDepartureTime && ride.routeDurationSeconds != null
            ? shiftClockTime(rideDepartureTime, ride.routeDurationSeconds * shares.pickupShare)
            : rideDepartureTime;

    return {
        routeDistanceMeters:
            ride.routeDistanceMeters != null
                ? Math.round(ride.routeDistanceMeters * shares.legShare)
                : null,
        routeDurationSeconds,
        departureTime,
    };
};

const findPointByRef = (
    points: SegmentPoint[],
    ref: SegmentPointRef | null | undefined
): SegmentPoint | null => {
    if (!ref) {
        return null;
    }

    return points.find((point) => point.ref === ref) ?? null;
};

const normalizeFarePoint = (
    points: SegmentPoint[],
    point: SegmentPoint,
    role: 'pickup' | 'dropoff'
): SegmentPoint => {
    if (role === 'pickup' && point.waypointType === 'PICKUP') {
        return points.find((candidate) => candidate.ref === 'origin') ?? point;
    }

    if (role === 'dropoff' && point.waypointType === 'DROPOFF') {
        return points.find((candidate) => candidate.ref === 'destination') ?? point;
    }

    return point;
};

export const resolveSegmentView = (
    ride: SegmentRide,
    points: SegmentPoint[],
    pickupRef: SegmentPointRef | null | undefined,
    dropRef: SegmentPointRef | null | undefined
): SegmentView | null => {
    const pickup = findPointByRef(points, pickupRef);
    const drop = findPointByRef(points, dropRef);

    if (!pickup || !drop) {
        return null;
    }

    if (pickup.position >= drop.position) {
        return null;
    }

    const farePickup = normalizeFarePoint(points, pickup, 'pickup');
    const fareDrop = normalizeFarePoint(points, drop, 'dropoff');
    const segmentFare = fareDrop.cumulativePrice - farePickup.cumulativePrice;

    if (segmentFare < 0) {
        return null;
    }

    return {
        originPlaceId: pickup.placeId,
        originAddress: pickup.address,
        originLat: pickup.lat,
        originLng: pickup.lng,
        destinationPlaceId: drop.placeId,
        destinationAddress: drop.address,
        destinationLat: drop.lat,
        destinationLng: drop.lng,
        basePricePerSeat: segmentFare,
        ...segmentRouteMetrics(ride, pickup, drop),
        bookingContext: {
            rideId: ride.id,
            pickupWaypointId: pickup.waypointId,
            dropoffWaypointId: drop.waypointId,
        },
        segment: {
            pickupCumulativePrice: farePickup.cumulativePrice,
            dropCumulativePrice: fareDrop.cumulativePrice,
            segmentFare,
        },
    };
};
