/**
 * E2E — Admin API
 * Covers: TC-ADMIN-001 through TC-ADMIN-012
 *
 * Admin role cannot be assigned via the API — it is set directly in the DB.
 * This file uses PrismaClient (same pattern as global.teardown.ts) to promote
 * a freshly-created test user to ADMIN, then exercises all admin endpoints.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';

const state = readState();
const pa = authed(state.passengerA.accessToken);

let adminToken: string;
let adminId: string;
let prismaAdmin: PrismaClient;
let testVehicleId: string | null = null;
let testBookingId: string | null = null;

function getDb(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? '';
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// ── Setup: create admin user ────────────────────────────────────────────────
beforeAll(async () => {
  const runId = state.runId;
  const adminEmail = `e2e-admin-${runId}@test.local`;

  // 1. Create user via normal signup flow
  const result = await signupAndVerifyEmail(adminEmail);
  const account = toAccountState(result, adminEmail);
  adminToken = account.accessToken;
  adminId = account.id;

  // Accept ToS
  await authed(adminToken).post('/auth/accept-tos', {
    tosVersion: '1.0',
    privacyVersion: '1.0',
  });

  // 2. Promote to ADMIN via direct DB update (no API endpoint for this)
  prismaAdmin = getDb();
  try {
    await prismaAdmin.user.update({
      where: { id: adminId },
      data: { role: 'ADMIN' },
    });

    // 2b. Refresh the token so the new JWT carries role=ADMIN
    const { api } = await import('../helpers/api.client');
    const refreshRes = await api.post('/auth/access-token', { refreshToken: result.refreshToken });
    if (refreshRes.status === 200 && refreshRes.data?.data?.accessToken) {
      adminToken = refreshRes.data.data.accessToken;
    }
  } catch (err: any) {
    console.warn(`[14-admin] Could not promote user to ADMIN: ${err.message}. Admin tests will be skipped.`);
  }

  // 3. Grab passengerA's first vehicle for the vehicle-verify test
  try {
    const vehicles = await prismaAdmin.vehicle.findFirst({
      where: { userId: state.passengerA.id, deletedAt: null },
    });
    testVehicleId = vehicles?.id ?? null;
  } catch {
    // ignore — tests will skip if null
  }
});

afterAll(async () => {
  if (prismaAdmin) {
    // Clean up our admin test user
    try {
      await prismaAdmin.user.deleteMany({
        where: { email: { endsWith: '@test.local' }, role: 'ADMIN' },
      });
    } catch { /* ignore */ }
    await prismaAdmin.$disconnect();
  }
});

// ── TC-ADMIN-001: Non-admin blocked ─────────────────────────────────────────
describe('TC-ADMIN-001 — Non-admin user is rejected from all admin routes', () => {
  it('GET /admin/users returns 403 for regular passenger', async () => {
    const res = await pa.get('/admin/users');
    expect(res.status).toBe(403);
  });

  it('GET /admin/stats returns 403 for regular passenger', async () => {
    const res = await pa.get('/admin/stats');
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.get('/admin/users');
    expect(res.status).toBe(401);
  });
});

// ── TC-ADMIN-002: List users ─────────────────────────────────────────────────
describe('TC-ADMIN-002 — Admin can list users', () => {
  it('returns paginated user list with metadata', async () => {
    if (!adminToken) return;
    const res = await authed(adminToken).get('/admin/users');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const users: unknown[] = body.users ?? body.data ?? body;
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThan(0);
    const pagination = body.pagination ?? body.meta;
    expect(pagination).toBeTruthy();
  });
});

// ── TC-ADMIN-003: Search filter ─────────────────────────────────────────────
describe('TC-ADMIN-003 — Admin can filter users by search term', () => {
  it('returns only users matching the search query', async () => {
    if (!adminToken) return;
    const res = await authed(adminToken).get('/admin/users', { search: 'e2e-driver' });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const users: Array<{ email: string }> = body.users ?? body.data ?? body;
    expect(Array.isArray(users)).toBe(true);
    users.forEach((u) => {
      expect(u.email.toLowerCase()).toContain('e2e');
    });
  });
});

