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

const isMockMode = () => process.env.GOOGLE_MAPS_MOCK_MODE === 'true';
const EUROPE_COUNTRY_NAMES = new Set([
  'albania', 'andorra', 'austria', 'belarus', 'belgium', 'bosnia and herzegovina', 'bulgaria',
  'croatia', 'cyprus', 'czechia', 'czech republic', 'denmark', 'estonia', 'finland', 'france',
  'germany', 'greece', 'hungary', 'iceland', 'ireland', 'italy', 'kosovo', 'latvia',
  'liechtenstein', 'lithuania', 'luxembourg', 'malta', 'moldova', 'monaco', 'montenegro',
  'netherlands', 'north macedonia', 'norway', 'poland', 'portugal', 'romania', 'san marino',
  'serbia', 'slovakia', 'slovenia', 'spain', 'sweden', 'switzerland', 'ukraine',
  'united kingdom', 'uk', 'vatican city',
]);

const isEuropeanPrediction = (prediction: any) => {
  const countryTerm = prediction?.terms?.[prediction.terms.length - 1]?.value;
  if (typeof countryTerm === 'string' && EUROPE_COUNTRY_NAMES.has(countryTerm.trim().toLowerCase())) {
    return true;
  }

  const description = String(prediction?.description || '').toLowerCase();
  return Array.from(EUROPE_COUNTRY_NAMES).some((country) => description.endsWith(`, ${country}`));
};

// Mock data for autocomplete — Baltic region (Estonia, Latvia, Lithuania)
const MOCK_PLACES = [
  // Estonia
  { place_id: 'mock_tallinn', description: 'Tallinn, Estonia', lat: 59.4370, lng: 24.7536 },
  { place_id: 'mock_tartu', description: 'Tartu, Estonia', lat: 58.3780, lng: 26.7290 },
  { place_id: 'mock_narva', description: 'Narva, Estonia', lat: 59.3797, lng: 28.1791 },
  { place_id: 'mock_parnu', description: 'Pärnu, Estonia', lat: 58.3859, lng: 24.4971 },
  { place_id: 'mock_viljandi', description: 'Viljandi, Estonia', lat: 58.3639, lng: 25.5900 },
  { place_id: 'mock_rakvere', description: 'Rakvere, Estonia', lat: 59.3469, lng: 26.3557 },
  { place_id: 'mock_haapsalu', description: 'Haapsalu, Estonia', lat: 58.9431, lng: 23.5414 },
  { place_id: 'mock_kuressaare', description: 'Kuressaare, Estonia', lat: 58.2480, lng: 22.5038 },
  // Latvia
  { place_id: 'mock_riga', description: 'Riga, Latvia', lat: 56.9496, lng: 24.1052 },
  { place_id: 'mock_daugavpils', description: 'Daugavpils, Latvia', lat: 55.8749, lng: 26.5356 },
  { place_id: 'mock_liepaja', description: 'Liepāja, Latvia', lat: 56.5047, lng: 21.0109 },
  { place_id: 'mock_jelgava', description: 'Jelgava, Latvia', lat: 56.6511, lng: 23.7133 },
  { place_id: 'mock_jurmala', description: 'Jūrmala, Latvia', lat: 56.9680, lng: 23.7704 },
  { place_id: 'mock_ventspils', description: 'Ventspils, Latvia', lat: 57.3942, lng: 21.5647 },
  { place_id: 'mock_rezekne', description: 'Rēzekne, Latvia', lat: 56.5099, lng: 27.3340 },
  { place_id: 'mock_sigulda', description: 'Sigulda, Latvia', lat: 57.1514, lng: 24.8514 },
  // Lithuania
  { place_id: 'mock_vilnius', description: 'Vilnius, Lithuania', lat: 54.6872, lng: 25.2797 },
  { place_id: 'mock_kaunas', description: 'Kaunas, Lithuania', lat: 54.8985, lng: 23.9036 },
  { place_id: 'mock_klaipeda', description: 'Klaipėda, Lithuania', lat: 55.7033, lng: 21.1443 },
  { place_id: 'mock_siauliai', description: 'Šiauliai, Lithuania', lat: 55.9349, lng: 23.3137 },
  { place_id: 'mock_panevezys', description: 'Panevėžys, Lithuania', lat: 55.7348, lng: 24.3575 },
  { place_id: 'mock_alytus', description: 'Alytus, Lithuania', lat: 54.3963, lng: 24.0459 },
  { place_id: 'mock_marijampole', description: 'Marijampolė, Lithuania', lat: 54.5594, lng: 23.3500 },
  { place_id: 'mock_druskininkai', description: 'Druskininkai, Lithuania', lat: 54.0166, lng: 23.9697 },
  // Outbound European destinations
  { place_id: 'mock_warsaw', description: 'Warsaw, Poland', lat: 52.2297, lng: 21.0122, scope: 'europe', countryCode: 'PL' },
  { place_id: 'mock_hamburg', description: 'Hamburg, Germany', lat: 53.5511, lng: 9.9937, scope: 'europe', countryCode: 'DE' },
];

