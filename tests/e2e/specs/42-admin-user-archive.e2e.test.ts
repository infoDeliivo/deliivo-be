/**
 * E2E — Admin archive / restore / purge, and the admin user-list filters
 * Covers: TC-ARCHIVE-001 through TC-ARCHIVE-011
 *
 * Archive is the reversible removal: the account is locked out and hidden from the default
 * list, but keeps its data so restore brings it straight back. Purge (permanent) only works
 * on an archived user, with the user's phone (or email when it has none) typed to confirm.
 *
 * Every user here is created by this spec, so archiving never disturbs the shared
 * passenger/driver accounts the other specs depend on. Admin role is set directly in the DB,
 * same pattern as 14-admin.e2e.test.ts.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { loginWithEmail, signupAndVerifyEmail } from '../helpers/auth.helper';

const state = readState();

let db: PrismaClient;
let adminToken: string;
let adminId: string;
let targetId: string;
let targetEmail: string;
let targetToken: string;
let estonianId: string;

type ListedUser = { id: string; archivedAt: string | null; detectedCountry: string | null; dlVerified: boolean };

function getDb(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' });
  return new PrismaClient({ adapter });
}

const listIds = async (params: Record<string, unknown>): Promise<string[]> => {
  const res = await authed(adminToken).get('/admin/users', { limit: 100, ...params });
  expect(res.status).toBe(200);
  return (res.data.data.users as ListedUser[]).map((user) => user.id);
};

beforeAll(async () => {
  db = getDb();
  const runId = state.runId;

  const admin = await signupAndVerifyEmail(`e2e-archive-admin-${runId}@test.local`);
  adminId = admin.user.id;
  await db.user.update({ where: { id: adminId }, data: { role: 'ADMIN' } });
  const refreshed = await api.post('/auth/access-token', { refreshToken: admin.refreshToken });
  adminToken = refreshed.data.data.accessToken;

  targetEmail = `e2e-archive-target-${runId}@test.local`;
  const target = await signupAndVerifyEmail(targetEmail);
  targetId = target.user.id;
  targetToken = target.accessToken;

  // Country and DL state are set directly: the country normally comes from the request IP,
  // which on localhost resolves to nothing.
  const estonian = await signupAndVerifyEmail(`e2e-archive-ee-${runId}@test.local`);
  estonianId = estonian.user.id;
  await db.user.update({ where: { id: estonianId }, data: { detectedCountry: 'Tallinn, EE', dlVerified: true } });
  await db.user.update({ where: { id: targetId }, data: { detectedCountry: 'New Delhi, IN', dlVerified: false } });
});

afterAll(async () => {
  if (!db) return;
  await db.adminUserAuditLog.deleteMany({ where: { actorId: adminId } }).catch(() => undefined);
  await db.$disconnect();
});

describe('Admin user archive', () => {
  test('TC-ARCHIVE-001: a non-admin cannot archive', async () => {
    const res = await authed(targetToken).post(`/admin/users/${estonianId}/archive`, {});
    expect(res.status).toBe(403);
  });

  test('TC-ARCHIVE-002: archive locks the account out at once and keeps its data', async () => {
    expect((await authed(targetToken).get('/users/me')).status).toBe(200);

    const res = await authed(adminToken).post(`/admin/users/${targetId}/archive`, { reason: 'E2E test account' });
    expect(res.status).toBe(200);
    expect(res.data.data.archivedAt).toBeTruthy();

    // The live access token dies immediately, via the banned:<id> key protect checks.
    expect((await authed(targetToken).get('/users/me')).status).toBe(403);

    const row = await db.user.findUnique({ where: { id: targetId } });
    expect(row?.email).toBe(targetEmail);
    expect(row?.archiveReason).toBe('E2E test account');
    expect(row?.archivedById).toBe(adminId);
  });

  test('TC-ARCHIVE-003: an archived account cannot log in again', async () => {
    const res = await api.post('/auth/login', { method: 'email', identifier: targetEmail });
    expect(res.status).toBe(403);
  });

  test('TC-ARCHIVE-004: archived users leave the default list and appear under status=archived', async () => {
    expect(await listIds({ search: targetEmail })).not.toContain(targetId);
    expect(await listIds({ search: targetEmail, status: 'active' })).not.toContain(targetId);
    expect(await listIds({ search: targetEmail, status: 'archived' })).toContain(targetId);
    expect(await listIds({ search: targetEmail, status: 'all' })).toContain(targetId);
  });

  test('TC-ARCHIVE-005: archiving twice, or banning an archived user, is a conflict', async () => {
    expect((await authed(adminToken).post(`/admin/users/${targetId}/archive`, {})).status).toBe(409);
    expect((await authed(adminToken).post(`/admin/users/${targetId}/ban`)).status).toBe(409);
  });

  test('TC-ARCHIVE-006: purge with the wrong confirmation is refused and deletes nothing', async () => {
    const res = await authed(adminToken).post(`/admin/users/${targetId}/purge`, {
      confirmIdentifier: 'someone-else@test.local',
    });
    expect(res.status).toBe(400);
    expect(await db.user.findUnique({ where: { id: targetId } })).not.toBeNull();
  });

  test('TC-ARCHIVE-007: the detail view reports archive state', async () => {
    const res = await authed(adminToken).get(`/admin/users/${targetId}`);
    expect(res.status).toBe(200);
    expect(res.data.data.user).toMatchObject({
      archiveReason: 'E2E test account',
      archivedBy: expect.objectContaining({ id: adminId }),
    });
  });

  test('TC-ARCHIVE-008: restore brings the account back and it can log in', async () => {
    const res = await authed(adminToken).post(`/admin/users/${targetId}/restore`);
    expect(res.status).toBe(200);
    expect(res.data.data.archivedAt).toBeNull();

    expect(await listIds({ search: targetEmail, status: 'active' })).toContain(targetId);

    const tokens = await loginWithEmail(targetEmail);
    expect((await authed(tokens.accessToken).get('/users/me')).status).toBe(200);

    expect((await authed(adminToken).post(`/admin/users/${targetId}/restore`)).status).toBe(409);

    const audit = await db.adminUserAuditLog.findMany({ where: { targetUserId: targetId }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((row) => row.action)).toEqual(['ARCHIVE', 'RESTORE']);
  });
});

describe('Admin user list filters', () => {
  test('TC-ARCHIVE-009: filter by country and DL verification', async () => {
    const estonians = await listIds({ country: 'ee', status: 'all' });
    expect(estonians).toContain(estonianId);
    expect(estonians).not.toContain(targetId);

    const indians = await listIds({ country: 'IN', status: 'all' });
    expect(indians).toContain(targetId);

    expect(await listIds({ country: 'EE', dlVerified: 'true', status: 'all' })).toContain(estonianId);
    expect(await listIds({ country: 'EE', dlVerified: 'false', status: 'all' })).not.toContain(estonianId);

    const bad = await authed(adminToken).get('/admin/users', { country: 'Estonia' });
    expect(bad.status).toBe(400);
  });

  test('TC-ARCHIVE-010: the countries endpoint lists codes that have users', async () => {
    const res = await authed(adminToken).get('/admin/users/countries', { status: 'all' });
    expect(res.status).toBe(200);
    const codes = (res.data.data.countries as Array<{ code: string; count: number }>).map((entry) => entry.code);
    expect(codes).toEqual(expect.arrayContaining(['EE', 'IN']));
  });
});

describe('Admin user purge', () => {
  test('TC-ARCHIVE-011: a live user cannot be purged; an archived one is deleted and audited', async () => {
    const email = `e2e-archive-ee-${state.runId}@test.local`;

    // Purge never skips the reversible step.
    const live = await authed(adminToken).post(`/admin/users/${estonianId}/purge`, { confirmIdentifier: email });
    expect(live.status).toBe(409);

    expect((await authed(adminToken).post(`/admin/users/${estonianId}/archive`, { reason: 'E2E purge' })).status).toBe(200);

    // Email-only account, so it is confirmed by its email.
    const res = await authed(adminToken).post(`/admin/users/${estonianId}/purge`, { confirmIdentifier: email.toUpperCase() });
    expect(res.status).toBe(200);
    expect(res.data.data).toEqual({ id: estonianId, purged: true });

    expect(await db.user.findUnique({ where: { id: estonianId } })).toBeNull();
    const audit = await db.adminUserAuditLog.findMany({ where: { targetUserId: estonianId }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((row) => row.action)).toEqual(['ARCHIVE', 'PURGE']);
    expect(audit[1].targetSnapshot).toMatchObject({ email });
  });
});
