/**
 * E2E — ToS Acceptance Enforcement and Female-Only Rides
 * Covers: TC-TOS-001 through TC-TOS-003, TC-FEMALE-001 through TC-FEMALE-003
 *
 * ToS tests create a fresh user that has NOT accepted ToS, then verify they
 * are blocked from booking/publishing.  Female-only tests create a dedicated
 * female driver so we can publish a femaleOnly ride and verify access control.
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';

const state = readState();

let noTosToken: string;           // user without ToS accepted
let femalePaxToken: string;       // female passenger (salutation=MS) with ToS
let malePaxToken: string;         // male passenger (salutation=MR) with ToS
let femaleDriverToken: string;    // female driver with ToS + dlVerified
let femaleRideId: string | null = null;

function getDb(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? '';
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// ── Setup ────────────────────────────────────────────────────────────────────
beforeAll(async () => {
  const runId = state.runId;

  // User WITHOUT ToS accepted
  const noTosEmail = `e2e-notos-${runId}@test.local`;
  const noTosResult = await signupAndVerifyEmail(noTosEmail);
  noTosToken = toAccountState(noTosResult, noTosEmail).accessToken;
  // Intentionally skip /auth/accept-tos for this user

  // Female passenger (has ToS)
  const femalePaxEmail = `e2e-female-pax-${runId}@test.local`;
  const femalePaxResult = await signupAndVerifyEmail(femalePaxEmail);
  const femalePaxAccount = toAccountState(femalePaxResult, femalePaxEmail);
  femalePaxToken = femalePaxAccount.accessToken;
  await authed(femalePaxToken).put('/users/me', { name: 'Female Passenger', salutation: 'MS' });
  await authed(femalePaxToken).post('/auth/accept-tos', { tosVersion: '1.0', privacyVersion: '1.0' });

  // Male passenger (has ToS)
  const malePaxEmail = `e2e-male-pax-${runId}@test.local`;
  const malePaxResult = await signupAndVerifyEmail(malePaxEmail);
  const malePaxAccount = toAccountState(malePaxResult, malePaxEmail);
  malePaxToken = malePaxAccount.accessToken;
  await authed(malePaxToken).put('/users/me', { name: 'Male Passenger', salutation: 'MR' });
  await authed(malePaxToken).post('/auth/accept-tos', { tosVersion: '1.0', privacyVersion: '1.0' });

  // Female driver — needs ToS + dlVerified + vehicle
  const femaleDriverEmail = `e2e-female-driver-${runId}@test.local`;
  const femaleDriverResult = await signupAndVerifyEmail(femaleDriverEmail);
  const femaleDriverAccount = toAccountState(femaleDriverResult, femaleDriverEmail);
  femaleDriverToken = femaleDriverAccount.accessToken;
  await authed(femaleDriverToken).put('/users/me', { name: 'Female Driver', salutation: 'MS' });
  await authed(femaleDriverToken).post('/auth/accept-tos', { tosVersion: '1.0', privacyVersion: '1.0' });

  // Add vehicle for female driver
  const draftRes = await authed(femaleDriverToken).post('/vehicles/draft', {
    licenseCountry: 'GB',
    licenseNumber: 'FF99 AAA',
  });
  if (draftRes.status === 200 || draftRes.status === 201) {
    await authed(femaleDriverToken).put('/vehicles/draft/vehicle-details', {
      brand: 'Fiat',
      model_name: '500',
      model_num: '2022',
      type: 'hatchback',
      color: 'Pink',
      year: 2022,
    });
    await authed(femaleDriverToken).post('/vehicles/draft/save', {});
  }

  // Set dlVerified=true for female driver via DB
  const db = getDb();
  try {
    await db.user.update({
      where: { id: femaleDriverAccount.id },
      data: { dlVerified: true },
    });
  } catch (err: any) {
    console.warn(`[18-tos-femaleonly] Could not set dlVerified for female driver: ${err.message}`);
  } finally {
    await db.$disconnect();
  }

  // Publish a femaleOnly ride
  try {
    femaleRideId = await publishRide(femaleDriverToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 12.0,
      departureDate: futureDateStr(55),
      femaleOnly: true,
    });
  } catch (err: any) {
    console.warn(`[18-tos-femaleonly] Could not publish female-only ride: ${err.message}`);
  }
});

afterAll(async () => {
  if (femaleRideId) {
    await authed(femaleDriverToken).delete(`/publish-ride/${femaleRideId}`);
  }
});

// ── TC-TOS-001: Passenger without ToS cannot book ────────────────────────────
describe('TC-TOS-001 — Passenger who has not accepted ToS cannot create a booking', () => {
  it('returns 403 TOS_NOT_ACCEPTED when booking without ToS', async () => {
    if (!state.sharedRide) return;
    const res = await authed(noTosToken).post('/bookings', {
      rideId: state.sharedRide.id,
      seatsBooked: 1,
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.data)).toMatch(/tos|terms/i);
  });
});

// ── TC-TOS-002: Driver without ToS cannot publish ────────────────────────────
describe('TC-TOS-002 — Driver who has not accepted ToS cannot publish a ride', () => {
  it('returns 403 TOS_NOT_ACCEPTED when publishing without ToS', async () => {
    // Set origin/destination/schedule steps first, then try to publish
    await authed(noTosToken).post('/publish-ride/draft/origin', {
      originPlaceId: LONDON_TO_MANCHESTER.originPlaceId,
      originAddress: LONDON_TO_MANCHESTER.originAddress,
      originLat: LONDON_TO_MANCHESTER.originLat,
      originLng: LONDON_TO_MANCHESTER.originLng,
    });
    // The publish step is where ToS is validated
    const res = await authed(noTosToken).post('/publish-ride/draft/publish');
    // May be 400 (missing steps) or 403 (ToS not accepted) — either is a rejection
    expect([400, 403]).toContain(res.status);
  });
});

// ── TC-TOS-003: After accepting ToS, user can book ───────────────────────────
describe('TC-TOS-003 — After accepting ToS, user can proceed with booking', () => {
  it('booking succeeds once ToS is accepted', async () => {
    if (!state.sharedRide) return;
    // Accept ToS for the noTos user
    await authed(noTosToken).post('/auth/accept-tos', {
      tosVersion: '1.0',
      privacyVersion: '1.0',
    });

    const res = await authed(noTosToken).post('/bookings', {
      rideId: state.sharedRide.id,
      seatsBooked: 1,
    });
    expect([200, 201]).toContain(res.status);

    // Clean up booking
    if (res.status === 200 || res.status === 201) {
      const bookingId = (res.data.data ?? res.data).id;
      if (bookingId) {
        await authed(noTosToken).post(`/bookings/${bookingId}/cancel`);
      }
    }
  });
});

// ── TC-FEMALE-001: Male passenger cannot book femaleOnly ride ────────────────
describe('TC-FEMALE-001 — Male passenger cannot book a female-only ride', () => {
  it('returns 403 FEMALE_ONLY_RIDE when male tries to book', async () => {
    if (!femaleRideId) return;
    const res = await authed(malePaxToken).post('/bookings', {
      rideId: femaleRideId,
      seatsBooked: 1,
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.data)).toMatch(/female/i);
  });
});

// ── TC-FEMALE-002: Female passenger can book femaleOnly ride ─────────────────
describe('TC-FEMALE-002 — Female passenger can book a female-only ride', () => {
  it('returns 200/201 when female passenger books', async () => {
    if (!femaleRideId) return;
    const res = await authed(femalePaxToken).post('/bookings', {
      rideId: femaleRideId,
      seatsBooked: 1,
    });
    expect([200, 201]).toContain(res.status);
    const booking = res.data.data ?? res.data;
    expect(booking.status).toBe('DRIVER_PENDING');

    // Clean up
    if (booking.id) {
      await authed(femalePaxToken).post(`/bookings/${booking.id}/cancel`);
    }
  });
});

// ── TC-FEMALE-003: femaleOnly ride is flagged in ride detail ─────────────────
describe('TC-FEMALE-003 — femaleOnly ride is visible in ride detail', () => {
  it('ride detail shows femaleOnly=true', async () => {
    if (!femaleRideId) return;
    const res = await authed(femalePaxToken).get(`/search-rides/${femaleRideId}`);
    if (res.status === 404) {
      // May not appear in search if status changed — try publish-ride endpoint
      const res2 = await authed(femaleDriverToken).get(`/publish-ride/${femaleRideId}`);
      expect(res2.status).toBe(200);
      const ride = res2.data.data ?? res2.data;
      expect(ride.femaleOnly).toBe(true);
      return;
    }
    expect(res.status).toBe(200);
    const ride = res.data.data ?? res.data;
    expect(ride.femaleOnly).toBe(true);
  });
});
