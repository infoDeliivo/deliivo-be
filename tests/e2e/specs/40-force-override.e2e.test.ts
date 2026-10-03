/**
 * E2E — Driver force override on in-ride operations
 * Covers: TC-FORCE-001 through TC-FORCE-009
 *
 * A driver stuck behind a guard sends `force: true` with a written
 * `overrideReason`. Forcing is only accepted while the ride is IN_PROGRESS,
 * never bypasses ownership, and always reports the guards it skipped.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, futureDateStr } from '../helpers/ride.helper';

/**
 * Publishing is restricted to Estonia, Latvia and Lithuania and the country is
 * resolved from a real Google place id, so the shared UK fixture cannot be used
 * and the ids have to be looked up rather than invented.
 */
const TALLINN_TO_TARTU = {
  originPlaceId: '',
  originAddress: 'Tallinn, Estonia',
  originLat: 59.437,
  originLng: 24.7536,
  destinationPlaceId: '',
  destinationAddress: 'Tartu, Estonia',
  destinationLat: 58.378,
  destinationLng: 26.729,
};

/** Resolves a real Google place id through the app's own maps endpoint. */
const lookUpPlaceId = async (input: string): Promise<string> => {
  const res = await da.get('/maps/place/autocomplete', { input, scope: 'baltic' });
  if (res.status !== 200) throw new Error(`Autocomplete failed for "${input}": ${res.status}`);

  const body = res.data.data ?? res.data;
  const predictions = (Array.isArray(body) ? body : body.predictions ?? []) as Array<Record<string, unknown>>;
  const placeId = predictions[0]?.place_id ?? predictions[0]?.placeId;

  if (typeof placeId !== 'string') throw new Error(`No place id returned for "${input}"`);
  return placeId;
};

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

const REASON = 'Rider phone was dead, verified their ID instead';
const FORCED = { force: true, overrideReason: REASON };

let rideId: string;
let bookingId: string;
/** A second ride that is never started, to prove forcing needs a live ride. */
let unstartedRideId: string;
let unstartedBookingId: string;

const data = (res: { data: { data?: unknown } }) => (res.data.data ?? res.data) as Record<string, unknown>;

const setUpRide = async (seats: number, daysFromNow: number) => {
  const id = await publishRide(state.driverA.accessToken, {
    ...TALLINN_TO_TARTU,
    totalSeats: seats,
    basePricePerSeat: 18.0,
    currency: 'EUR',
    departureDate: futureDateStr(daysFromNow),
    // Sitting the meeting points on the endpoints keeps them on the route.
    pickups: [{
      placeId: TALLINN_TO_TARTU.originPlaceId,
      address: TALLINN_TO_TARTU.originAddress,
      lat: TALLINN_TO_TARTU.originLat,
      lng: TALLINN_TO_TARTU.originLng,
    }],
    dropoffs: [{
      placeId: TALLINN_TO_TARTU.destinationPlaceId,
      address: TALLINN_TO_TARTU.destinationAddress,
      lat: TALLINN_TO_TARTU.destinationLat,
      lng: TALLINN_TO_TARTU.destinationLng,
    }],
  });

  // The ride carries meeting-point waypoints and booking insists on choosing one of each.
  const detailRes = await da.get(`/publish-ride/${id}`);
  const detail = data(detailRes);
  const waypoints = (detail.waypoints ?? (detail.ride as Record<string, unknown> | undefined)?.waypoints ?? []) as Array<Record<string, unknown>>;
  if (!waypoints.length) {
    throw new Error(`Ride detail returned no waypoints: ${JSON.stringify(detail).slice(0, 400)}`);
  }
  const pickupWaypointId = waypoints.find((w) => w.waypointType === 'PICKUP')?.id;
  const dropoffWaypointId = waypoints.find((w) => w.waypointType === 'DROPOFF')?.id;

  const bookRes = await pa.post('/bookings', {
    rideId: id,
    seatsBooked: 1,
    ...(typeof pickupWaypointId === 'string' ? { pickupWaypointId } : {}),
    ...(typeof dropoffWaypointId === 'string' ? { dropoffWaypointId } : {}),
  });
  if (bookRes.status !== 200 && bookRes.status !== 201) {
    throw new Error(`Booking failed: ${bookRes.status} ${JSON.stringify(bookRes.data)}`);
  }
  const booking = String(data(bookRes).id ?? '');

  const acceptRes = await da.post(`/driver/bookings/${booking}/accept`);
  if (acceptRes.status !== 200) {
    throw new Error(`Accept failed: ${acceptRes.status} ${JSON.stringify(acceptRes.data)}`);
  }

  return { id, booking };
};

