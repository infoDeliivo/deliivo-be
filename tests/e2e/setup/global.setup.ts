import dotenv from 'dotenv';
import path from 'path';
// Load .env.test before anything else so DATABASE_URL etc. are available
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { writeState, TestState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';
import {
  publishRide,
  toRideState,
  LONDON_TO_MANCHESTER,
} from '../helpers/ride.helper';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000';
const api = axios.create({ baseURL: `${BASE_URL}/api/v1`, timeout: 15000, validateStatus: () => true, proxy: false });

const authed = (token: string) => ({
  get: (url: string) => api.get(url, { headers: { Authorization: `Bearer ${token}` } }),
  post: (url: string, data?: unknown) => api.post(url, data, { headers: { Authorization: `Bearer ${token}` } }),
  put: (url: string, data?: unknown) => api.put(url, data, { headers: { Authorization: `Bearer ${token}` } }),
});

async function checkServerHealth(): Promise<void> {
  try {
    const res = await axios.get(`${BASE_URL}/health`, { timeout: 5000, proxy: false });
    if (res.status !== 200) {
      throw new Error(`Health check returned HTTP ${res.status}`);
    }
    console.log(`[e2e setup] Server is up at ${BASE_URL}`);
  } catch (err: any) {
    throw new Error(
      `[e2e setup] Cannot reach server at ${BASE_URL}. ` +
      `Start the server before running e2e tests. Error: ${err.message}`
    );
  }
}

async function addVehicle(token: string): Promise<string | null> {
  // Step 1: create draft with license info
  const draftRes = await authed(token).post('/vehicles/draft', {
    licenseCountry: 'GB',
    licenseNumber: 'AB12 CDE',
  });
  if (draftRes.status !== 201 && draftRes.status !== 200) {
    console.warn(`[e2e setup] Vehicle draft creation failed: ${draftRes.status} ${JSON.stringify(draftRes.data)}`);
    return null;
  }

  // Step 2: fill in vehicle details
  const detailsRes = await authed(token).put('/vehicles/draft/vehicle-details', {
    brand: 'Toyota',
    model_num: 'NHW20',
    model_name: 'Prius',
    type: 'sedan',
    color: 'Silver',
    year: 2021,
  });
  if (detailsRes.status !== 200) {
    console.warn(`[e2e setup] Vehicle details update failed: ${detailsRes.status} ${JSON.stringify(detailsRes.data)}`);
    return null;
  }

  // Step 3: save draft as active vehicle
  const saveRes = await authed(token).post('/vehicles/draft/save', {});
  if (saveRes.status !== 201 && saveRes.status !== 200) {
    console.warn(`[e2e setup] Vehicle save failed: ${saveRes.status} ${JSON.stringify(saveRes.data)}`);
    return null;
  }
  return saveRes.data?.data?.id ?? saveRes.data?.id ?? null;
}

async function createSharedRide(token: string): Promise<TestState['sharedRide']> {
  try {
    const rideId = await publishRide(token, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 3,
      basePricePerSeat: 15.0,
      currency: 'GBP',
    });

    // Fetch ride details so we can populate RideState
    const rideRes = await authed(token).get(`/publish-ride/${rideId}`);
    const rideData = rideRes.data?.data ?? rideRes.data;
    return toRideState(rideData);
  } catch (err: any) {
    console.warn(
      `[e2e setup] Could not publish shared ride: ${err.message}\n` +
      '  Search-ride and booking tests that depend on sharedRide will be skipped.'
    );
    return null;
  }
}

export default async function globalSetup(): Promise<void> {
  await checkServerHealth();

  const runId = Date.now().toString().slice(-8);
  console.log(`[e2e setup] Run ID: ${runId}`);

  // ── Driver A ────────────────────────────────────────────────────────────
  const driverEmail = `e2e-driver-${runId}@test.local`;
  console.log(`[e2e setup] Creating driver_a: ${driverEmail}`);
  const driverResult = await signupAndVerifyEmail(driverEmail);
  const driverAccount = toAccountState(driverResult, driverEmail);

  // Update driver profile
  await authed(driverAccount.accessToken).put('/users/me', {
    name: 'Test Driver Alpha',
    salutation: 'MR',
  });

  // Accept ToS — required before publishing rides or booking
  await authed(driverAccount.accessToken).post('/auth/accept-tos', {
    tosVersion: '1.0',
    privacyVersion: '1.0',
  });

  const vehicleId = await addVehicle(driverAccount.accessToken);
  console.log(`[e2e setup] Vehicle created: ${vehicleId ?? 'FAILED'}`);

  // Set dlVerified=true for driver so they can publish rides and accept bookings.
  // There is no API endpoint for this (it comes from the Veriff webhook in production),
  // so we set it directly in the DB — the same approach used in global.teardown.ts.
  const dbConnectionString = process.env.DATABASE_URL ?? '';
  if (dbConnectionString) {
    const adapter = new PrismaPg({ connectionString: dbConnectionString });
    const prismaSetup = new PrismaClient({ adapter });
    try {
      await prismaSetup.user.update({
        where: { id: driverAccount.id },
        data: { dlVerified: true },
      });
      console.log(`[e2e setup] Set dlVerified=true for driver_a (${driverAccount.id})`);
    } catch (err: any) {
      console.warn(`[e2e setup] Could not set dlVerified for driver_a: ${err.message}`);
    } finally {
      await prismaSetup.$disconnect();
    }
  } else {
    console.warn('[e2e setup] DATABASE_URL not set — dlVerified will remain false; acceptBooking tests may fail');
  }

  // Publish a shared ride for search / booking tests
  console.log('[e2e setup] Publishing shared ride...');
  const sharedRide = await createSharedRide(driverAccount.accessToken);
  if (sharedRide) {
    console.log(`[e2e setup] Shared ride published: ${sharedRide.id}`);
  }

  // ── Passenger A ─────────────────────────────────────────────────────────
  const passengerAEmail = `e2e-passenger-a-${runId}@test.local`;
  console.log(`[e2e setup] Creating passenger_a: ${passengerAEmail}`);
  const passengerAResult = await signupAndVerifyEmail(passengerAEmail);
  const passengerAAccount = toAccountState(passengerAResult, passengerAEmail);

  await authed(passengerAAccount.accessToken).put('/users/me', {
    name: 'Test Passenger Alpha',
    salutation: 'MS',
  });

  await authed(passengerAAccount.accessToken).post('/auth/accept-tos', {
    tosVersion: '1.0',
    privacyVersion: '1.0',
  });

  // ── Passenger B ─────────────────────────────────────────────────────────
  const passengerBEmail = `e2e-passenger-b-${runId}@test.local`;
  console.log(`[e2e setup] Creating passenger_b: ${passengerBEmail}`);
  const passengerBResult = await signupAndVerifyEmail(passengerBEmail);
  const passengerBAccount = toAccountState(passengerBResult, passengerBEmail);

  await authed(passengerBAccount.accessToken).put('/users/me', {
    name: 'Test Passenger Beta',
    salutation: 'MR',
  });

  await authed(passengerBAccount.accessToken).post('/auth/accept-tos', {
    tosVersion: '1.0',
    privacyVersion: '1.0',
  });

  // ── Write state ──────────────────────────────────────────────────────────
  const state: TestState = {
    runId,
    baseUrl: BASE_URL,
    driverA: { ...driverAccount, vehicleId },
    passengerA: passengerAAccount,
    passengerB: passengerBAccount,
    sharedRide,
  };

  writeState(state);
  console.log('[e2e setup] State written. Setup complete.');
}
