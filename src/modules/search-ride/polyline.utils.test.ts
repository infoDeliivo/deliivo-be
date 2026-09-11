import { isPointOnRoute, calculateHaversineDistance, getBoundingBox, mergeBoundingBoxes } from './polyline.utils';

// isPointOnRoute is the only exported entry to pointToSegmentDistance, so the projection
// behaviour is asserted through it.
describe('pointToSegmentDistance (via isPointOnRoute)', () => {
    // A due-east segment at latitude 59 spanning ~57 km.
    const route = [
        { lat: 59.0, lng: 24.0 },
        { lat: 59.0, lng: 25.0 },
    ];

    it('measures the perpendicular distance to the segment, not to its start', () => {
        // Beside the segment midpoint, ~1.1 km north of the line but ~28 km from segStart.
        const besideMidpoint = { lat: 59.01, lng: 24.5 };

        expect(isPointOnRoute(besideMidpoint, route, 2)).toBe(true);
        // Sanity check that the point really is far from the segment start, so a
        // distance-to-segStart implementation could not pass the assertion above.
        expect(calculateHaversineDistance(besideMidpoint, route[0])).toBeGreaterThan(20);
    });

    it('still rejects a point beyond the tolerance', () => {
        // ~11 km north of the segment.
        expect(isPointOnRoute({ lat: 59.1, lng: 24.5 }, route, 2)).toBe(false);
    });

    it('clamps the projection to the segment ends', () => {
        // Well past the eastern end of the segment.
        expect(isPointOnRoute({ lat: 59.0, lng: 26.0 }, route, 2)).toBe(false);
    });

    it('handles a zero-length segment', () => {
        const degenerate = [
            { lat: 59.0, lng: 24.0 },
            { lat: 59.0, lng: 24.0 },
        ];

        expect(isPointOnRoute({ lat: 59.0, lng: 24.0 }, degenerate, 2)).toBe(true);
        expect(isPointOnRoute({ lat: 59.5, lng: 24.0 }, degenerate, 2)).toBe(false);
    });
});

describe('bounding boxes', () => {
    it('expands a box around a point by the requested radius', () => {
        const box = getBoundingBox(59.437, 24.7536, 10);

        expect(box.maxLat - box.minLat).toBeCloseTo((10 / 111.32) * 2, 5);
        expect(box.maxLng).toBeGreaterThan(24.7536);
        expect(box.minLng).toBeLessThan(24.7536);
    });

    it('merges boxes into the encompassing box', () => {
        const merged = mergeBoundingBoxes([
            { minLat: 1, maxLat: 2, minLng: 10, maxLng: 11 },
            { minLat: 0, maxLat: 3, minLng: 12, maxLng: 13 },
        ]);

        expect(merged).toEqual({ minLat: 0, maxLat: 3, minLng: 10, maxLng: 13 });
    });
});
