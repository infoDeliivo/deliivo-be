/**
 * E2E — Rider and driver can each raise a dispute on the same booking
 * Covers: TC-DISPUTE2-001 through TC-DISPUTE2-004
 *
 * Reported bug: once the driver had reported an issue on a booking, the rider could no longer
 * raise one. Each side may have one open dispute of its own on a booking; only a second open
 * dispute from the same person is refused.
 *
 * Publishing is restricted to the Baltics and resolves real Google place ids, same as
 * 40-force-override.e2e.test.ts. Every test skips if the ride cannot be set up.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, futureDateStr } from '../helpers/ride.helper';
import { signupAndVerifyEmail } from '../helpers/auth.helper';

const state = readState();
const da = authed(state.driverA.accessToken);

const ROUTE = {
  originPlaceId: '',
  originAddress: 'Tallinn, Estonia',
  originLat: 59.437,
  originLng: 24.7536,
  destinationPlaceId: '',
  destinationAddress: 'Tartu, Estonia',
  destinationLat: 58.378,
  destinationLng: 26.729,
};

type DisputeRow = { id: string; bookingId: string; raisedBy: string; status: string };

let rideId: string | null = null;
let bookingId: string;
let riderId: string;
let rider: ReturnType<typeof authed>;

const body = (res: { data: { data?: unknown } }) => (res.data.data ?? res.data) as Record<string, unknown>;

const lookUpPlaceId = async (input: string): Promise<string> => {
  const res = await da.get('/maps/place/autocomplete', { input, scope: 'baltic' });
  if (res.status !== 200) throw new Error(`Autocomplete failed for "${input}": ${res.status}`);
  const data = res.data.data ?? res.data;
  const predictions = (Array.isArray(data) ? data : data.predictions ?? []) as Array<Record<string, unknown>>;
  const placeId = predictions[0]?.place_id ?? predictions[0]?.placeId;
  if (typeof placeId !== 'string') throw new Error(`No place id returned for "${input}"`);
  return placeId;
};

const disputesOnBooking = async (client: ReturnType<typeof authed>): Promise<DisputeRow[]> => {
  const res = await client.get('/disputes/me');
  expect(res.status).toBe(200);
  const rows = (res.data.data ?? res.data) as DisputeRow[];
  return rows.filter((row) => row.bookingId === bookingId);
};

beforeAll(async () => {
  try {
    ROUTE.originPlaceId = await lookUpPlaceId(ROUTE.originAddress);
    ROUTE.destinationPlaceId = await lookUpPlaceId(ROUTE.destinationAddress);

    rideId = await publishRide(state.driverA.accessToken, {
      ...ROUTE,
      totalSeats: 2,
      basePricePerSeat: 18,
      currency: 'EUR',
      departureDate: futureDateStr(80),
      pickups: [{ placeId: ROUTE.originPlaceId, address: ROUTE.originAddress, lat: ROUTE.originLat, lng: ROUTE.originLng }],
      dropoffs: [{ placeId: ROUTE.destinationPlaceId, address: ROUTE.destinationAddress, lat: ROUTE.destinationLat, lng: ROUTE.destinationLng }],
    });

    const detail = body(await da.get(`/publish-ride/${rideId}`));
    const waypoints = (detail.waypoints ?? (detail.ride as Record<string, unknown> | undefined)?.waypoints ?? []) as Array<{ id: string; waypointType: string }>;
    const pickupWaypointId = waypoints.find((w) => w.waypointType === 'PICKUP')?.id;
    const dropoffWaypointId = waypoints.find((w) => w.waypointType === 'DROPOFF')?.id;

    const signup = await signupAndVerifyEmail(`e2e-dispute2-rider-${state.runId}@test.local`);
    riderId = signup.user.id;
    rider = authed(signup.accessToken);
    await rider.post('/auth/accept-tos', { tosVersion: '1.0', privacyVersion: '1.0' });
    await rider.put('/users/me', { dob: '1990-05-20' });

    const bookRes = await rider.post('/bookings', { rideId, seatsBooked: 1, pickupWaypointId, dropoffWaypointId });
    if (bookRes.status !== 200 && bookRes.status !== 201) {
      throw new Error(`Booking failed: ${bookRes.status} ${JSON.stringify(bookRes.data)}`);
    }
    bookingId = String(body(bookRes).id);
  } catch (error) {
    console.warn(`[44-two-party-dispute] Skipping: could not set up the booking (${(error as Error).message})`);
    rideId = null;
  }
}, 120_000);

const run = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!rideId) return;
    await fn();
  });

describe('Two-party disputes on one booking', () => {
  run('TC-DISPUTE2-001: the driver raises a dispute', async () => {
    const res = await da.post('/disputes', { rideId, bookingId, reason: 'Rider behaviour', description: 'E2E driver report' });
    expect(res.status).toBe(201);
    expect(body(res).raisedBy).toBe(state.driverA.id);
  });

  run('TC-DISPUTE2-002: the rider can still raise their own dispute', async () => {
    const res = await rider.post('/disputes', { rideId, bookingId, reason: 'Driver behaviour', description: 'E2E rider report' });
    expect(res.status).toBe(201);
    expect(body(res).raisedBy).toBe(riderId);
  });

  run('TC-DISPUTE2-003: a second open dispute from the same person is refused', async () => {
    const riderAgain = await rider.post('/disputes', { rideId, bookingId, reason: 'Again' });
    expect(riderAgain.status).toBe(409);
    const driverAgain = await da.post('/disputes', { rideId, bookingId, reason: 'Again' });
    expect(driverAgain.status).toBe(409);
  });

  run('TC-DISPUTE2-004: both parties see both disputes, each marked with who raised it', async () => {
    for (const client of [rider, da]) {
      const rows = await disputesOnBooking(client);
      expect(rows.map((row) => row.raisedBy).sort()).toEqual([riderId, state.driverA.id].sort());
    }
  });
});
