export type SegmentPointRef = 'origin' | 'destination' | `waypoint:${string}`;

export interface SegmentPoint {
    ref: SegmentPointRef;
    waypointId: string | null;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    cumulativePrice: number;
    orderIndex: number;
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

export const buildSegmentPoints = (ride: SegmentRide): SegmentPoint[] => [
    {
        ref: 'origin',
        waypointId: null,
        placeId: ride.originPlaceId,
        address: ride.originAddress,
        lat: ride.originLat,
        lng: ride.originLng,
        cumulativePrice: 0,
        orderIndex: 0,
    },
    ...[...ride.waypoints]
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .map((waypoint) => ({
            ref: `waypoint:${waypoint.id}` as const,
            waypointId: waypoint.id,
            placeId: waypoint.placeId,
            address: waypoint.address,
            lat: waypoint.lat,
            lng: waypoint.lng,
            cumulativePrice: waypoint.pricePerSeat ?? Number.NaN,
            orderIndex: waypoint.orderIndex,
        })),
    {
        ref: 'destination',
        waypointId: null,
        placeId: ride.destinationPlaceId,
        address: ride.destinationAddress,
        lat: ride.destinationLat,
        lng: ride.destinationLng,
        cumulativePrice: ride.basePricePerSeat,
        orderIndex: Number.MAX_SAFE_INTEGER,
    },
];

const findPointByRef = (
    points: SegmentPoint[],
    ref: SegmentPointRef | null | undefined
): SegmentPoint | null => {
    if (!ref) {
        return null;
    }

    return points.find((point) => point.ref === ref) ?? null;
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

    if (pickup.orderIndex >= drop.orderIndex) {
        return null;
    }

    if (Number.isNaN(pickup.cumulativePrice) || Number.isNaN(drop.cumulativePrice)) {
        return null;
    }

    const segmentFare = drop.cumulativePrice - pickup.cumulativePrice;

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
            pickupCumulativePrice: pickup.cumulativePrice,
            dropCumulativePrice: drop.cumulativePrice,
            segmentFare,
        },
    };
};
