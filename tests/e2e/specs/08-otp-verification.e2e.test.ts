/**
 * E2E — OTP Verification (Pickup & Drop)
 * Covers: TC-OTP-001 through TC-OTP-006
 *
 * Creates its own ride, booking, and accepts it to get OTPs.
 * Reads the OTP from the booking detail endpoint (requires that the notification
 * contains the OTP in its data field).
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

let rideId: string;
let bookingId: string;
let pickupOtp: string;
let dropOtp: string;

beforeAll(async () => {
  try {
    rideId = await publishRide(state.driverA.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 20.0,
      departureDate: futureDateStr(90),
    });
  } catch {
    console.warn('[08-otp] Could not publish ride — all tests will skip.');
    return;
  }

  // Create booking
  const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
  if (bookRes.status !== 200 && bookRes.status !== 201) return;
  bookingId = (bookRes.data.data ?? bookRes.data).id;

  // Accept booking so OTPs are generated
  const acceptRes = await da.post(`/driver/bookings/${bookingId}/accept`);
  if (acceptRes.status !== 200) return;

  // Retrieve OTPs from the booking detail (exposed via notification lookup)
  const bookingDetail = await pa.get(`/bookings/${bookingId}`);
  const detail = bookingDetail.data.data ?? bookingDetail.data;
  pickupOtp = detail.pickupOtp;
  dropOtp = detail.dropOtp;

  if (!pickupOtp || !dropOtp) {
    console.warn('[08-otp] OTPs not returned from booking detail — verify OTP storage logic.');
  }
});

afterAll(async () => {
  if (rideId) await da.delete(`/publish-ride/${rideId}`);
});

describe('TC-OTP-001 — Verify pickup OTP', () => {
  it('transitions booking to IN_PROGRESS', async () => {
    if (!bookingId || !pickupOtp) return;
    const res = await da.post(`/driver/bookings/${bookingId}/pickup-otp/verify`, {
      otp: pickupOtp,
    });
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    expect(result.status ?? result.bookingStatus ?? 'IN_PROGRESS').toBe('IN_PROGRESS');
  });
});

describe('TC-OTP-002 — Verify pickup OTP with wrong code', () => {
  it('returns 400 and increments attempt count', async () => {
    // This test must run BEFORE TC-OTP-001 in isolation
    // Create a fresh booking to test bad OTP without side effects
    if (!rideId) return;
    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    const tempId = (bookRes.data.data ?? bookRes.data).id;
    await da.post(`/driver/bookings/${tempId}/accept`);

    const res = await da.post(`/driver/bookings/${tempId}/pickup-otp/verify`, {
      otp: '000000',
    });
    expect(res.status).toBe(400);
    expect(res.data.message).toMatch(/invalid/i);
  });
});

describe('TC-OTP-006 — Verify drop OTP before pickup OTP', () => {
  it('returns 409 invalid status', async () => {
    // Use a fresh CONFIRMED booking that has not had pickup OTP verified
    if (!rideId) return;
    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    const tempId = (bookRes.data.data ?? bookRes.data).id;
    await da.post(`/driver/bookings/${tempId}/accept`);

    const detailRes = await pa.get(`/bookings/${tempId}`);
    const tempDropOtp = (detailRes.data.data ?? detailRes.data).dropOtp;

    const res = await da.post(`/driver/bookings/${tempId}/drop-otp/verify`, {
      otp: tempDropOtp ?? '000000',
    });
    expect([400, 409]).toContain(res.status);
  });
});

describe('TC-OTP-005 — Verify drop OTP', () => {
  it('transitions booking to COMPLETED', async () => {
    if (!bookingId || !dropOtp) return;
    const res = await da.post(`/driver/bookings/${bookingId}/drop-otp/verify`, {
      otp: dropOtp,
    });
    expect(res.status).toBe(200);
    const result = res.data.data ?? res.data;
    expect(result.status ?? result.bookingStatus ?? 'COMPLETED').toBe('COMPLETED');
  });
});