export const googleService = {
  async autocomplete(
    input: string,
    location?: { lat: number; lng: number },
    radius?: number,
    types?: string,
    strictBounds?: boolean,
    scope: 'baltic' | 'europe' = 'baltic',
  ) {
    if (isMockMode()) {
      const lower = input.toLowerCase();
      const filtered = MOCK_PLACES.filter(p => {
        const isEuropeOnly = (p as any).scope === 'europe';
        return p.description.toLowerCase().includes(lower) && (scope === 'europe' || !isEuropeOnly);
      });
      if (location && strictBounds === false) {
        filtered.sort((a, b) => {
          const distanceA = (a.lat - location.lat) ** 2 + (a.lng - location.lng) ** 2;
          const distanceB = (b.lat - location.lat) ** 2 + (b.lng - location.lng) ** 2;
          return distanceA - distanceB;
        });
      }
      return filtered.map(p => ({ description: p.description, place_id: p.place_id }));
    }

    const cacheKey = `autocomplete:v3:${scope}:${input}:${location ? `${location.lat},${location.lng}` : 'none'}:${radius || 50000}:${types || 'all'}:${strictBounds ?? 'default'}`;

    // Try to get from cache
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    // Fetch from Google API
    const response: any = await googleHttp.autocomplete({ input, location, radius, types, strictBounds, scope });

    const predictions = scope === 'europe'
      ? response.predictions.filter(isEuropeanPrediction)
      : response.predictions;

    // Cache results for 5 minutes
    await redis.set(cacheKey, JSON.stringify(predictions), 'EX', 300);

    return predictions;
  },

  /**
   * Google Place Details with Redis caching
   */
  async placeDetails(placeId: string) {
    if (isMockMode()) {
      const place = MOCK_PLACES.find(p => p.place_id === placeId);
      if (place) {
        const countryCode = (place as any).countryCode || (place.description.endsWith(', Estonia')
          ? 'EE'
          : place.description.endsWith(', Latvia')
            ? 'LV'
            : 'LT');
        return {
          name: place.description.split(',')[0],
          formatted_address: place.description,
          geometry: { location: { lat: place.lat, lng: place.lng } },
          address_components: [{ short_name: countryCode, long_name: place.description.split(', ')[1], types: ['country'] }],
        };
      }
      // Unknown placeId in mock — return generic
      return {
        name: 'Unknown Place',
        formatted_address: 'Mock Address, UK',
        geometry: { location: { lat: 51.5, lng: -0.1 } },
        address_components: [{ short_name: 'GB', long_name: 'United Kingdom', types: ['country'] }],
      };
    }

    const cacheKey = `placeDetails:v2:${placeId}`;

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
