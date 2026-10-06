/**
 * Where a rider gets on and off, as the driver should see it on a booking request.
 *
 * The rider's own pickup/drop-off addresses are snapshotted on the booking at booking time
 * (`pickupAddress` / `dropoffAddress`), and that snapshot is what they actually booked. The
 * waypoint link and the ride's own origin/destination are only fallbacks for bookings made
 * before the snapshot existed. Showing the ride endpoints instead used to make a rider who
 * joins for one leg look like a whole-route passenger.
 */

export interface StopWaypoint {
    id: string;
    address: string;
    placeId: string | null;
    lat: number;
    lng: number;
    waypointType: string;
    estimatedArrivalTime?: string | null;
}

export interface StopRide {
    originAddress: string;
    originPlaceId: string | null;
    originLat: number;
    originLng: number;
    destinationAddress: string;
    destinationPlaceId: string | null;
    destinationLat: number;
    destinationLng: number;
    departureTime: string;
    waypoints: StopWaypoint[];
}

export interface StopBooking {
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    pickupAddress: string | null;
    dropoffAddress: string | null;
}

export interface BookingStop {
    address: string;
    placeId: string | null;
    lat: number | null;
    lng: number | null;
    estimatedArrivalTime: string | null;
    /**
     * True when this stop is at the ride's start (pickup) or end (drop-off): the endpoint itself
     * or one of its meeting points. False for a stopover.
     */
    isFullRoute: boolean;
}

const sameAddress = (a: string | null | undefined, b: string | null | undefined) =>
    Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());

const resolveStop = (
    ride: StopRide,
    waypointId: string | null,
    snapshotAddress: string | null,
    endpoint: { address: string; placeId: string | null; lat: number; lng: number; time: string | null },
): BookingStop => {
    const waypoint = waypointId ? ride.waypoints.find((w) => w.id === waypointId) : undefined;
    if (waypoint) {
        return {
            address: snapshotAddress || waypoint.address,
            placeId: waypoint.placeId,
            lat: waypoint.lat,
            lng: waypoint.lng,
            estimatedArrivalTime: waypoint.estimatedArrivalTime ?? null,
            // Pickup/drop-off meeting points sit at the route's start and end; only a stopover
            // means the rider joins part of the route.
            isFullRoute: waypoint.waypointType !== 'STOPOVER',
        };
    }

    // No linked waypoint: the endpoint is right only if the rider's snapshot says so (or there
    // is no snapshot at all, for bookings made before it existed).
    if (!snapshotAddress || sameAddress(snapshotAddress, endpoint.address)) {
        return {
            address: endpoint.address,
            placeId: endpoint.placeId,
            lat: endpoint.lat,
            lng: endpoint.lng,
            estimatedArrivalTime: endpoint.time,
            isFullRoute: true,
        };
    }

    // A stop we cannot place on a known point: show the rider's address, and no coordinates
    // rather than the endpoint's, so nothing points the driver at the wrong place.
    return {
        address: snapshotAddress,
        placeId: null,
        lat: null,
        lng: null,
        estimatedArrivalTime: null,
        isFullRoute: false,
    };
};

export const resolveBookingStops = (
    ride: StopRide,
    booking: StopBooking,
): { pickupLocation: BookingStop; dropoffLocation: BookingStop } => {
    const destinationArrival = ride.waypoints.find((w) => w.waypointType === 'DROPOFF')?.estimatedArrivalTime ?? null;

    return {
        pickupLocation: resolveStop(ride, booking.pickupWaypointId, booking.pickupAddress, {
            address: ride.originAddress,
            placeId: ride.originPlaceId,
            lat: ride.originLat,
            lng: ride.originLng,
            time: ride.departureTime,
        }),
        dropoffLocation: resolveStop(ride, booking.dropoffWaypointId, booking.dropoffAddress, {
            address: ride.destinationAddress,
            placeId: ride.destinationPlaceId,
            lat: ride.destinationLat,
            lng: ride.destinationLng,
            time: destinationArrival,
        }),
    };
};
