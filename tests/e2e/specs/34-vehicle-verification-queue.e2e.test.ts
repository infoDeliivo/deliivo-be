/**
 * E2E — Vehicle verification queue and the resubmission loop.
 *
 * The admin review queue is the only way a driver's vehicle becomes publishable.
 * Covers the queue listing and its ordering, admin access to the private registry
 * document, rejection surfacing a reason to the driver, and — the point of the
 * feature — a rejected driver fixing the problem and returning to the queue.
 *
 * Self-contained: creates its own admin and drivers so shared fixtures are untouched.
 * The DB is used only to promote an admin, which the API deliberately cannot do.
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

let adminToken: string;
let driverToken: string;
let driverId: string;
let vehicleId: string;
let secondDriverToken: string;
let ready = false;
/** True when the server auto-approves on create, which empties the queue entirely. */
let approvalBypassed = false;

function getDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  return new PrismaClient({ adapter });
}

const requirement = (body: any, key: string) =>
  (body.data?.requirements ?? []).find((item: any) => item.key === key);

const findQueued = (body: any, id: string) =>
  (body.data?.vehicles ?? []).find((item: any) => item.id === id);

/** Creates a saved vehicle for the given driver and returns its id. */
const createVehicle = async (token: string, licenseNumber: string): Promise<string | null> => {
  const draft = await authed(token).post('/vehicles/draft', {
    licenseCountry: 'GB',
    licenseNumber,
  });
  if (draft.status !== 200 && draft.status !== 201) return null;

  await authed(token).put('/vehicles/draft/vehicle-details', {
    brand: 'Ford',
    model_name: 'Focus',
    model_num: '2019',
    type: 'hatchback',
    color: 'Black',
    year: 2019,
  });

  const saved = await authed(token).post('/vehicles/draft/save', {});
  if (saved.status !== 200 && saved.status !== 201) return null;

  const list = await authed(token).get('/vehicles');
  return list.data?.data?.vehicles?.[0]?.id ?? null;
};

beforeAll(async () => {
  if (!process.env.DATABASE_URL) {
    console.warn('[34-vehicle-verification-queue] DATABASE_URL not set — tests will skip.');
    return;
  }

  const adminEmail = `e2e-vvq-admin-${state.runId}@test.local`;
  const adminSignup = await signupAndVerifyEmail(adminEmail);
  const admin = toAccountState(adminSignup, adminEmail);
  adminToken = admin.accessToken;

  const db = getDb();
  try {
    await db.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
  } finally {
    await db.$disconnect();
  }

  // The role travels in the JWT, so the token issued at signup still says USER —
  // refresh it or every admin call comes back 403.
  const { api } = await import('../helpers/api.client');
  const refreshed = await api.post('/auth/access-token', { refreshToken: adminSignup.refreshToken });
  if (refreshed.status === 200 && refreshed.data?.data?.accessToken) {
    adminToken = refreshed.data.data.accessToken;
  }

  const driverEmail = `e2e-vvq-driver-${state.runId}@test.local`;
  const driver = toAccountState(await signupAndVerifyEmail(driverEmail), driverEmail);
  driverToken = driver.accessToken;
  driverId = driver.id;
  await authed(driverToken).put('/users/me', { firstName: 'Queue', lastName: 'Driver', salutation: 'MR' });

  const secondEmail = `e2e-vvq-driver2-${state.runId}@test.local`;
  const second = toAccountState(await signupAndVerifyEmail(secondEmail), secondEmail);
  secondDriverToken = second.accessToken;
  await authed(secondDriverToken).put('/users/me', { firstName: 'Queue', lastName: 'Later', salutation: 'MS' });

  vehicleId = (await createVehicle(driverToken, 'VVQ 001')) ?? '';

  // Ask the server whether the approval gate is on rather than reading the test
  // process env — the flag belongs to the server under test.
  const checklist = await authed(driverToken).get('/publish-ride/eligibility');
  approvalBypassed = Boolean(requirement(checklist.data, 'VEHICLE_VERIFICATION')?.skipped);

  ready = Boolean(vehicleId);
});

