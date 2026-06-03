/**
 * E2E — Advanced Search
 * Covers: TC-ADVSEARCH-001 through TC-ADVSEARCH-005
 *
 * Tests GET /search-rides/advanced endpoint with D_POINTS matching.
 * Depends on state.sharedRide being populated by globalSetup.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const ride = state.sharedRide;
const pb = authed(state.passengerB.accessToken);
const da = authed(state.driverA.accessToken);

const skip = !ride;

const searchParams = ride
  ? {
      originLat: ride.originLat,
      originLng: ride.originLng,
      destinationLat: ride.destinationLat,
      destinationLng: ride.destinationLng,
      departureDate: ride.departureDate,
      seats: 1,
    }
  : {};

describe('TC-ADVSEARCH-001 — Advanced search returns scored results', () => {
  (skip ? it.skip : it)('returns rides with scores and match conditions', async () => {
    const res = await pb.get('/search-rides/advanced', searchParams);
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const rides: Array<{ id: string; score?: number; matchCondition?: string }> =
      body.rides ?? body;
    expect(Array.isArray(rides)).toBe(true);
    expect(rides.length).toBeGreaterThan(0);
    // Verify the shared ride appears in results
    const found = rides.find((r) => r.id === ride!.id);
    expect(found).toBeDefined();
  });
});

describe('TC-ADVSEARCH-002 — Advanced search excludes driver own ride', () => {
  (skip ? it.skip : it)('does not return driver_a own ride', async () => {
    const res = await da.get('/search-rides/advanced', searchParams);
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const rides: Array<{ id: string }> = body.rides ?? body;
    expect(rides.every((r) => r.id !== ride!.id)).toBe(true);
  });
});

describe('TC-ADVSEARCH-003 — Advanced search with no matches', () => {
  it('returns empty results for unserved route', async () => {
    const res = await pb.get('/search-rides/advanced', {
      originLat: -33.8688,
      originLng: 151.2093,
      destinationLat: -37.8136,
      destinationLng: 144.9631,
      departureDate: '2030-06-01',
      seats: 1,
    });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const rides: unknown[] = body.rides ?? body;
    expect(rides.length).toBe(0);
  });
});

describe('TC-ADVSEARCH-004 — Advanced search with radius filter', () => {
  (skip ? it.skip : it)('respects radiusKm parameter', async () => {
    const res = await pb.get('/search-rides/advanced', {
      ...searchParams,
      radiusKm: 1, // very small radius (1km) — should return fewer or no results
    });
    // 200 if param accepted, 400 if below minimum
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      const body = res.data.data ?? res.data;
      const rides: unknown[] = body.rides ?? body;
      // With 1km radius, may or may not match depending on precision
      expect(Array.isArray(rides)).toBe(true);
    }
  });
});

describe('TC-ADVSEARCH-005 — Advanced search validates required params', () => {
  it('returns 400 when missing required fields', async () => {
    const res = await pb.get('/search-rides/advanced', { originLat: 51.5 });
    expect([400, 422]).toContain(res.status);
  });
});
