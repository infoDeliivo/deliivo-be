/**
 * E2E — Ride start window (RIDE_START_EARLY_LIMIT_MINUTES)
 * Covers: TC-STARTWINDOW-001 through TC-STARTWINDOW-003
 *
 * With RIDE_START_EARLY_LIMIT_MINUTES unset (the default), a driver may start a
 * ride at any time — including long before the scheduled departure. Both start
 * endpoints are covered: POST /publish-ride/:id/start and POST /rides/:id/start.
 *
 * The wizard is walked inline rather than through `publishRide()` because this
 * spec needs a Baltic route (publishing is restricted to EE/LV/LT) plus explicit
 * pickup and drop-off points, which the shared helper does not set.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);

const earlyLimit = process.env.RIDE_START_EARLY_LIMIT_MINUTES?.trim();
const startWindowEnforced = Boolean(earlyLimit);

const TALLINN = { placeId: 'ChIJvxZW35mUkkYRcGL8GG2zAAQ', address: 'Tallinn, Estonia', lat: 59.437, lng: 24.7536 };
const TARTU = { placeId: 'ChIJ9z1d1dg260YREG38GG2zAAQ', address: 'Tartu, Estonia', lat: 58.378, lng: 26.729 };

let publishRideId: string;
let opsRideId: string;

const step = async (
  label: string,
  call: () => Promise<{ status: number; data: unknown }>
): Promise<{ status: number; data: unknown }> => {
  const res = await call();
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`${label} failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res;
};

/**
 * Publishes a Tallinn → Tartu ride far in the future. Returns the rideId.
 * Each call needs its own departure slot — a driver cannot hold two overlapping rides.
 */
const publishFarFutureRide = async (daysFromNow: number, departureTime: string): Promise<string> => {
  await step('origin', () =>
    da.post('/publish-ride/draft/origin', {
      originPlaceId: TALLINN.placeId,
      originAddress: TALLINN.address,
      originLat: TALLINN.lat,
      originLng: TALLINN.lng,
    })
  );
  await step('destination', () =>
    da.put('/publish-ride/draft/destination', {
      destinationPlaceId: TARTU.placeId,
      destinationAddress: TARTU.address,
      destinationLat: TARTU.lat,
      destinationLng: TARTU.lng,
    })
  );
  await step('pickups', () => da.put('/publish-ride/draft/pickups', { pickups: [TALLINN] }));
  await step('dropoffs', () => da.put('/publish-ride/draft/dropoffs', { dropoffs: [TARTU] }));
  await step('compute routes', () => da.get('/publish-ride/draft/routes/compute'));
  await step('select route', () => da.put('/publish-ride/draft/routes/select', { routeIndex: 0 }));
  await step('schedule', () =>
    da.put('/publish-ride/draft/schedule', { departureDate: futureDateStr(daysFromNow), departureTime })
  );
  await step('capacity', () =>
    da.put('/publish-ride/draft/capacity', { totalSeats: 2, maxLuggagePerPerson: 1, backSeatOnly: false })
  );
  await step('pricing', () =>
    da.put('/publish-ride/draft/pricing', { basePricePerSeat: 12.5, currency: 'EUR' })
  );

  const publishRes = await step(`publish(day+${daysFromNow} ${departureTime})`, () => da.post('/publish-ride/draft/publish'));
  const body = publishRes.data as { data?: { id?: string; rideId?: string }; id?: string };
  const rideId = body.data?.id ?? body.data?.rideId ?? body.id;
  if (!rideId) throw new Error(`Publish returned no rideId: ${JSON.stringify(publishRes.data)}`);
  return rideId;
};

beforeAll(async () => {
  try {
    publishRideId = await publishFarFutureRide(45, '09:00');
    opsRideId = await publishFarFutureRide(60, '14:00');
  } catch (err) {
    console.warn(`[37-ride-start-window] Could not publish ride: ${(err as Error).message}`);
  }
});

afterAll(async () => {
  if (publishRideId) await da.delete(`/publish-ride/${publishRideId}`).catch(() => {});
  if (opsRideId) await da.delete(`/publish-ride/${opsRideId}`).catch(() => {});
});

describe('TC-STARTWINDOW-001 — publish-ride start accepts a far-future ride', () => {
  it('transitions the ride to IN_PROGRESS weeks before departure', async () => {
    if (startWindowEnforced) return;
    expect(publishRideId).toBeDefined();

    const res = await da.post(`/publish-ride/${publishRideId}/start`);
    expect([200, 201]).toContain(res.status);

    const detail = await da.get(`/publish-ride/${publishRideId}`);
    const ride = detail.data.data ?? detail.data;
    expect(ride.status).toBe('IN_PROGRESS');
  });
});

describe('TC-STARTWINDOW-002 — ride-operations start accepts a far-future ride', () => {
  it('transitions the ride to IN_PROGRESS weeks before departure', async () => {
    if (startWindowEnforced) return;
    expect(opsRideId).toBeDefined();

    const res = await da.post(`/rides/${opsRideId}/start`, {});
    expect([200, 201]).toContain(res.status);

    const detail = await da.get(`/publish-ride/${opsRideId}`);
    const ride = detail.data.data ?? detail.data;
    expect(ride.status).toBe('IN_PROGRESS');
  });
});

describe('TC-STARTWINDOW-003 — start window is rejected when configured', () => {
  it('returns 409 RIDE_TOO_EARLY while a limit is set', async () => {
    if (!startWindowEnforced) return;
    expect(publishRideId).toBeDefined();

    const res = await da.post(`/publish-ride/${publishRideId}/start`);
    expect(res.status).toBe(409);
    expect(String(res.data.message ?? '')).toMatch(/cannot be started/i);
  });
});
