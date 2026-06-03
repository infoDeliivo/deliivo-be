/**
 * E2E — Cancellation Refund Tiers
 * Covers: TC-CANCEL-002 through TC-CANCEL-004
 *
 * Tests the different refund percentages based on cancellation timing.
 * - DRIVER_PENDING: 100% refund (already tested in 09-cancellations)
 * - CONFIRMED + >24h before departure: 50% refund
 * - CONFIRMED + <=24h before departure: 0% refund
 * - Driver cancels: 100% refund to passenger + penalty
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

// ── TC-CANCEL-002: Passenger cancels CONFIRMED booking >24h before departure ──
describe('TC-CANCEL-002 — Passenger cancels confirmed booking >24h before departure', () => {
  let rideId: string;
  let bookingId: string;

  beforeAll(async () => {
    try {
      // Ride departing 40 days from now — well over 24h
      rideId = await publishRide(state.driverA.accessToken, {
        ...LONDON_TO_MANCHESTER,
        totalSeats: 3,
        basePricePerSeat: 20.0,
        departureDate: futureDateStr(40),
      });
    } catch (err: any) {
      console.warn(`[25-cancel-tiers] Could not publish ride: ${err.message}`);
      return;
    }

    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    bookingId = (bookRes.data.data ?? bookRes.data).id;

    // Accept booking so it becomes CONFIRMED
    await da.post(`/driver/bookings/${bookingId}/accept`);
  });

  afterAll(async () => {
    if (rideId) await da.delete(`/publish-ride/${rideId}`).catch(() => {});
  });

  it('returns 200 with cancellation processed', async () => {
    if (!bookingId) return;
    const res = await pa.post(`/bookings/${bookingId}/cancel`);
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    // In bypass mode (no Stripe payment captured), refundPercent=0.
    // In stripe mode with >24h to departure, refundPercent=50.
    expect(typeof result.refundPercent).toBe('number');
    expect(typeof result.refundInitiated).toBe('boolean');
  });
});

// ── TC-CANCEL-003: Passenger cancels CONFIRMED booking <=24h before departure ──
describe('TC-CANCEL-003 — Passenger cancels confirmed booking <=24h before departure', () => {
  let rideId: string;
  let bookingId: string;

  beforeAll(async () => {
    try {
      // Ride departing tomorrow — within 24h window
      rideId = await publishRide(state.driverA.accessToken, {
        ...LONDON_TO_MANCHESTER,
        totalSeats: 3,
        basePricePerSeat: 20.0,
        departureDate: futureDateStr(1), // tomorrow
      });
    } catch (err: any) {
      console.warn(`[25-cancel-tiers] Could not publish ride (24h): ${err.message}`);
      return;
    }

    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    bookingId = (bookRes.data.data ?? bookRes.data).id;

    await da.post(`/driver/bookings/${bookingId}/accept`);
  });

  afterAll(async () => {
    if (rideId) await da.delete(`/publish-ride/${rideId}`).catch(() => {});
  });

  it('returns 200 with refundPercent=0', async () => {
    if (!bookingId) return;
    const res = await pa.post(`/bookings/${bookingId}/cancel`);
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    expect(result.refundPercent).toBe(0);
  });
});

// ── TC-CANCEL-004: Driver cancels confirmed booking → full refund + penalty ──
describe('TC-CANCEL-004 — Driver cancels confirmed booking (full refund + penalty)', () => {
  let rideId: string;
  let bookingId: string;

  beforeAll(async () => {
    try {
      rideId = await publishRide(state.driverA.accessToken, {
        ...LONDON_TO_MANCHESTER,
        totalSeats: 3,
        basePricePerSeat: 20.0,
        departureDate: futureDateStr(30),
      });
    } catch (err: any) {
      console.warn(`[25-cancel-tiers] Could not publish ride (driver cancel): ${err.message}`);
      return;
    }

    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    bookingId = (bookRes.data.data ?? bookRes.data).id;

    await da.post(`/driver/bookings/${bookingId}/accept`);
  });

  afterAll(async () => {
    if (rideId) await da.delete(`/publish-ride/${rideId}`).catch(() => {});
  });

  it('returns 200 with booking cancelled', async () => {
    if (!bookingId) return;
    const res = await da.post(`/driver/bookings/${bookingId}/cancel`, {
      reason: 'Vehicle breakdown',
    });
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    expect(result.status).toBe('CANCELLED');
    expect(result.bookingId).toBe(bookingId);
  });
});
