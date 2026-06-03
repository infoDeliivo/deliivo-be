// google.service.ts
import { googleHttp } from './google.http.js';
import { RouteRequest, RoadsRequest, GeolocationRequest, MultiRouteRequest } from './google.types.js';
import { clusterStops } from './google.cluster.js';
import redis from '../../cache/redis.js';
import polyline from '@mapbox/polyline';
import { createCircuitBreaker } from '../../middlewares/circuitBreaker.js';
import { logWarn } from '../../utils/logger.js';
const routesBreaker = createCircuitBreaker(googleHttp.routes);

/**
 * Helper to detect if circuit breaker is open
 */
function isBreakerOpen(err: any) {
  return err?.message?.includes('Breaker is open');
}

export const googleService = {
  async autocomplete(input: string, location?: { lat: number; lng: number }, radius?: number, types?: string) {
    const cacheKey = `autocomplete:${input}:${location ? `${location.lat},${location.lng}` : 'none'}:${radius || 50000}:${types || 'all'}`;

    // Try to get from cache
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Fetch from Google API
    const response: any = await googleHttp.autocomplete({ input, location, radius, types });

    const predictions = response.predictions;

    // Cache results for 5 minutes
    await redis.set(cacheKey, JSON.stringify(predictions), 'EX', 300);

    return predictions;
  },

  /**
   * Google Place Details with Redis caching
   */
  async placeDetails(placeId: string) {
    const cacheKey = `placeDetails:${placeId}`;

    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const response: any = await googleHttp.placeDetails(placeId);

    const result = response.result;

    // Cache results for 10 minutes
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 600);

    return result;
  },

  /**
   * Compute route with optional waypoints
   */
  async computeRoute(data: RouteRequest) {
    const cacheKey = `route:${JSON.stringify(data)}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const clusters = clusterStops(data.waypoints || [], 25);
    const results: any[] = [];

    for (const group of clusters) {
      try {
        const result: any = await routesBreaker.fire({
          origin: { location: { latLng: data.origin } },
          destination: { location: { latLng: data.destination } },
          intermediates: group.map((p) => ({ location: { latLng: p } })),
          travelMode: data.travelMode || 'DRIVE',
        });

        if (result.routes && Array.isArray(result.routes)) {
          result.routes = result.routes.map((route: any) => {
            if (route.polyline?.encodedPolyline) {
              route.decodedPath = polyline
                .decode(route.polyline.encodedPolyline)
                .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
            }
            return route;
          });
        }

        results.push(result);
      } catch (err: any) {
        if (isBreakerOpen(err)) {
          logWarn('Google Routes breaker open, returning cached data');
          const fallback = await redis.get(cacheKey);
          if (fallback) return JSON.parse(fallback);
          continue;
        }
        throw err;
      }
    }

    // Cache results for 5 minutes
    await redis.set(cacheKey, JSON.stringify(results), 'EX', 300);
    return results;
  },

  /**
   * Snap points to nearest roads
   */
  async snapToRoads(data: RoadsRequest) {
    return googleHttp.roads({
      path: data.points.map((p) => `${p.latitude},${p.longitude}`).join('|'),
      interpolate: true,
      key: process.env.GOOGLE_MAPS_API_KEY,
    });
  },

  /**
   * Get device/user geolocation
   */
  async geolocate(data: GeolocationRequest) {
    return googleHttp.geolocation(data);
  },

  /**
   * Compute multiple alternative routes for same origin/destination
   */
  async computeMultiRoute(data: MultiRouteRequest) {
    const cacheKey = `multiRoute:${JSON.stringify(data)}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    try {
      const result: any = await routesBreaker.fire({
        origin: { location: { latLng: data.origin } },
        destination: { location: { latLng: data.destination } },
        travelMode: data.travelMode || 'DRIVE',
        routingPreference: data.routingPreference || 'TRAFFIC_UNAWARE',
        computeAlternativeRoutes: data.computeAlternativeRoutes ?? false,
        departureTime: data.departureTime,
      });
      const routesWithDecoded = (result.routes || []).map((route: any) => {
        const fullPath: { latitude: number; longitude: number }[] = [];
        const encoded = route.polyline?.encodedPolyline;

        if (encoded) {
          const decoded = polyline
            .decode(encoded)
            .map(([lat, lng]) => ({ latitude: lat, longitude: lng }));
          fullPath.push(...decoded);
        }

        return {
          ...route,
          decodedPolyline: fullPath,
        };
      });

      await redis.set(cacheKey, JSON.stringify(routesWithDecoded), 'EX', 300);
      return routesWithDecoded;
    } catch (err: any) {
      if (isBreakerOpen(err)) {
        logWarn('Google Routes breaker open, returning cached multi-route');
        const fallback = await redis.get(cacheKey);
        if (fallback) return JSON.parse(fallback);
      }
      throw err;
    }
  },
};
