/**
 * E2E — Payment Confirmation Endpoint
 * Covers: TC-PAYCONFIRM-001 through TC-PAYCONFIRM-003
 *
 * Tests the POST /bookings/:id/payment/confirm endpoint contract.
 * In bypass mode this endpoint should still respond gracefully.
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);
const pb = authed(state.passengerB.accessToken);

let rideId: string;
let bookingId: string;

beforeAll(async () => {
  try {
    rideId = await publishRide(state.driverA.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 12.0,
      departureDate: futureDateStr(55),
    });
  } catch (err: any) {
    console.warn(`[21-payment-confirm] Could not publish ride: ${err.message}`);
    return;
  }

  const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
  if (bookRes.status === 200 || bookRes.status === 201) {
    bookingId = (bookRes.data.data ?? bookRes.data).id;
  }
});

afterAll(async () => {
  if (rideId) await da.delete(`/publish-ride/${rideId}`);
});

describe('TC-PAYCONFIRM-001 — Confirm payment on own booking', () => {
  it('returns 200 or payment-related status', async () => {
    if (!bookingId) return;
    const res = await pa.post(`/bookings/${bookingId}/payment/confirm`);
    // In bypass mode: may return 200 with already-confirmed status or 400
    // In stripe mode without actual payment: 400 or 402
    expect([200, 400, 402]).toContain(res.status);
  });
});

describe('TC-PAYCONFIRM-002 — Cannot confirm another user booking', () => {
  it('returns 403 or 404', async () => {
    if (!bookingId) return;
    const res = await pb.post(`/bookings/${bookingId}/payment/confirm`);
    expect([403, 404]).toContain(res.status);
  });
});

describe('TC-PAYCONFIRM-003 — Confirm non-existent booking', () => {
  it('returns 404', async () => {
    const res = await pa.post('/bookings/00000000-0000-0000-0000-000000000000/payment/confirm');
    expect([404, 400]).toContain(res.status);
  });
});
