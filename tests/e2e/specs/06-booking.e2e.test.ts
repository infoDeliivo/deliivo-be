/**
 * E2E — Passenger Booking Flow
 * Covers: TC-BOOK-001 through TC-BOOK-010
 *
 * All tests skip if sharedRide is null.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const ride = state.sharedRide;
const pa = authed(state.passengerA.accessToken);
const pb = authed(state.passengerB.accessToken);

const skip = !ride;

let bookingId: string;

describe('TC-BOOK-001 — Price preview', () => {
  (skip ? it.skip : it)('returns correct price breakdown for 1 seat + 1 luggage', async () => {
    const res = await pa.post('/bookings/price-preview', {
      rideId: ride!.id,
      seatsBooked: 1,
      luggageCount: 1,
    });
    expect(res.status).toBe(200);
    const breakdown = res.data.data?.priceBreakdown ?? res.data.priceBreakdown;
    expect(breakdown.seatsBooked).toBe(1);
    expect(breakdown.luggageFee).toBe(5.0);
    expect(breakdown.totalPrice).toBe(ride!.basePricePerSeat + 5.0);
    expect(breakdown.currency).toBe('GBP');
  });
});

describe('TC-BOOK-002 — Create booking (bypass payment mode)', () => {
  (skip ? it.skip : it)('creates booking in DRIVER_PENDING status', async () => {
    const res = await pa.post('/bookings', {
      rideId: ride!.id,
      seatsBooked: 1,
      luggageCount: 0,
    });
    expect([200, 201]).toContain(res.status);
    const booking = res.data.data ?? res.data;
    expect(booking.status).toBe('DRIVER_PENDING');
    expect(booking.decisionDeadline).toBeTruthy();
    expect(booking.decisionDeadline.isExpired).toBe(false);
    bookingId = booking.id;
  });
});

describe('TC-BOOK-003 — Driver cannot book their own ride', () => {
  (skip ? it.skip : it)('returns 400/409', async () => {
    const da = authed(state.driverA.accessToken);
    const res = await da.post('/bookings', { rideId: ride!.id, seatsBooked: 1 });
    expect([400, 409]).toContain(res.status);
  });
});

describe('TC-BOOK-004 — Insufficient seats', () => {
  (skip ? it.skip : it)('returns 400 when requesting more seats than available', async () => {
    const res = await pb.post('/bookings', {
      rideId: ride!.id,
      seatsBooked: 4, // ride only has 3 seats total, but 1 already booked → insufficient
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.data)).toMatch(/seat/i);
  });
});

describe('TC-BOOK-005 — Duplicate booking', () => {
  (skip ? it.skip : it)('returns 409 when passenger already has an active booking on the ride', async () => {
    const res = await pa.post('/bookings', { rideId: ride!.id, seatsBooked: 1 });
    expect(res.status).toBe(409);
  });
});

describe('TC-BOOK-006 — Exceeds max seats per booking', () => {
  (skip ? it.skip : it)('returns 400 when seatsBooked > 4', async () => {
    const res = await pb.post('/bookings', { rideId: ride!.id, seatsBooked: 5 });
    expect(res.status).toBe(400);
  });
});

describe('TC-BOOK-007 — Get booking by ID', () => {
  (skip ? it.skip : it)('returns booking with decisionDeadline and ride info', async () => {
    expect(bookingId).toBeDefined();
    const res = await pa.get(`/bookings/${bookingId}`);
    expect(res.status).toBe(200);
    const booking = res.data.data ?? res.data;
    expect(booking.id).toBe(bookingId);
    expect(booking.ride).toBeTruthy();
    expect(booking.decisionDeadline.isExpired).toBe(false);
    expect(booking.decisionDeadline.timeRemainingSeconds).toBeGreaterThan(0);
  });
});

describe('TC-BOOK-008 — Get booking belonging to another user', () => {
  (skip ? it.skip : it)('returns 404', async () => {
    expect(bookingId).toBeDefined();
    const res = await pb.get(`/bookings/${bookingId}`);
    expect(res.status).toBe(404);
  });
});

describe('TC-BOOK-009 — List my bookings', () => {
  (skip ? it.skip : it)('returns paginated list with the created booking', async () => {
    const res = await pa.get('/bookings');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const bookings: Array<{ id: string }> = body.bookings ?? body;
    expect(bookings.some((b) => b.id === bookingId)).toBe(true);
    expect(body.pagination).toBeTruthy();
  });
});

describe('TC-BOOK-010 — Filter bookings by status', () => {
  (skip ? it.skip : it)('returns only DRIVER_PENDING bookings when filtered', async () => {
    const res = await pa.get('/bookings', { status: 'DRIVER_PENDING' });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const bookings: Array<{ status: string }> = body.bookings ?? body;
    bookings.forEach((b) => {
      expect(b.status).toBe('DRIVER_PENDING');
    });
  });
});
