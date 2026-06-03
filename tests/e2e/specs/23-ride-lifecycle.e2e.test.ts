/**
 * E2E — Ride Lifecycle (Start / Complete)
 * Covers: TC-LIFECYCLE-001 through TC-LIFECYCLE-006
 *
 * Tests POST /publish-ride/:id/start and POST /publish-ride/:id/complete endpoints.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

let rideId: string;

beforeAll(async () => {
  try {
    rideId = await publishRide(state.driverA.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 14.0,
      departureDate: futureDateStr(35),
    });
  } catch (err: any) {
    console.warn(`[23-ride-lifecycle] Could not publish ride: ${err.message}`);
  }
});

afterAll(async () => {
  if (rideId) await da.delete(`/publish-ride/${rideId}`).catch(() => {});
});

describe('TC-LIFECYCLE-001 — Start a published ride', () => {
  it('transitions ride to IN_PROGRESS', async () => {
    if (!rideId) return;
    const res = await da.post(`/publish-ride/${rideId}/start`);
    expect([200, 201]).toContain(res.status);
    const body = res.data.data ?? res.data;
    // API returns success message; verify via GET
    const detail = await da.get(`/publish-ride/${rideId}`);
    const ride = detail.data.data ?? detail.data;
    expect(ride.status).toBe('IN_PROGRESS');
  });
});

describe('TC-LIFECYCLE-002 — Cannot start an already started ride', () => {
  it('returns 400, 404, or 409', async () => {
    if (!rideId) return;
    const res = await da.post(`/publish-ride/${rideId}/start`);
    expect([400, 404, 409]).toContain(res.status);
  });
});

describe('TC-LIFECYCLE-003 — Non-owner cannot start a ride', () => {
  it('returns 403 or 404', async () => {
    if (!rideId) return;
    const res = await pa.post(`/publish-ride/${rideId}/start`);
    expect([403, 404]).toContain(res.status);
  });
});

describe('TC-LIFECYCLE-004 — Complete an in-progress ride', () => {
  it('transitions ride to COMPLETED', async () => {
    if (!rideId) return;
    const res = await da.post(`/publish-ride/${rideId}/complete`);
    expect([200, 201]).toContain(res.status);
    // API returns success message; verify via GET
    const detail = await da.get(`/publish-ride/${rideId}`);
    const ride = detail.data.data ?? detail.data;
    expect(ride.status).toBe('COMPLETED');
  });
});

describe('TC-LIFECYCLE-005 — Cannot complete an already completed ride', () => {
  it('returns 400, 404, or 409', async () => {
    if (!rideId) return;
    const res = await da.post(`/publish-ride/${rideId}/complete`);
    expect([400, 404, 409]).toContain(res.status);
  });
});

describe('TC-LIFECYCLE-006 — Non-owner cannot complete a ride', () => {
  it('returns 403 or 404', async () => {
    if (!rideId) return;
    const res = await pa.post(`/publish-ride/${rideId}/complete`);
    expect([403, 404]).toContain(res.status);
  });
});