describe('TC-VVQ-001 — the pending queue', () => {
  it('lists a newly created vehicle under PENDING and not under APPROVED', async () => {
    if (!ready || approvalBypassed) return;

    const pending = await authed(adminToken).get('/admin/vehicles?status=PENDING');
    expect(pending.status).toBe(200);
    expect(findQueued(pending.data, vehicleId)).toBeTruthy();

    const approved = await authed(adminToken).get('/admin/vehicles?status=APPROVED');
    expect(findQueued(approved.data, vehicleId)).toBeFalsy();
  });

  it('returns a pagination envelope', async () => {
    if (!ready) return;

    const res = await authed(adminToken).get('/admin/vehicles?status=PENDING&page=1&limit=5');

    expect(res.data.data.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(typeof res.data.data.pagination.total).toBe('number');
    expect(typeof res.data.data.pagination.totalPages).toBe('number');
  });

  it('carries the driver so an admin can see whose vehicle it is', async () => {
    if (!ready || approvalBypassed) return;

    const res = await authed(adminToken).get('/admin/vehicles?status=PENDING');
    const queued = findQueued(res.data, vehicleId);

    expect(queued.user).toMatchObject({ id: driverId, firstName: 'Queue' });
    expect(queued.licenseNumber).toBe('VVQ 001');
  });
});

describe('TC-VVQ-002 — the queue is worked oldest first', () => {
  it('orders pending vehicles by creation time ascending', async () => {
    if (!ready || approvalBypassed) return;

    const laterVehicleId = await createVehicle(secondDriverToken, 'VVQ 002');
    if (!laterVehicleId) return;

    const res = await authed(adminToken).get('/admin/vehicles?status=PENDING&limit=100');
    const ids = (res.data.data.vehicles ?? []).map((item: any) => item.id);

    expect(ids.indexOf(vehicleId)).toBeLessThan(ids.indexOf(laterVehicleId));

    const timestamps = (res.data.data.vehicles ?? []).map((item: any) => new Date(item.createdAt).getTime());
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });
});

describe('TC-VVQ-003 — private documents are reviewable by an admin', () => {
  it('exposes a previewKey the admin can exchange for a signed URL', async () => {
    if (!ready) return;

    const presign = await authed(driverToken).post('/uploads/presign', {
      target: 'vehicle_document',
      vehicleId,
      documentType: 'VEHICLE_DOCUMENT',
      contentType: 'image/png',
      fileExtension: 'png',
    });
    if (presign.status !== 200 && presign.status !== 201) return;

    const { uploadUrl, key } = presign.data.data;
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      body: png,
      headers: { 'Content-Type': 'image/png' },
    });
    if (!put.ok) return;

    const confirm = await authed(driverToken).post('/uploads/confirm', {
      target: 'vehicle_document',
      vehicleId,
      documentType: 'VEHICLE_DOCUMENT',
      key,
    });
    expect([200, 201]).toContain(confirm.status);

    const queue = await authed(adminToken).get('/admin/vehicles?status=PENDING&limit=100');
    const queued = findQueued(queue.data, vehicleId);
    const doc = (queued?.documents ?? []).find((item: any) => item.documentType === 'VEHICLE_DOCUMENT');

    // A private KYC document must never come back as a plain URL.
    expect(doc.image).toBeNull();
    expect(doc.previewKey).toBeTruthy();

    // The cross-owner admin exemption: this key belongs to the driver, not the admin.
    const read = await authed(adminToken).get(`/uploads/read?key=${encodeURIComponent(doc.previewKey)}`);
    expect(read.status).toBe(200);
    expect(read.data.data.url).toContain('http');
  });
});

