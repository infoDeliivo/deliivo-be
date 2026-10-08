/**
 * E2E — Admin users list: verification summary, pending-review filter and sorting.
 *
 * A driver with a freshly created vehicle must show up under `pending=true` with a
 * VEHICLE_REVIEW item; once an admin approves the vehicle the user leaves the pending
 * filter and the summary flips to APPROVED.
 *
 * Self-contained: creates its own admin and driver. The DB is used only to promote the
 * admin, which the API deliberately cannot do.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';

interface VerificationSummary {
  dl: string;
  vehicle: { state: string; pending: number; approved: number; rejected: number };
  payout: { state: string; mismatch: boolean };
  pending: Array<{ kind: string; count: number }>;
}

interface ListedUser {
  id: string;
  email: string | null;
  firstName: string | null;
  stripeAccountId?: unknown;
  dlVerifications?: unknown;
  verification: VerificationSummary;
}

interface ListUsersBody {
  data?: { users?: ListedUser[] };
}

const state = readState();

let adminToken: string;
let driverToken: string;
let driverId: string;
let driverEmail: string;
let vehicleId = '';
let ready = false;
let approvalBypassed = false;

function getDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  return new PrismaClient({ adapter });
}

const listUsers = async (query: string): Promise<ListedUser[]> => {
  const res = await authed(adminToken).get<ListUsersBody>(`/admin/users?${query}`);
  expect(res.status).toBe(200);
  return res.data.data?.users ?? [];
};

const findDriver = (users: ListedUser[]) => users.find((user) => user.id === driverId);

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn('[43-admin-user-verification-columns] DATABASE_URL not set — tests will skip.');
    return;
  }

  const adminEmail = `e2e-auvc-admin-${state.runId}@test.local`;
  const adminSignup = await signupAndVerifyEmail(adminEmail);
  const admin = toAccountState(adminSignup, adminEmail);

  const db = getDb();
  try {
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  } finally {
    await db.$disconnect();
  }

  // The role travels in the JWT; refresh so admin calls are not 403.
  const refreshed = await api.post('/auth/access-token', { refreshToken: adminSignup.refreshToken });
  adminToken = refreshed.data?.data?.accessToken ?? admin.accessToken;

  driverEmail = `e2e-auvc-driver-${state.runId}@test.local`;
  const driver = toAccountState(await signupAndVerifyEmail(driverEmail), driverEmail);
  driverToken = driver.accessToken;
  driverId = driver.id;
  await authed(driverToken).put('/users/me', { firstName: 'Pending', lastName: 'Driver', salutation: 'MR' });

  const draft = await authed(driverToken).post('/vehicles/draft', { licenseCountry: 'GB', licenseNumber: 'AUVC 001' });
  if (draft.status === 200 || draft.status === 201) {
    await authed(driverToken).put('/vehicles/draft/vehicle-details', {
      brand: 'Ford',
      model_name: 'Focus',
      model_num: '2019',
      type: 'hatchback',
      color: 'Black',
      year: 2019,
    });
    const saved = await authed(driverToken).post('/vehicles/draft/save', {});
    if (saved.status === 200 || saved.status === 201) {
      const list = await authed(driverToken).get<{ data?: { vehicles?: Array<{ id: string }> } }>('/vehicles');
      vehicleId = list.data.data?.vehicles?.[0]?.id ?? '';
    }
  }

  const checklist = await authed(driverToken).get<{ data?: { requirements?: Array<{ key: string; skipped?: boolean }> } }>(
    '/publish-ride/eligibility',
  );
  approvalBypassed = Boolean(checklist.data.data?.requirements?.find((item) => item.key === 'VEHICLE')?.skipped);

  ready = Boolean(vehicleId);
});

describe('TC-AUVC-001 — verification summary on the users list', () => {
  it('returns a derived summary and no raw Stripe or DL rows', async () => {
    if (!ready) return;

    const driver = findDriver(await listUsers(`search=${encodeURIComponent(driverEmail)}`));
    expect(driver).toBeDefined();
    expect(driver?.stripeAccountId).toBeUndefined();
    expect(driver?.dlVerifications).toBeUndefined();
    expect(driver?.verification).toMatchObject({
      dl: 'NONE',
      payout: { state: 'NOT_STARTED', mismatch: false },
    });
  });
});

describe('TC-AUVC-004 — per-column filters', () => {
  it('finds the driver by full name and email, and not by a name that does not match', async () => {
    if (!ready) return;

    expect(findDriver(await listUsers(`name=${encodeURIComponent('pending driver')}`))).toBeDefined();
    expect(findDriver(await listUsers(`email=${encodeURIComponent(driverEmail.toUpperCase())}`))).toBeDefined();
    expect(findDriver(await listUsers(`name=${encodeURIComponent('pending nobody')}&email=${encodeURIComponent(driverEmail)}`))).toBeUndefined();
  });

  it('includes the driver in a joined window around now and rejects an invalid date', async () => {
    if (!ready) return;

    const from = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(findDriver(await listUsers(`joinedFrom=${from}&email=${encodeURIComponent(driverEmail)}`))).toBeDefined();

    const res = await authed(adminToken).get('/admin/users?joinedFrom=not-a-date');
    expect(res.status).toBe(400);
  });
});

describe('TC-AUVC-002 — pending review filter', () => {
  it('lists a driver with a PENDING vehicle under pending=true', async () => {
    if (!ready || approvalBypassed) return;

    const driver = findDriver(await listUsers(`pending=true&search=${encodeURIComponent(driverEmail)}`));
    expect(driver?.verification.vehicle).toMatchObject({ state: 'PENDING', pending: 1 });
    expect(driver?.verification.pending).toContainEqual({ kind: 'VEHICLE_REVIEW', count: 1 });
  });

  it('matches the driver on vehicleState=PENDING and payoutState=NOT_STARTED, not on vehicleState=APPROVED', async () => {
    if (!ready || approvalBypassed) return;

    const search = encodeURIComponent(driverEmail);
    expect(findDriver(await listUsers(`vehicleState=PENDING&payoutState=NOT_STARTED&search=${search}`))).toBeDefined();
    expect(findDriver(await listUsers(`vehicleState=APPROVED&search=${search}`))).toBeUndefined();
  });

  it('drops the driver from pending=true once the vehicle is approved', async () => {
    if (!ready || approvalBypassed) return;

    const verified = await authed(adminToken).post(`/admin/vehicles/${vehicleId}/verify`, {});
    expect(verified.status).toBe(200);

    expect(findDriver(await listUsers(`pending=true&search=${encodeURIComponent(driverEmail)}`))).toBeUndefined();

    const driver = findDriver(await listUsers(`search=${encodeURIComponent(driverEmail)}`));
    expect(driver?.verification.vehicle.state).toBe('APPROVED');
    expect(findDriver(await listUsers(`vehicleState=APPROVED&search=${encodeURIComponent(driverEmail)}`))).toBeDefined();
    expect(driver?.verification.pending).toEqual([]);
  });
});

describe('TC-AUVC-003 — query validation and sorting', () => {
  it('rejects an unknown sortBy with 400', async () => {
    if (!ready) return;

    const res = await authed(adminToken).get('/admin/users?sortBy=password');
    expect(res.status).toBe(400);
  });

  it('sorts by email in both directions', async () => {
    if (!ready) return;

    // Both accounts share the run's prefix; "admin" sorts before "driver" under any collation.
    const prefix = encodeURIComponent(`e2e-auvc-`);
    const asc = (await listUsers(`status=all&sortBy=email&sortDir=asc&search=${prefix}`)).map((user) => user.id);
    const desc = (await listUsers(`status=all&sortBy=email&sortDir=desc&search=${prefix}`)).map((user) => user.id);
    const ascDriver = asc.indexOf(driverId);
    const descDriver = desc.indexOf(driverId);
    expect(ascDriver).toBeGreaterThan(-1);
    expect(descDriver).toBeGreaterThan(-1);
    expect(asc).toEqual([...desc].reverse());
  });
});
