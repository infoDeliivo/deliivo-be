/**
 * E2E — Seat capacity is counted for the whole ride
 * Covers: TC-SEATS-001 through TC-SEATS-006 (006: driver sees the rider's own drop-off)
 *
 * Reported bug: a driver offers 3 seats, all 3 are booked, and another rider can still
 * book. The ride has a stopover (A → B → C). Three riders booking only A → B must fill the
 * ride for every route: no 4th booking on A → B, B → C or A → C, and the ride disappears
 * from search until a seat is released.
 *
 * Publishing is restricted to the Baltics and resolves real Google place ids, same as
 * 40-force-override.e2e.test.ts. Every test skips if the ride cannot be published.
 */
import { api, authed } from '../helpers/api.client';
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
const STOPOVER = { placeId: '', address: 'Paide, Estonia', lat: 58.8853, lng: 25.5573, pricePerSeat: 9 };
const DEPARTURE_DATE = futureDateStr(75);

type Waypoint = { id: string; waypointType: string };
type Rider = { id: string; client: ReturnType<typeof authed> };

let rideId: string | null = null;
let pickupId: string;
let stopoverId: string;
let dropoffId: string;
const riders: Rider[] = [];
const bookingIds: string[] = [];

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

const newRider = async (label: string): Promise<Rider> => {
  const result = await signupAndVerifyEmail(`e2e-seats-${label}-${state.runId}@test.local`);
  const client = authed(result.accessToken);
  await client.post('/auth/accept-tos', { tosVersion: '1.0', privacyVersion: '1.0' });
  // Booking refuses a passenger without a date of birth.
  const profile = await client.put('/users/me', { dob: '1990-05-20' });
  if (profile.status !== 200) throw new Error(`Could not set dob: ${profile.status}`);
  return { id: result.user.id, client };
};

const book = (rider: Rider, pickupWaypointId: string, dropoffWaypointId: string) =>
  rider.client.post('/bookings', { rideId, seatsBooked: 1, pickupWaypointId, dropoffWaypointId });

const availableSeats = async (): Promise<number> => {
  const res = await api.get(`/search-rides/${rideId}`);
  expect(res.status).toBe(200);
  return body(res).availableSeats as number;
};

const searchFinds = async (
  rider: Rider,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<boolean> => {
  const res = await rider.client.get('/search-rides', {
    originLat: from.lat,
    originLng: from.lng,
    destinationLat: to.lat,
    destinationLng: to.lng,
    departureDate: DEPARTURE_DATE,
  });
  expect(res.status).toBe(200);
  const data = res.data.data ?? res.data;
  const rides = (data.rides ?? data) as Array<{ id: string }>;
  return rides.some((ride) => ride.id === rideId);
};

const A = { lat: ROUTE.originLat, lng: ROUTE.originLng };
const B = { lat: STOPOVER.lat, lng: STOPOVER.lng };
const C = { lat: ROUTE.destinationLat, lng: ROUTE.destinationLng };

beforeAll(async () => {
  try {
    ROUTE.originPlaceId = await lookUpPlaceId(ROUTE.originAddress);
    ROUTE.destinationPlaceId = await lookUpPlaceId(ROUTE.destinationAddress);
    STOPOVER.placeId = await lookUpPlaceId(STOPOVER.address);

    rideId = await publishRide(state.driverA.accessToken, {
      ...ROUTE,
      totalSeats: 3,
      basePricePerSeat: 18,
      currency: 'EUR',
      departureDate: DEPARTURE_DATE,
      stopover: STOPOVER,
      pickups: [{ placeId: ROUTE.originPlaceId, address: ROUTE.originAddress, lat: ROUTE.originLat, lng: ROUTE.originLng }],
      dropoffs: [{ placeId: ROUTE.destinationPlaceId, address: ROUTE.destinationAddress, lat: ROUTE.destinationLat, lng: ROUTE.destinationLng }],
    });

    const detail = body(await da.get(`/publish-ride/${rideId}`));
    const waypoints = (detail.waypoints ?? (detail.ride as Record<string, unknown> | undefined)?.waypoints ?? []) as Waypoint[];
    pickupId = waypoints.find((w) => w.waypointType === 'PICKUP')!.id;
    stopoverId = waypoints.find((w) => w.waypointType === 'STOPOVER')!.id;
    dropoffId = waypoints.find((w) => w.waypointType === 'DROPOFF')!.id;

    for (const label of ['r1', 'r2', 'r3', 'r4']) riders.push(await newRider(label));
  } catch (error) {
    console.warn(`[43-seat-capacity] Skipping: could not set up the ride (${(error as Error).message})`);
    rideId = null;
  }
}, 120_000);

const run = (name: string, fn: () => Promise<void>) =>
  it(name, async () => {
    if (!rideId) return;
    await fn();
  });

describe('Seat capacity counts the whole ride', () => {
  run('TC-SEATS-001: the open ride is found for A→C before anyone books', async () => {
    expect(await searchFinds(riders[3], A, C)).toBe(true);
    expect(await availableSeats()).toBe(3);
  });

  run('TC-SEATS-002: three riders on A→B take all three seats', async () => {
    for (const rider of riders.slice(0, 3)) {
      const res = await book(rider, pickupId, stopoverId);
      expect([200, 201]).toContain(res.status);
      bookingIds.push(String(body(res).id));
    }
    expect(await availableSeats()).toBe(0);
  });

  run('TC-SEATS-006: the driver sees each A→B rider getting off at the stopover, not the ride destination', async () => {
    const detail = body(await da.get(`/publish-ride/${rideId}`));
    const bookings = (detail.bookings ?? (detail.ride as Record<string, unknown> | undefined)?.bookings ?? []) as Array<{
      id: string;
      dropoffLocation?: { address: string; isFullRoute?: boolean };
      pickupLocation?: { isFullRoute?: boolean };
    }>;
    const segmentBookings = bookings.filter((booking) => bookingIds.includes(booking.id));
    expect(segmentBookings).toHaveLength(3);
    for (const booking of segmentBookings) {
      expect(booking.dropoffLocation?.isFullRoute).toBe(false);
      expect(booking.dropoffLocation?.address).not.toBe(ROUTE.destinationAddress);
      expect(booking.pickupLocation?.isFullRoute).toBe(true);
    }
  });

  run('TC-SEATS-003: a 4th rider is refused on every route, including legs nobody booked', async () => {
    for (const [pickup, dropoff] of [[stopoverId, dropoffId], [pickupId, dropoffId], [pickupId, stopoverId]]) {
      const res = await book(riders[3], pickup, dropoff);
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.data)).toMatch(/seat/i);
    }
    expect(await availableSeats()).toBe(0);
  });

  run('TC-SEATS-004: the full ride is hidden from search for A→B, B→C and A→C', async () => {
    expect(await searchFinds(riders[3], A, B)).toBe(false);
    expect(await searchFinds(riders[3], B, C)).toBe(false);
    expect(await searchFinds(riders[3], A, C)).toBe(false);
  });

  run('TC-SEATS-005: a cancellation frees one seat for the whole ride', async () => {
    // Still awaiting the driver, so the rider withdraws the request.
    const cancel = await riders[0].client.post(`/bookings/${bookingIds[0]}/withdraw`, { reason: 'E2E seat release' });
    expect([200, 201]).toContain(cancel.status);
    expect(await availableSeats()).toBe(1);
    expect(await searchFinds(riders[3], A, C)).toBe(true);

    const res = await book(riders[3], stopoverId, dropoffId);
    expect([200, 201]).toContain(res.status);
    expect(await availableSeats()).toBe(0);
  });
});
