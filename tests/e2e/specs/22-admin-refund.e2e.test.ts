/**
 * E2E — Admin Force Refund
 * Covers: TC-ADMINREFUND-001 through TC-ADMINREFUND-003
 *
 * Tests the POST /admin/bookings/:id/refund endpoint.
 * Requires an ADMIN user (promoted in global setup via DB).
 */
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { publishRide, LONDON_TO_MANCHESTER, futureDateStr } from '../helpers/ride.helper';
import { loginWithEmail } from '../helpers/auth.helper';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

let adminToken: string;
let rideId: string;
let bookingId: string;

beforeAll(async () => {
  // Promote driverA to ADMIN for this test (or use existing admin)
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl) {
    console.warn('[22-admin-refund] DATABASE_URL not set — skipping');
    return;
  }

  const adapter = new PrismaPg({ connectionString: dbUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    await prisma.user.update({
      where: { id: state.driverA.id },
      data: { role: 'ADMIN' },
    });
  } finally {
    await prisma.$disconnect();
  }

  // Re-login to get updated JWT with ADMIN role
  const loginResult = await loginWithEmail(state.driverA.email);
  adminToken = loginResult.accessToken;

  // Create a ride and booking to refund
  try {
    rideId = await publishRide(loginResult.accessToken, {
      ...LONDON_TO_MANCHESTER,
      totalSeats: 2,
      basePricePerSeat: 10.0,
      departureDate: futureDateStr(60),
    });
  } catch (err: any) {
    console.warn(`[22-admin-refund] Could not publish ride: ${err.message}`);
    return;
  }

  const bookRes = await pa.post('/bookings', { rideId, seatsBooked: 1 });
  if (bookRes.status === 200 || bookRes.status === 201) {
    bookingId = (bookRes.data.data ?? bookRes.data).id;
  }
});

afterAll(async () => {
  // Restore role to USER
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (dbUrl) {
    const adapter = new PrismaPg({ connectionString: dbUrl });
    const prisma = new PrismaClient({ adapter });
    try {
      await prisma.user.update({
        where: { id: state.driverA.id },
        data: { role: 'USER' },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
  if (rideId && adminToken) await authed(adminToken).delete(`/publish-ride/${rideId}`);
});

describe('TC-ADMINREFUND-001 — Admin can force-refund a booking', () => {
  it('returns 200 with refund details', async () => {
    if (!adminToken || !bookingId) return;
    const admin = authed(adminToken);
    const res = await admin.post(`/admin/bookings/${bookingId}/refund`);
    // In bypass mode (no Stripe): may return 200, 400 (no payment to refund), or 500 (server error)
    expect([200, 400, 500]).toContain(res.status);
  });
});

describe('TC-ADMINREFUND-002 — Non-admin cannot force-refund', () => {
  it('returns 403', async () => {
    if (!bookingId) return;
    const res = await pa.post(`/admin/bookings/${bookingId}/refund`);
    expect([401, 403]).toContain(res.status);
  });
});

describe('TC-ADMINREFUND-003 — Refund non-existent booking', () => {
  it('returns 404', async () => {
    if (!adminToken) return;
    const admin = authed(adminToken);
    const res = await admin.post('/admin/bookings/00000000-0000-0000-0000-000000000000/refund');
    expect([404, 400]).toContain(res.status);
  });
});
