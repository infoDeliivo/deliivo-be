/**
 * E2E — Stopover city suggestions must be towns the route actually passes through.
 *
 * Regression for the bug where suggestions came from a 30 km-radius Places search around
 * the route, so towns ~30 km off the corridor were offered and then rejected on save with
 * MEETING_POINT_OUTSIDE_ROUTE.
 *
 * Runs against a Baltic route (Tallinn → Tartu) because publish gates origins to EE/LV/LT.
 * Defaults to live Google place ids. For a server in GOOGLE_MAPS_MOCK_MODE, run with
 * E2E_TALLINN_PLACE_ID=mock_tallinn E2E_TARTU_PLACE_ID=mock_tartu.
 */
import polyline from '@mapbox/polyline';
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const da = authed(state.driverA.accessToken);

/** Corridor the API enforces; keep in sync with PUBLISH_STOPOVER_CORRIDOR_MAX_METERS. */
const CORRIDOR_MAX_METERS = Number(process.env.PUBLISH_STOPOVER_CORRIDOR_MAX_METERS || '10000');

const TALLINN = {
  // Live Google place id; override with the mock id when the server runs in mock mode.
  placeId: process.env.E2E_TALLINN_PLACE_ID || 'ChIJvxZW35mUkkYRcGL8GG2zAAQ',
  address: 'Tallinn, Estonia',
  lat: 59.437,
  lng: 24.7536,
};

const TARTU = {
  placeId: process.env.E2E_TARTU_PLACE_ID || 'ChIJ9z1d1dg260YREG38GG2zAAQ',
  address: 'Tartu, Estonia',
  lat: 58.378,
  lng: 26.729,
};

interface Suggestion {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  distanceFromOriginMeters: number;
  isMajorTown?: boolean;
}

const EARTH_RADIUS_METERS = 6_371_000;

const haversineMeters = (
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** Shortest distance from a point to a decoded route, computed independently of the server. */
const distanceFromRouteMeters = (
  point: { lat: number; lng: number },
  path: { lat: number; lng: number }[],
): number => {
  let minimum = Number.POSITIVE_INFINITY;

  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    const scale = Math.cos((((start.lat + end.lat + point.lat) / 3) * Math.PI) / 180);
    const segmentX = (end.lng - start.lng) * scale;
    const segmentY = end.lat - start.lat;
    const pointX = (point.lng - start.lng) * scale;
    const pointY = point.lat - start.lat;
    const lengthSquared = segmentX ** 2 + segmentY ** 2;
    const ratio = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, (pointX * segmentX + pointY * segmentY) / lengthSquared));
    minimum = Math.min(minimum, haversineMeters(point, {
      lat: start.lat + ratio * (end.lat - start.lat),
      lng: start.lng + ratio * (end.lng - start.lng),
    }));
  }

  return minimum;
};

let routeAvailable = true;
let routePath: { lat: number; lng: number }[] = [];
let suggestions: Suggestion[] = [];

describe('Stopover suggestions stay on the route', () => {
  it('TC-STOPSUG-001: sets a Tallinn → Tartu draft and selects a route', async () => {
    const originRes = await da.post('/publish-ride/draft/origin', {
      originPlaceId: TALLINN.placeId,
      originAddress: TALLINN.address,
      originLat: TALLINN.lat,
      originLng: TALLINN.lng,
    });

    if (![200, 201].includes(originRes.status)) {
      console.warn(
        `Skipping stopover-suggestion tests: origin rejected (status ${originRes.status}). ` +
        'For a mock-mode server run with E2E_TALLINN_PLACE_ID=mock_tallinn ' +
        'E2E_TARTU_PLACE_ID=mock_tartu.',
      );
      routeAvailable = false;
      return;
    }

    const destRes = await da.put('/publish-ride/draft/destination', {
      destinationPlaceId: TARTU.placeId,
      destinationAddress: TARTU.address,
      destinationLat: TARTU.lat,
      destinationLng: TARTU.lng,
    });
    expect(destRes.status).toBe(200);

    const computeRes = await da.get('/publish-ride/draft/routes/compute');
    if (computeRes.status !== 200) {
      console.warn(`Skipping stopover-suggestion tests: route compute unavailable (status ${computeRes.status})`);
      routeAvailable = false;
      return;
    }

    const body = computeRes.data.data ?? computeRes.data;
    const routes = body.routes ?? body;
    expect(Array.isArray(routes)).toBe(true);
    expect(routes.length).toBeGreaterThan(0);

    routePath = polyline.decode(routes[0].polyline).map(([lat, lng]: number[]) => ({ lat, lng }));
    expect(routePath.length).toBeGreaterThan(1);

    const selectRes = await da.put('/publish-ride/draft/routes/select', { routeIndex: 0 });
    expect(selectRes.status).toBe(200);
  });

  it('TC-STOPSUG-002: every suggestion sits inside the route corridor', async () => {
    if (!routeAvailable) return;

    const res = await da.get('/publish-ride/draft/stopovers/suggestions');
    expect(res.status).toBe(200);

    const body = res.data.data ?? res.data;
    suggestions = body.suggestions as Suggestion[];
    expect(Array.isArray(suggestions)).toBe(true);
    // A ~185 km intercity route must pass through at least one town.
    expect(suggestions.length).toBeGreaterThan(0);
    console.log('[stopover suggestions]', suggestions.map((suggestion) => `${suggestion.isMajorTown ? 'TOWN' : 'village'} ${suggestion.name} @${Math.round(suggestion.distanceFromOriginMeters / 1000)}km (${Math.round(distanceFromRouteMeters(suggestion, routePath))}m off route)`).join(', '));

    const offRoute = suggestions
      .map((suggestion) => ({
        name: suggestion.name,
        offRouteMeters: Math.round(distanceFromRouteMeters(suggestion, routePath)),
      }))
      .filter((entry) => entry.offRouteMeters > CORRIDOR_MAX_METERS);

    expect(offRoute).toEqual([]);
  });

  it('TC-STOPSUG-003: towns come before villages, each in route order, endpoints excluded', async () => {
    if (!routeAvailable || suggestions.length === 0) return;

    // No village may precede a town.
    const ranks = suggestions.map((suggestion) => (suggestion.isMajorTown ? 0 : 1));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    // Within each group, route order holds.
    for (const isTown of [true, false]) {
      const distances = suggestions
        .filter((suggestion) => Boolean(suggestion.isMajorTown) === isTown)
        .map((suggestion) => suggestion.distanceFromOriginMeters);
      expect(distances).toEqual([...distances].sort((a, b) => a - b));
    }

    const placeIds = suggestions.map((suggestion) => suggestion.placeId);
    expect(placeIds).not.toContain(TALLINN.placeId);
    expect(placeIds).not.toContain(TARTU.placeId);
    expect(new Set(placeIds).size).toBe(placeIds.length);
  });

  it('TC-STOPSUG-004: a suggested town can be saved as a stopover', async () => {
    if (!routeAvailable || suggestions.length === 0) return;

    // suggestions[0] is the first town when the route passes through one.
    const suggested = suggestions[0];
    const res = await da.put('/publish-ride/draft/stopovers', {
      stopovers: [
        {
          placeId: suggested.placeId,
          address: suggested.address,
          lat: suggested.lat,
          lng: suggested.lng,
          parentPlaceId: suggested.placeId,
          parentAddress: suggested.address,
          parentLat: suggested.lat,
          parentLng: suggested.lng,
        },
      ],
    });

    // The regression: a suggestion the API offered must not be rejected on save.
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.data)).not.toContain('MEETING_POINT_OUTSIDE_ROUTE');
  });
});
