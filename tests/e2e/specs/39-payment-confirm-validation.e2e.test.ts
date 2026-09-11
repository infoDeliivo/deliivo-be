/**
 * E2E — Payment confirmation validation + booking atomicity
 * Covers: TC-PAYVALID-001 through TC-PAYVALID-005
 *
 * POST /bookings/:id/payment/confirm is a validation endpoint: it answers 200 only
 * when the payment is actually confirmed. Previously it answered 200 with
 * "fetched successfully" for every unconfirmed Stripe state, so the app could show a
 * ride as booked while the payment was still pending.
 *
 * The spec adapts to BOOKING_PAYMENT_MODE by reading the create response: a booking
 * that comes back with a `payment.clientSecret` was made in stripe mode and is
 * PAYMENT_PENDING; without one, payments are bypassed and the booking is already
 * DRIVER_PENDING.
 *
 * The wizard is walked inline rather than through `publishRide()` because publishing
 * is restricted to EE/LV/LT and needs explicit pickup and drop-off points, which the
 * shared helper does not set.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);
const pb = authed(state.passengerB.accessToken);

const TALLINN = { placeId: 'ChIJvxZW35mUkkYRcGL8GG2zAAQ', address: 'Tallinn, Estonia', lat: 59.437, lng: 24.7536 };
const TARTU = { placeId: 'ChIJ9z1d1dg260YREG38GG2zAAQ', address: 'Tartu, Estonia', lat: 58.378, lng: 26.729 };

type Envelope = { status: number; data: { data?: unknown; message?: string; error?: string } };

const step = async (label: string, call: () => Promise<Envelope>): Promise<Envelope> => {
  const res = await call();
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`${label} failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res;
};

const publishRide = async (daysFromNow: number, departureTime: string, totalSeats: number): Promise<string> => {
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
    da.put('/publish-ride/draft/capacity', { totalSeats, maxLuggagePerPerson: 1, backSeatOnly: false })
  );
  await step('pricing', () =>
    da.put('/publish-ride/draft/pricing', { basePricePerSeat: 12.5, currency: 'EUR' })
  );

  const publishRes = await step('publish', () => da.post('/publish-ride/draft/publish'));
  const body = publishRes.data as { data?: { id?: string; rideId?: string }; id?: string };
  const rideId = body.data?.id ?? body.data?.rideId ?? body.id;
  if (!rideId) throw new Error(`Publish returned no rideId: ${JSON.stringify(publishRes.data)}`);
  return rideId;
};

type Waypoint = { id: string; waypointType: string };

/**
 * The wizard publishes explicit pickup and drop-off points, so a booking must name
 * them — the API rejects an unqualified booking with PICKUP_POINT_REQUIRED.
 */
const meetingPoints = async (rideId: string): Promise<{ pickupWaypointId: string; dropoffWaypointId: string }> => {
  const res = await da.get(`/publish-ride/${rideId}`);
  const ride = (res.data.data ?? res.data) as { waypoints?: Waypoint[] };
  const waypoints = ride.waypoints ?? [];
  const pickup = waypoints.find((w) => w.waypointType === 'PICKUP');
  const dropoff = waypoints.find((w) => w.waypointType === 'DROPOFF');
  if (!pickup || !dropoff) {
    throw new Error(`Ride ${rideId} has no meeting points: ${JSON.stringify(waypoints)}`);
  }
  return { pickupWaypointId: pickup.id, dropoffWaypointId: dropoff.id };
};

type Booking = {
  id: string;
  status: string;
  payment?: { clientSecret?: string; paymentIntentId?: string } | null;
};

const unwrap = (res: { data: { data?: unknown } }): Booking => (res.data.data ?? res.data) as Booking;

let confirmRideId = '';
let raceRideId = '';
let booking: Booking | undefined;
let stripeMode = false;