beforeAll(async () => {
  try {
    // Signup collects no date of birth, and booking refuses a passenger without one.
    const profileRes = await pa.put('/users/me', { dob: '1990-05-20' });
    if (profileRes.status !== 200) {
      throw new Error(`Could not set passenger dob: ${profileRes.status} ${JSON.stringify(profileRes.data)}`);
    }

    TALLINN_TO_TARTU.originPlaceId = await lookUpPlaceId('Tallinn, Estonia');
    TALLINN_TO_TARTU.destinationPlaceId = await lookUpPlaceId('Tartu, Estonia');

    const live = await setUpRide(2, 60);
    rideId = live.id;
    bookingId = live.booking;

    // A different day, or the driver's two rides collide on the schedule.
    const idle = await setUpRide(2, 75);
    unstartedRideId = idle.id;
    unstartedBookingId = idle.booking;

    // Only the first ride is started — the second stays PUBLISHED on purpose.
    await da.post(`/rides/${rideId}/start`, {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[40-force-override] Could not set up rides — tests will skip: ${message}`);
  }
});

afterAll(async () => {
  for (const id of [rideId, unstartedRideId]) {
    if (id) await da.delete(`/publish-ride/${id}`).catch(() => {});
  }
});

describe('TC-FORCE-000 — setup actually produced a live ride', () => {
  // Without this the whole suite would pass by skipping, which is how the
  // earlier ride specs hid a broken publish path.
  it('has a started ride with an accepted booking', () => {
    expect(rideId).toBeTruthy();
    expect(bookingId).toBeTruthy();
    expect(unstartedBookingId).toBeTruthy();
  });
});

describe('TC-FORCE-001 — force needs a written reason', () => {
  it('rejects force:true with no overrideReason', async () => {
    if (!bookingId) return;
    const res = await da.post(`/bookings/${bookingId}/mark-no-show`, { force: true });
    expect(res.status).toBe(400);
  });

  it('rejects a reason too short to explain anything', async () => {
    if (!bookingId) return;
    const res = await da.post(`/bookings/${bookingId}/mark-no-show`, { force: true, overrideReason: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('TC-FORCE-002 — force never bypasses ownership', () => {
  it('returns 403 for a driver who does not own the ride', async () => {
    if (!bookingId) return;
    const res = await pa.post(`/bookings/${bookingId}/confirm-dropoff`, FORCED);
    expect([403, 404]).toContain(res.status);
  });
});

describe('TC-FORCE-003 — force only works on a ride in progress', () => {
  it('returns 409 when the ride was never started', async () => {
    if (!unstartedBookingId) return;
    const res = await da.post(`/bookings/${unstartedBookingId}/mark-no-show`, FORCED);
    expect(res.status).toBe(409);
  });
});

describe('TC-FORCE-004 — start ride is not forceable', () => {
  it('still refuses to start an already started ride', async () => {
    if (!rideId) return;
    const res = await da.post(`/rides/${rideId}/start`, FORCED);
    expect([400, 409]).toContain(res.status);
  });
});

describe('TC-FORCE-005 — forced boarding without a valid OTP', () => {
  it('boards the passenger and reports the skipped OTP check', async () => {
    if (!bookingId) return;
    const res = await da.post(`/bookings/${bookingId}/verify-pickup-otp`, FORCED);
    expect(res.status).toBe(200);

    const body = data(res);
    expect(body.status).toBe('ONBOARD');
    expect(body.forced).toBe(true);
    expect(body.overrideReason).toBe(REASON);
    expect(body.skippedChecks).toEqual(expect.arrayContaining(['INVALID_PICKUP_OTP']));
  });
});

describe('TC-FORCE-006 — unforced calls still hit their guard', () => {
  it('refuses a drop-off confirmation for a booking in the wrong state', async () => {
    if (!unstartedBookingId) return;
    const res = await da.post(`/bookings/${unstartedBookingId}/confirm-dropoff`, {});
    expect([400, 409]).toContain(res.status);
  });
});

describe('TC-FORCE-007 — forced drop-off', () => {
  it('moves the booking to DROP_PENDING', async () => {
    if (!bookingId) return;
    const res = await da.post(`/bookings/${bookingId}/confirm-dropoff`, FORCED);
    expect(res.status).toBe(200);
    expect(data(res).status).toBe('DROP_PENDING');
  });
});

describe('TC-FORCE-008 — forced finish over an open booking', () => {
  it('completes the ride and names the booking it left open', async () => {
    if (!rideId) return;
    const res = await da.post(`/rides/${rideId}/finish`, FORCED);
    expect(res.status).toBe(200);

    const body = data(res);
    expect(body.status).toBe('COMPLETED');
    expect(body.forced).toBe(true);
    expect(body.skippedChecks).toEqual(expect.arrayContaining(['BOOKINGS_NOT_ALL_TERMINAL']));
  });
});

describe('TC-FORCE-009 — a finished ride can no longer be forced', () => {
  it('returns 409 once the ride is complete', async () => {
    if (!bookingId) return;
    const res = await da.post(`/bookings/${bookingId}/mark-no-show`, FORCED);
    expect(res.status).toBe(409);
  });
});
