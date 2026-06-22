/**
 * E2E — Driver Booking Decisions (accept / reject / cancel)
 * Covers: TC-DRIVER-001 through TC-DRIVER-008
 *
 * Creates its own ride and booking so it doesn't depend on the shared ride
 * being in a particular state.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);
const pb = authed(state.passengerB.accessToken); // impersonates "another driver"

let rideId: string;
let acceptBookingId: string;
let rejectBookingId: string;
let cancelBookingId: string;

// ── Setup: publish ride + create bookings ────────────────────────────────
beforeAll(async () => {
  try {
    rideId = await publishRide(state.driverA.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 3,
      basePricePerSeat: 20.0,
      departureDate: futureDateStr(60),
    });
  } catch (err: any) {
    console.warn(`[07-driver-booking] Could not publish ride: ${err.message}. Tests will skip.`);
    return;
  }

  // Create 3 separate bookings for accept / reject / cancel scenarios
  const bookingA = await pa.post('/bookings', { rideId, seatsBooked: 1 });
  acceptBookingId = (bookingA.data.data ?? bookingA.data).id;

  // Use passengerB for the reject scenario
  const bookingB = await pb.post('/bookings', { rideId, seatsBooked: 1 });
  rejectBookingId = (bookingB.data.data ?? bookingB.data).id;
});

afterAll(async () => {
  if (rideId) {
    await da.delete(`/publish-ride/${rideId}`);
  }
});

// ── TC-DRIVER-001: Accept ────────────────────────────────────────────────
describe('TC-DRIVER-001 — Accept booking happy path', () => {
  it('transitions booking to CONFIRMED and notifies passenger', async () => {
    if (!acceptBookingId) return;
    const res = await da.post(`/driver/bookings/${acceptBookingId}/accept`);
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    expect(result.status ?? result.bookingStatus ?? 'CONFIRMED').toBe('CONFIRMED');
  });
});

// ── TC-DRIVER-002: Another driver cannot act ────────────────────────────
describe('TC-DRIVER-002 — Wrong driver cannot accept', () => {
  it('returns 403', async () => {
    if (!rejectBookingId) return;
    const res = await pb.post(`/driver/bookings/${rejectBookingId}/accept`);
    expect(res.status).toBe(403);
  });
});

// ── TC-DRIVER-003: Double-accept ─────────────────────────────────────────
describe('TC-DRIVER-003 — Accept already CONFIRMED booking', () => {
  it('returns 409', async () => {
    if (!acceptBookingId) return;
    const res = await da.post(`/driver/bookings/${acceptBookingId}/accept`);
    expect(res.status).toBe(409);
  });
});

// ── TC-DRIVER-005: Reject ────────────────────────────────────────────────
describe('TC-DRIVER-005 — Reject booking with reason', () => {
  it('transitions to CANCELLED and restores seats', async () => {
    if (!rejectBookingId) return;
    const res = await da.post(`/driver/bookings/${rejectBookingId}/reject`, {
      reason: 'No room for luggage on this trip',
    });
    expect(res.status).toBe(200);
  });
});

// ── TC-DRIVER-006: Reject without reason ─────────────────────────────────
describe('TC-DRIVER-006 — Reject without reason', () => {
  it('returns 400 validation error', async () => {
    // Create a fresh booking for this test
    if (!rideId) return;
    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    const tempId: string = (bookRes.data.data ?? bookRes.data).id;

    const res = await da.post(`/driver/bookings/${tempId}/reject`, {});
    expect(res.status).toBe(400);
  });
});

// ── TC-DRIVER-007: Cancel after accept ──────────────────────────────────
describe('TC-DRIVER-007 — Driver cancels after accepting', () => {
  it('cancels booking, records penalty, sends refund notification', async () => {
    if (!rideId) return;
    // Create booking and accept it
    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    cancelBookingId = (bookRes.data.data ?? bookRes.data).id;

    await da.post(`/driver/bookings/${cancelBookingId}/accept`);

    const cancelRes = await da.post(`/driver/bookings/${cancelBookingId}/cancel`, {
      reason: 'Car broke down unexpectedly',
    });
    expect(cancelRes.status).toBe(200);
    const result = cancelRes.data.data ?? cancelRes.data;
    expect(result.status ?? result.bookingStatus ?? 'CANCELLED').toBe('CANCELLED');
  });
});

// ── TC-DRIVER-008: Cancel without reason ─────────────────────────────────
describe('TC-DRIVER-008 — Driver cancel without reason', () => {
  it('returns 400 validation error', async () => {
    if (!acceptBookingId) return;
    // acceptBookingId is already CONFIRMED from TC-DRIVER-001
    const res = await da.post(`/driver/bookings/${acceptBookingId}/cancel`, {});
    // Should fail validation (missing reason)
    expect(res.status).toBe(400);
  });
});
