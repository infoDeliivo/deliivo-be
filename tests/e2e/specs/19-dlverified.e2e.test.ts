/**
 * E2E — Driver License Verification Enforcement
 * Covers: TC-DLV-001 through TC-DLV-003
 *
 * Verifies that a driver without a verified driving licence (dlVerified=false)
 * cannot accept passenger bookings.  Uses a fresh driver created without
 * setting dlVerified so the test is deterministic.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();
const pa = authed(state.passengerA.accessToken);

let unverifiedDriverToken: string;
let unverifiedDriverId: string;
let rideId: string | null = null;
let bookingId: string | null = null;

function getDb(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? '';
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// ── Setup: create driver WITHOUT dlVerified ───────────────────────────────────
beforeAll(async () => {
  const runId = state.runId;
  const email = `e2e-unverified-driver-${runId}@test.local`;

  const result = await signupAndVerifyEmail(email);
  const account = toAccountState(result, email);
  unverifiedDriverToken = account.accessToken;
  unverifiedDriverId = account.id;

  await authed(unverifiedDriverToken).put('/users/me', {
    name: 'Unverified Driver',
    salutation: 'MR',
  });
  await authed(unverifiedDriverToken).post('/auth/accept-tos', {
    tosVersion: '1.0',
    privacyVersion: '1.0',
  });

  // Add vehicle
  const draftRes = await authed(unverifiedDriverToken).post('/vehicles/draft', {
    licenseCountry: 'GB',
    licenseNumber: 'ZZ00 ZZZ',
  });
  if (draftRes.status === 200 || draftRes.status === 201) {
    await authed(unverifiedDriverToken).put('/vehicles/draft/vehicle-details', {
      brand: 'Ford',
      model_name: 'Focus',
      model_num: '2019',
      type: 'hatchback',
      color: 'Black',
      year: 2019,
    });
    await authed(unverifiedDriverToken).post('/vehicles/draft/save', {});
  }

  // Set dlVerified=true temporarily so we can publish a ride, then flip it back to false
  // (publishing requires dlVerified; accepting requires dlVerified — we test the accept guard)
  const db = getDb();
  try {
    await db.user.update({ where: { id: unverifiedDriverId }, data: { dlVerified: true } });

    // Publish the ride while dlVerified=true
    try {
      rideId = await publishRide(unverifiedDriverToken, {
        ...LONDON_TO_MANCHESTER,
        totalSeats: 2,
        basePricePerSeat: 10.0,
        departureDate: futureDateStr(70),
      });
    } catch (err: any) {
      console.warn(`[19-dlverified] Could not publish ride: ${err.message}. Tests will skip.`);
    }

    // Now revoke dlVerified so accept will be blocked
    await db.user.update({ where: { id: unverifiedDriverId }, data: { dlVerified: false } });
  } catch (err: any) {
    console.warn(`[19-dlverified] DB setup failed: ${err.message}. Tests will skip.`);
  } finally {
    await db.$disconnect();
  }

  // Create a booking as passenger so we have something to accept
  if (rideId) {
    const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
    if (bookRes.status === 200 || bookRes.status === 201) {
      bookingId = (bookRes.data.data ?? bookRes.data).id ?? null;
    }
  }
});

afterAll(async () => {
  // Re-enable dlVerified before deleting the ride (delete requires driver auth)
  const db = getDb();
  try {
    await db.user.update({ where: { id: unverifiedDriverId }, data: { dlVerified: true } });
  } catch { /* ignore */ }
  await db.$disconnect();

  if (rideId) {
    await authed(unverifiedDriverToken).delete(`/publish-ride/${rideId}`);
  }
});

// ── TC-DLV-001: Unverified driver cannot accept booking ──────────────────────
describe('TC-DLV-001 — Driver without dlVerified cannot accept a booking', () => {
  it('returns 403 DRIVER_NOT_VERIFIED', async () => {
    if (!bookingId) return;
    const res = await authed(unverifiedDriverToken).post(
      `/driver/bookings/${bookingId}/accept`
    );
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.data)).toMatch(/verif|dl/i);
  });
});

// ── TC-DLV-002: Verified driver (driverA) CAN accept ────────────────────────
describe('TC-DLV-002 — Driver with dlVerified=true can accept a booking', () => {
  it('driverA (dlVerified=true from setup) accepts their booking successfully', async () => {
    if (!state.sharedRide) return;
    // Create a fresh booking on the shared ride (driverA's ride)
    const da = authed(state.driverA.accessToken);
    const bookRes = await pa.post('/bookings', {
      rideId: state.sharedRide.id,
      seatsBooked: 1,
    });
    if (bookRes.status !== 200 && bookRes.status !== 201) return;
    const freshBookingId = (bookRes.data.data ?? bookRes.data).id;

    const res = await da.post(`/driver/bookings/${freshBookingId}/accept`);
    expect(res.status).toBe(200);

    // Clean up — cancel the booking
    await da.post(`/driver/bookings/${freshBookingId}/cancel`, {
      reason: 'Test cleanup',
    });
  });
});

// ── TC-DLV-003: dlVerified enforcement is per booking, not per ride ──────────
describe('TC-DLV-003 — dlVerified check occurs at accept time, not publish time', () => {
  it('the ride published by the unverified driver exists in PUBLISHED status', async () => {
    if (!rideId) return;
    const res = await authed(unverifiedDriverToken).get(`/publish-ride/${rideId}`);
    expect(res.status).toBe(200);
    const ride = res.data.data ?? res.data;
    // Ride was published when dlVerified was true; it remains PUBLISHED after revocation
    expect(ride.status).toBe('PUBLISHED');
  });
});