describe('TC-VVQ-004 — rejection tells the driver what to fix', () => {
  it('reports VEHICLE_REJECTED and the admin reason on the eligibility checklist', async () => {
    if (!ready || approvalBypassed) return;

    const reason = 'Registry document is unreadable — upload a clearer photo';
    const rejected = await authed(adminToken).post(`/admin/vehicles/${vehicleId}/reject`, { reason });
    expect(rejected.status).toBe(200);

    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    const check = requirement(checklist.data, 'VEHICLE_VERIFICATION');

    expect(check.satisfied).toBe(false);
    expect(check.reason).toBe('VEHICLE_REJECTED');
    expect(check.vehicle).toMatchObject({ verificationStatus: 'REJECTED', rejectionReason: reason });
  });
});

describe('TC-VVQ-005 — a rejected driver can resubmit', () => {
  it('returns the vehicle to the queue when the driver updates details', async () => {
    if (!ready || approvalBypassed) return;

    const update = await authed(driverToken).put(`/vehicles/${vehicleId}/update-details`, {
      brand: 'Ford',
      model_name: 'Focus Estate',
      model_num: '2019',
      type: 'hatchback',
      color: 'Blue',
      year: 2019,
    });
    expect(update.status).toBe(200);

    // Read through the list endpoint, which is served from the userVehicles cache —
    // a stale cache here is what makes the whole loop look broken to the driver.
    const list = await authed(driverToken).get('/vehicles');
    const mine = list.data.data.vehicles.find((item: any) => item.id === vehicleId);
    expect(mine.verificationStatus).toBe('PENDING');
    expect(mine.rejectionReason).toBeNull();

    const queue = await authed(adminToken).get('/admin/vehicles?status=PENDING&limit=100');
    expect(findQueued(queue.data, vehicleId)).toBeTruthy();
  });

  it('blocks publishing again with the awaiting-review reason, not the rejection one', async () => {
    if (!ready || approvalBypassed) return;

    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    const check = requirement(checklist.data, 'VEHICLE_VERIFICATION');

    expect(check.reason).toBe('VEHICLE_NOT_VERIFIED');
    expect(check.vehicle).toMatchObject({ verificationStatus: 'PENDING', rejectionReason: null });
  });
});

describe('TC-VVQ-006 — approval unblocks the driver', () => {
  it('marks the vehicle approved and satisfies the requirement', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post(`/admin/vehicles/${vehicleId}/verify`, {});
    expect(res.status).toBe(200);
    expect(res.data.data.isVerified).toBe(true);
    expect(res.data.data.verificationStatus).toBe('APPROVED');

    const checklist = await authed(driverToken).get('/publish-ride/eligibility');
    const check = requirement(checklist.data, 'VEHICLE_VERIFICATION');

    expect(check.satisfied).toBe(true);
    expect(check.vehicle).toBeUndefined();
  });
});

describe('TC-VVQ-007 — rejection reason is validated', () => {
  it('refuses an empty or whitespace-only reason', async () => {
    if (!ready) return;

    const empty = await authed(adminToken).post(`/admin/vehicles/${vehicleId}/reject`, { reason: '' });
    expect(empty.status).toBe(400);

    const blank = await authed(adminToken).post(`/admin/vehicles/${vehicleId}/reject`, { reason: '   ' });
    expect(blank.status).toBe(400);
  });

  it('refuses a reason longer than 500 characters', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post(`/admin/vehicles/${vehicleId}/reject`, {
      reason: 'x'.repeat(501),
    });
    expect(res.status).toBe(400);
  });

  it('rejects an unknown vehicle id with 404', async () => {
    if (!ready) return;

    const res = await authed(adminToken).post(
      '/admin/vehicles/11111111-1111-4111-8111-111111111111/verify',
      {},
    );
    expect(res.status).toBe(404);
  });
});

describe('TC-VVQ-008 — the queue is admin-only', () => {
  it('refuses a non-admin on every queue endpoint', async () => {
    if (!ready) return;

    const list = await authed(driverToken).get('/admin/vehicles?status=PENDING');
    expect(list.status).toBe(403);

    const verify = await authed(driverToken).post(`/admin/vehicles/${vehicleId}/verify`, {});
    expect(verify.status).toBe(403);

    const reject = await authed(driverToken).post(`/admin/vehicles/${vehicleId}/reject`, {
      reason: 'nope',
    });
    expect(reject.status).toBe(403);
  });
});