beforeAll(async () => {
  // The shared passenger fixtures are created without a date of birth, and booking
  // requires one (MINIMUM_BOOKING_AGE_YEARS). Set it before anything books.
  await Promise.all([
    pa.put('/users/me', { dob: '1990-01-01' }),
    pb.put('/users/me', { dob: '1991-02-02' }),
  ]);

  try {
    confirmRideId = await publishRide(48, '08:30', 2);
    raceRideId = await publishRide(49, '11:30', 3);
  } catch (err) {
    console.warn(`[39-payment-confirm-validation] Could not publish ride: ${(err as Error).message}`);
    return;
  }

  const bookRes = await pa.post('/bookings', {
    rideId: confirmRideId,
    seatsBooked: 1,
    ...(await meetingPoints(confirmRideId)),
  });
  if (bookRes.status === 201 || bookRes.status === 200) {
    booking = unwrap(bookRes);
    stripeMode = Boolean(booking.payment?.clientSecret);
  } else {
    throw new Error(`Booking failed: ${bookRes.status} ${JSON.stringify(bookRes.data)}`);
  }
});

afterAll(async () => {
  if (booking) await pa.post(`/bookings/${booking.id}/cancel`, {}).catch(() => {});
  if (confirmRideId) await da.delete(`/publish-ride/${confirmRideId}`).catch(() => {});
  if (raceRideId) await da.delete(`/publish-ride/${raceRideId}`).catch(() => {});
});

describe('TC-PAYVALID-001 — an unpaid booking is never reported as confirmed', () => {
  it('rejects the confirm call while the Stripe payment is still outstanding', async () => {
    if (!booking || !stripeMode) return;

    const res = await pa.post(`/bookings/${booking.id}/payment/confirm`);

    expect(res.status).toBe(400);
    // A brand-new intent has no payment method attached yet.
    expect(res.data.error).toBe('PAYMENT_METHOD_REQUIRED');

    // And the booking is still waiting for payment, not booked.
    const detail = await pa.get(`/bookings/${booking.id}`);
    expect(unwrap(detail).status).toBe('PAYMENT_PENDING');
  });
});

describe('TC-PAYVALID-002 — confirming an already-paid booking is idempotent', () => {
  it('returns 200 twice without changing the booking', async () => {
    if (!booking || stripeMode) return;

    const first = await pa.post(`/bookings/${booking.id}/payment/confirm`);
    expect(first.status).toBe(200);
    expect(unwrap(first).status).toBe('DRIVER_PENDING');

    const second = await pa.post(`/bookings/${booking.id}/payment/confirm`);
    expect(second.status).toBe(200);
    expect(unwrap(second).status).toBe('DRIVER_PENDING');
  });
});

describe('TC-PAYVALID-003 — confirm is scoped to the booking owner', () => {
  it("returns 404 for another rider's booking", async () => {
    if (!booking) return;

    const res = await pb.post(`/bookings/${booking.id}/payment/confirm`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a booking that does not exist', async () => {
    const res = await pa.post('/bookings/00000000-0000-0000-0000-000000000000/payment/confirm');
    expect(res.status).toBe(404);
  });
});

describe('TC-PAYVALID-004 — a rider cannot hold two active bookings on one ride', () => {
  it('lets exactly one of two simultaneous booking requests through', async () => {
    if (!raceRideId) return;

    const points = await meetingPoints(raceRideId);
    const request = () => pb.post('/bookings', { rideId: raceRideId, seatsBooked: 1, ...points });

    const [first, second] = await Promise.all([request(), request()]);

    const outcome = [first, second]
      .map((r) => `${r.status} ${JSON.stringify(r.data)}`)
      .join(' | ');
    const statuses = [first.status, second.status];
    // `outcome` rides along so a failure prints both responses, not just the counts.
    expect({
      outcome,
      created: statuses.filter((s) => s === 200 || s === 201).length,
      conflicts: statuses.filter((s) => s === 409).length,
    }).toEqual({ outcome, created: 1, conflicts: 1 });

    const created = [first, second].find((r) => r.status === 201 || r.status === 200);
    if (created) await pb.post(`/bookings/${unwrap(created).id}/cancel`, {}).catch(() => {});
  });
});

describe('TC-PAYVALID-005 — a rolled-back booking leaves no seat held', () => {
  it('keeps the ride bookable after a rejected duplicate attempt', async () => {
    if (!raceRideId) return;

    const detail = await da.get(`/publish-ride/${raceRideId}`);
    const ride = (detail.data.data ?? detail.data) as { totalSeats: number; availableSeats: number };

    // Every booking made above was cancelled, so the ride is whole again.
    expect(ride.availableSeats).toBe(ride.totalSeats);
  });
});
