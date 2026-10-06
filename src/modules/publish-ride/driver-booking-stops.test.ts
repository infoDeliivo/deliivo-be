import { resolveBookingStops, StopRide } from './driver-booking-stops.js';

const ride: StopRide = {
    originAddress: 'Tallinn, Estonia',
    originPlaceId: 'place-tallinn',
    originLat: 59.437,
    originLng: 24.7536,
    destinationAddress: 'Tartu, Estonia',
    destinationPlaceId: 'place-tartu',
    destinationLat: 58.378,
    destinationLng: 26.729,
    departureTime: '09:00',
    waypoints: [
        { id: 'wp-pickup', address: 'Tallinn Bus Station', placeId: 'p1', lat: 59.43, lng: 24.76, waypointType: 'PICKUP', estimatedArrivalTime: '09:00' },
        { id: 'wp-paide', address: 'Paide, Estonia', placeId: 'p2', lat: 58.885, lng: 25.557, waypointType: 'STOPOVER', estimatedArrivalTime: '10:05' },
        { id: 'wp-dropoff', address: 'Tartu Bus Station', placeId: 'p3', lat: 58.37, lng: 26.73, waypointType: 'DROPOFF', estimatedArrivalTime: '11:30' },
    ],
};

describe('resolveBookingStops', () => {
    it("shows the rider's booked addresses, not the ride's endpoints, for a segment without waypoint links", () => {
        const stops = resolveBookingStops(ride, {
            pickupWaypointId: null,
            dropoffWaypointId: null,
            pickupAddress: 'Tallinn, Estonia',
            dropoffAddress: 'Somewhere on the way, Estonia',
        });

        expect(stops.pickupLocation).toMatchObject({ address: 'Tallinn, Estonia', isFullRoute: true, estimatedArrivalTime: '09:00' });
        expect(stops.dropoffLocation).toEqual({
            address: 'Somewhere on the way, Estonia',
            placeId: null,
            lat: null,
            lng: null,
            estimatedArrivalTime: null,
            isFullRoute: false,
        });
    });

    it('uses the waypoint for coordinates and time, and marks a stopover as part of the route', () => {
        const stops = resolveBookingStops(ride, {
            pickupWaypointId: 'wp-pickup',
            dropoffWaypointId: 'wp-paide',
            pickupAddress: 'Tallinn Bus Station',
            dropoffAddress: 'Paide, Estonia',
        });

        expect(stops.pickupLocation).toMatchObject({ address: 'Tallinn Bus Station', lat: 59.43, isFullRoute: true });
        expect(stops.dropoffLocation).toMatchObject({ address: 'Paide, Estonia', lat: 58.885, estimatedArrivalTime: '10:05', isFullRoute: false });
    });

    it('falls back to the waypoint, then the ride endpoint, for old bookings with no snapshot', () => {
        const stops = resolveBookingStops(ride, {
            pickupWaypointId: 'wp-paide',
            dropoffWaypointId: null,
            pickupAddress: null,
            dropoffAddress: null,
        });

        expect(stops.pickupLocation).toMatchObject({ address: 'Paide, Estonia', isFullRoute: false });
        expect(stops.dropoffLocation).toMatchObject({
            address: 'Tartu, Estonia',
            lat: 58.378,
            estimatedArrivalTime: '11:30',
            isFullRoute: true,
        });
    });

    it('treats a snapshot equal to the endpoint as the endpoint, ignoring case and spacing', () => {
        const stops = resolveBookingStops(ride, {
            pickupWaypointId: null,
            dropoffWaypointId: null,
            pickupAddress: ' tallinn, estonia ',
            dropoffAddress: 'Tartu, Estonia',
        });

        expect(stops.pickupLocation).toMatchObject({ lat: 59.437, isFullRoute: true });
        expect(stops.dropoffLocation).toMatchObject({ lat: 58.378, isFullRoute: true });
    });
});
