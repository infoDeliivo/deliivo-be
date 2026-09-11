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
