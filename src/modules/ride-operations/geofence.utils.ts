/**
 * Haversine distance calculation for geofence validation.
 */

const EARTH_RADIUS_METERS = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Calculates the distance in meters between two coordinates.
 */
export const haversineDistance = (
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
): number => {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return EARTH_RADIUS_METERS * c;
};

/**
 * Returns true if the point is within the given radius of the target.
 */
export const isWithinGeofence = (
    pointLat: number,
    pointLng: number,
    targetLat: number,
    targetLng: number,
    radiusMeters: number
): boolean => {
    return haversineDistance(pointLat, pointLng, targetLat, targetLng) <= radiusMeters;
};
