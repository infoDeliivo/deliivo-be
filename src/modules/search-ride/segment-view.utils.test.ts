import { buildSegmentPoints, resolveSegmentView } from './segment-view.utils.js';

describe('resolveSegmentView', () => {
    const ride = {
        id: 'ride-1',
        originPlaceId: 'place-a',
        originAddress: 'A',
        originLat: 1,
        originLng: 1,
        destinationPlaceId: 'place-d',
        destinationAddress: 'D',
        destinationLat: 4,
        destinationLng: 4,
        basePricePerSeat: 30,
        waypoints: [
            {
                id: 'wp-b',
                placeId: 'place-b',
                address: 'B',
                lat: 2,
                lng: 2,
                waypointType: 'STOPOVER',
                orderIndex: 50,
                pricePerSeat: 10,
            },
            {
                id: 'wp-c',
                placeId: 'place-c',
                address: 'C',
                lat: 3,
                lng: 3,
                waypointType: 'STOPOVER',
                orderIndex: 51,
                pricePerSeat: 20,
            },
        ],
    };

    it('computes B -> C as 10 when cumulative prices are 10 and 20', () => {
        const points = buildSegmentPoints(ride);
        const result = resolveSegmentView(ride, points, 'waypoint:wp-b', 'waypoint:wp-c');

        expect(result?.basePricePerSeat).toBe(10);
        expect(result?.originAddress).toBe('B');
        expect(result?.destinationAddress).toBe('C');
        expect(result?.bookingContext).toEqual({
            rideId: 'ride-1',
            pickupWaypointId: 'wp-b',
            dropoffWaypointId: 'wp-c',
        });
        expect(result?.segment).toEqual({
            pickupCumulativePrice: 10,
            dropCumulativePrice: 20,
            segmentFare: 10,
        });
    });

    it('computes C -> D as 10 when destination base is 30', () => {
        const points = buildSegmentPoints(ride);
        const result = resolveSegmentView(ride, points, 'waypoint:wp-c', 'destination');

        expect(result?.basePricePerSeat).toBe(10);
        expect(result?.originAddress).toBe('C');
        expect(result?.destinationAddress).toBe('D');
        expect(result?.bookingContext?.dropoffWaypointId).toBeNull();
    });

    it('ignores non-stopover waypoints so origin -> first stopover remains valid', () => {
        const rideWithPickupAndDropoff = {
            ...ride,
            waypoints: [
                {
                    id: 'wp-pickup',
                    placeId: 'place-p',
                    address: 'Pickup',
                    lat: 1.5,
                    lng: 1.5,
                    waypointType: 'PICKUP',
                    orderIndex: 0,
                    pricePerSeat: null,
                },
                ...ride.waypoints,
                {
                    id: 'wp-dropoff',
                    placeId: 'place-x',
                    address: 'Dropoff',
                    lat: 3.5,
                    lng: 3.5,
                    waypointType: 'DROPOFF',
                    orderIndex: 100,
                    pricePerSeat: null,
                },
            ],
        };

        const points = buildSegmentPoints(rideWithPickupAndDropoff);
        expect(points.some((point) => point.ref === 'waypoint:wp-pickup')).toBe(false);
        expect(points.some((point) => point.ref === 'waypoint:wp-dropoff')).toBe(false);

        const result = resolveSegmentView(
            rideWithPickupAndDropoff,
            points,
            'origin',
            'waypoint:wp-b'
        );
        expect(result?.basePricePerSeat).toBe(10);
    });
});
