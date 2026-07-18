import polyline from '@mapbox/polyline';

/* ================= TYPES ================= */
export interface LatLng {
    lat: number;
    lng: number;
}

/* ================= CONSTANTS ================= */
const EARTH_RADIUS_KM = 6371;

/* ================= HAVERSINE DISTANCE ================= */
/**
 * Calculate distance between two points using Haversine formula
 */
export const calculateHaversineDistance = (
    point1: LatLng,
    point2: LatLng
): number => {
    const dLat = ((point2.lat - point1.lat) * Math.PI) / 180;
    const dLng = ((point2.lng - point1.lng) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((point1.lat * Math.PI) / 180) *
        Math.cos((point2.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_KM * c;
};

/* ================= POLYLINE DECODE/ENCODE ================= */
/**
 * Decode an encoded polyline string to array of coordinates
 */
export const decodePolyline = (encoded: string): LatLng[] => {
    try {
        const decoded = polyline.decode(encoded);
        return decoded.map(([lat, lng]) => ({ lat, lng }));
    } catch {
        return [];
    }
};

/**
 * Encode array of coordinates to polyline string
 */
export const encodePolyline = (points: LatLng[]): string => {
    const coords: [number, number][] = points.map(p => [p.lat, p.lng]);
    return polyline.encode(coords);
};

/* ================= POINT ON ROUTE CHECK ================= */
/**
 * Check if a point lies on/near a route within tolerance
 */
export const isPointOnRoute = (
    point: LatLng,
    routePoints: LatLng[],
    toleranceKm: number = 2
): boolean => {
    if (routePoints.length === 0) return false;

    for (let i = 0; i < routePoints.length - 1; i++) {
        const distance = pointToSegmentDistance(point, routePoints[i], routePoints[i + 1]);
        if (distance <= toleranceKm) {
            return true;
        }
    }
    return false;
};

/**
 * Calculate perpendicular distance from point to line segment
 */
const pointToSegmentDistance = (
    point: LatLng,
    segStart: LatLng,
    segEnd: LatLng
): number => {
    const segLength = calculateHaversineDistance(segStart, segEnd);

    if (segLength === 0) {
        return calculateHaversineDistance(point, segStart);
    }

    // Project point onto line segment
    const t = Math.max(0, Math.min(1,
        ((point.lat - segStart.lat) * (segEnd.lat - segStart.lat) +
            (point.lng - segStart.lng) * (segEnd.lng - segStart.lng)) /
        (segLength * segLength * 111.32 * 111.32) // Convert to km²
    ));

    const projection: LatLng = {
        lat: segStart.lat + t * (segEnd.lat - segStart.lat),
        lng: segStart.lng + t * (segEnd.lng - segStart.lng),
    };

    return calculateHaversineDistance(point, projection);
};

/* ================= FIND NEAREST POINT ON ROUTE ================= */
/**
 * Find the nearest point on a route to a given point
 */
export const findNearestPointOnRoute = (
    point: LatLng,
    routePoints: LatLng[]
): { point: LatLng; distance: number; index: number } => {
    let minDistance = Infinity;
    let nearestPoint: LatLng = routePoints[0] || point;
    let nearestIndex = 0;

    for (let i = 0; i < routePoints.length; i++) {
        const distance = calculateHaversineDistance(point, routePoints[i]);
        if (distance < minDistance) {
            minDistance = distance;
            nearestPoint = routePoints[i];
            nearestIndex = i;
        }
    }

    return { point: nearestPoint, distance: minDistance, index: nearestIndex };
};

/* ================= SAMPLE POLYLINE POINTS ================= */
/**
 * Sample N evenly-spaced points from a polyline for efficient comparison
 */
export const samplePolylinePoints = (
    points: LatLng[],
    numSamples: number = 20
): LatLng[] => {
    if (points.length <= numSamples) return points;

    const sampled: LatLng[] = [];
    const step = (points.length - 1) / (numSamples - 1);

    for (let i = 0; i < numSamples; i++) {
        const index = Math.round(i * step);
        sampled.push(points[index]);
    }

    return sampled;
};

/* ================= POLYLINE SIMILARITY ================= */
/**
 * Calculate similarity between two polylines (0-1 score)
 * Uses Fréchet-like distance comparison with sampled points
 */
export const calculatePolylineSimilarity = (
    polyline1: string,
    polyline2: string,
    sampleSize: number = 20
): number => {
    const points1 = decodePolyline(polyline1);
    const points2 = decodePolyline(polyline2);

    if (points1.length === 0 || points2.length === 0) return 0;

    // Sample points for efficient comparison
    const sampled1 = samplePolylinePoints(points1, sampleSize);
    const sampled2 = samplePolylinePoints(points2, sampleSize);

    // Calculate bidirectional matching score
    const score1 = calculateDirectionalMatch(sampled1, sampled2);
    const score2 = calculateDirectionalMatch(sampled2, sampled1);

    // Return average of both directions
    return (score1 + score2) / 2;
};

/**
 * Calculate what percentage of points from source match points in target
 */
const calculateDirectionalMatch = (
    source: LatLng[],
    target: LatLng[],
    toleranceKm: number = 2
): number => {
    let matchCount = 0;

    for (const point of source) {
        const nearest = findNearestPointOnRoute(point, target);
        if (nearest.distance <= toleranceKm) {
            matchCount++;
        }
    }

    return matchCount / source.length;
};

/* ================= ROUTE COVERAGE CHECK ================= */
/**
 * Check if user's route is "covered" by driver's route
 * (user can join and leave along driver's path)
 */
export const isRouteCovered = (
    userOrigin: LatLng,
    userDestination: LatLng,
    driverRoutePoints: LatLng[],
    toleranceKm: number = 2
): { covered: boolean; originIndex: number; destIndex: number } => {
    if (driverRoutePoints.length === 0) {
        return { covered: false, originIndex: -1, destIndex: -1 };
    }

    const originMatch = findNearestPointOnRoute(userOrigin, driverRoutePoints);
    const destMatch = findNearestPointOnRoute(userDestination, driverRoutePoints);

    // Check if both points are on route and destination comes after origin
    const covered =
        originMatch.distance <= toleranceKm &&
        destMatch.distance <= toleranceKm &&
        originMatch.index < destMatch.index;

    return {
        covered,
        originIndex: originMatch.index,
        destIndex: destMatch.index,
    };
};

/* ================= BOUNDING BOX UTILITIES ================= */
/**
 * Get bounding box for spatial queries
 */
export const getBoundingBox = (lat: number, lng: number, radiusKm: number) => {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));

    return {
        minLat: lat - latDelta,
        maxLat: lat + latDelta,
        minLng: lng - lngDelta,
        maxLng: lng + lngDelta,
    };
};

/**
 * Merge multiple bounding boxes into one encompassing box
 */
export const mergeBoundingBoxes = (
    boxes: Array<{ minLat: number; maxLat: number; minLng: number; maxLng: number }>
): { minLat: number; maxLat: number; minLng: number; maxLng: number } => {
    if (boxes.length === 0) {
        return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
    }

    return boxes.reduce((merged, box) => ({
        minLat: Math.min(merged.minLat, box.minLat),
        maxLat: Math.max(merged.maxLat, box.maxLat),
        minLng: Math.min(merged.minLng, box.minLng),
        maxLng: Math.max(merged.maxLng, box.maxLng),
    }));
};