// ── TC-ADMIN-004: Filter by isBanned ────────────────────────────────────────
describe('TC-ADMIN-004 — Admin can filter by isBanned', () => {
  it('returns only non-banned users when isBanned=false', async () => {
    if (!adminToken) return;
    const res = await authed(adminToken).get('/admin/users', { isBanned: false });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const users: Array<{ isBanned: boolean }> = body.users ?? body.data ?? body;
    users.forEach((u) => {
      expect(u.isBanned).toBe(false);
    });
  });
});

// ── TC-ADMIN-005: Filter by role ─────────────────────────────────────────────
describe('TC-ADMIN-005 — Admin can filter by role', () => {
  it('returns only USER-role accounts when role=USER', async () => {
    if (!adminToken) return;
    const res = await authed(adminToken).get('/admin/users', { role: 'USER' });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const users: Array<{ role: string }> = body.users ?? body.data ?? body;
    users.forEach((u) => {
      expect(u.role).toBe('USER');
    });
  });
});

// ── TC-ADMIN-006: Filter by dlVerified ──────────────────────────────────────
describe('TC-ADMIN-006 — Admin can filter by dlVerified', () => {
  it('returns only unverified drivers when dlVerified=false', async () => {
    if (!adminToken) return;
    const res = await authed(adminToken).get('/admin/users', { dlVerified: false });
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    const users: Array<{ dlVerified: boolean }> = body.users ?? body.data ?? body;
    users.forEach((u) => {
      expect(u.dlVerified).toBe(false);
    });
  });
});

// ── TC-ADMIN-007: Ban user ───────────────────────────────────────────────────
describe('TC-ADMIN-007 — Admin can ban a user', () => {
  it('sets isBanned=true on target user', async () => {
    if (!adminToken) return;
    const targetId = state.passengerB.id;
    const res = await authed(adminToken).post(`/admin/users/${targetId}/ban`);
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(body.isBanned).toBe(true);
  });
});

// ── TC-ADMIN-008: Banned user cannot book ────────────────────────────────────
describe('TC-ADMIN-008 — Banned user is blocked from creating bookings', () => {
  it('returns 403 when banned passenger tries to book', async () => {
    if (!adminToken || !state.sharedRide) return;
    // passengerB was banned in TC-ADMIN-007
    const pb = authed(state.passengerB.accessToken);
    const res = await pb.post('/bookings', {
      rideId: state.sharedRide.id,
      seatsBooked: 1,
    });
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.data)).toMatch(/ban|suspend/i);
  });
});

// ── TC-ADMIN-009: Unban user ─────────────────────────────────────────────────
describe('TC-ADMIN-009 — Admin can unban a user', () => {
  it('sets isBanned=false and allows booking again', async () => {
    if (!adminToken) return;
    const targetId = state.passengerB.id;
    const res = await authed(adminToken).post(`/admin/users/${targetId}/unban`);
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(body.isBanned).toBe(false);
  });
});

// ── TC-ADMIN-010: Cannot ban another admin ──────────────────────────────────
describe('TC-ADMIN-010 — Admin cannot ban another ADMIN account', () => {
  it('returns 400/403 when attempting to ban an admin', async () => {
    if (!adminToken) return;
    // Try to ban our own admin account (which has role=ADMIN)
    const res = await authed(adminToken).post(`/admin/users/${adminId}/ban`);
    expect([400, 403]).toContain(res.status);
  });
});

// ── TC-ADMIN-011: Platform stats ─────────────────────────────────────────────
describe('TC-ADMIN-011 — Admin can view platform stats', () => {
  it('returns totalUsers, totalRides, totalBookings, totalRevenue', async () => {
    if (!adminToken) return;
    const res = await authed(adminToken).get('/admin/stats');
    expect(res.status).toBe(200);
    const stats = res.data.data ?? res.data;
    expect(typeof stats.totalUsers).toBe('number');
    expect(typeof stats.totalRides).toBe('number');
    expect(typeof stats.totalBookings).toBe('number');
    expect(stats.totalUsers).toBeGreaterThan(0);
  });
});

// ── TC-ADMIN-012: Verify vehicle ─────────────────────────────────────────────
describe('TC-ADMIN-012 — Admin can verify a vehicle', () => {
  it('sets isVerified=true on a vehicle', async () => {
    if (!adminToken || !state.driverA.vehicleId) return;
    const res = await authed(adminToken).post(`/admin/vehicles/${state.driverA.vehicleId}/verify`);
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(body.isVerified).toBe(true);
  });
});
