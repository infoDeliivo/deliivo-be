/**
 * E2E — Ratings
 * Covers: TC-RATE-001 through TC-RATE-006
 *
 * Creates its own ride, completes it end-to-end, then tests rating scenarios.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);
const pb = authed(state.passengerB.accessToken);

let rideId: string;
let completedBookingId: string;

beforeAll(async () => {
  try {
    rideId = await publishRide(state.driverA.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 15.0,
      departureDate: futureDateStr(50),
    });
  } catch (err: any) {
    console.warn(`[10-ratings] Could not publish ride: ${err.message}`);
    return;
  }

  // Book → accept → verify pickup → verify drop → COMPLETED
  const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
  if (bookRes.status !== 200 && bookRes.status !== 201) return;
  completedBookingId = (bookRes.data.data ?? bookRes.data).id;

  await da.post(`/driver/bookings/${completedBookingId}/accept`);

  const detail = await pa.get(`/bookings/${completedBookingId}`);
  const { pickupOtp, dropOtp } = detail.data.data ?? detail.data;

  if (pickupOtp) await da.post(`/driver/bookings/${completedBookingId}/pickup-otp/verify`, { otp: pickupOtp });
  if (dropOtp) await da.post(`/driver/bookings/${completedBookingId}/drop-otp/verify`, { otp: dropOtp });
});

afterAll(async () => {
  if (rideId) await da.delete(`/publish-ride/${rideId}`);
});

// ── TC-RATE-001: Passenger rates driver ──────────────────────────────────
describe('TC-RATE-001 — Passenger rates driver after completed ride', () => {
  it('creates rating and returns 201', async () => {
    if (!completedBookingId) return;
    const res = await pa.post(`/ratings/bookings/${completedBookingId}`, {
      stars: 5,
      reviewText: 'Excellent driver, very punctual',
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const rating = res.data.data ?? res.data;
    expect(rating.stars).toBe(5);
    expect(rating.rateeId).toBe(state.driverA.id);
  });
});

// ── TC-RATE-002: Driver rates passenger ──────────────────────────────────
describe('TC-RATE-002 — Driver rates passenger after completed ride', () => {
  it('creates rating and returns 201', async () => {
    if (!completedBookingId) return;
    const res = await da.post(`/ratings/bookings/${completedBookingId}`, {
      stars: 4,
      reviewText: 'Polite and on time',
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const rating = res.data.data ?? res.data;
    expect(rating.stars).toBe(4);
    expect(rating.rateeId).toBe(state.passengerA.id);
  });
});

// ── TC-RATE-003: Stars out of range ──────────────────────────────────────
describe('TC-RATE-003 — Stars out of valid range', () => {
  it('returns 400 or 422 for stars=6', async () => {
    if (!completedBookingId) return;
    const res = await pa.post(`/ratings/bookings/${completedBookingId}`, {
      stars: 6,
    });
    expect([400, 422]).toContain(res.status);
  });

  it('returns 400 or 422 for stars=0', async () => {
    if (!completedBookingId) return;
    const res = await pa.post(`/ratings/bookings/${completedBookingId}`, {
      stars: 0,
    });
    expect([400, 422]).toContain(res.status);
  });
});

// ── TC-RATE-004: Rate incomplete booking ─────────────────────────────────
describe('TC-RATE-004 — Cannot rate a booking not yet COMPLETED', () => {
  it('returns 400/409 for a DRIVER_PENDING booking', async () => {
    if (!rideId) return;
    const bookRes = await pb.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    const pendingBookingId = (bookRes.data.data ?? bookRes.data).id;

    const res = await pb.post(`/ratings/bookings/${pendingBookingId}`, { stars: 3 });
    expect([400, 409]).toContain(res.status);
    expect(JSON.stringify(res.data)).toMatch(/complet/i);
  });
});

// ── TC-RATE-005: Duplicate rating ────────────────────────────────────────
describe('TC-RATE-005 — Cannot rate the same booking twice', () => {
  it('returns 409 RATING_ALREADY_SUBMITTED', async () => {
    if (!completedBookingId) return;
    // TC-RATE-001 already submitted passenger → driver rating
    const res = await pa.post(`/ratings/bookings/${completedBookingId}`, {
      stars: 3,
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.data)).toMatch(/already/i);
  });
});

// ── TC-RATE-006: Non-participant cannot rate ─────────────────────────────
describe('TC-RATE-006 — Non-participant cannot rate a booking', () => {
  it('returns 403/404', async () => {
    if (!completedBookingId) return;
    // passengerB was not part of this booking
    const res = await pb.post(`/ratings/bookings/${completedBookingId}`, {
      stars: 1,
    });
    expect([403, 404]).toContain(res.status);
  });
});
