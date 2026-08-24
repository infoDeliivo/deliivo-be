/**
 * E2E — Country detected from the request IP
 * Covers: TC-COUNTRY-001 through TC-COUNTRY-004
 *
 * Any authenticated request teaches the backend where the caller appears to connect from, and
 * admin reads it on the user page. The address arrives as `X-Forwarded-For` — in production from
 * the webapp's proxy, here from the test itself.
 *
 * Admin role cannot be assigned via the API — promoted directly in the DB, same pattern as
 * 35-user-locale.e2e.test.ts.
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.test') });

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail } from '../helpers/auth.helper';

const state = readState();

let adminToken: string;
let db: PrismaClient;

function getDb(): PrismaClient {
  const connectionString = process.env.DATABASE_URL ?? '';
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

beforeAll(async () => {
  db = getDb();

  const adminEmail = `e2e-country-admin-${state.runId}@test.local`;
  const result = await signupAndVerifyEmail(adminEmail);
  adminToken = result.accessToken;

  await db.user.update({ where: { id: result.user.id }, data: { role: 'ADMIN' } });

  const refreshRes = await api.post('/auth/access-token', { refreshToken: result.refreshToken });
  if (refreshRes.status === 200 && refreshRes.data?.data?.accessToken) {
    adminToken = refreshRes.data.data.accessToken;
  }
}, 60000);

afterAll(async () => {
  await db?.$disconnect();
});

describe('TC-COUNTRY-001 — an authenticated request places the user', () => {
  it('records the country and shows it to admin', async () => {
    const email = `e2e-country-us-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    const res = await api.get('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '8.8.8.8' },
    });
    expect(res.status).toBe(200);

    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.status).toBe(200);
    expect(admin.data.data.user.detectedCountry).toBe('US');
  });
});

describe('TC-COUNTRY-002 — public routes place the user too', () => {
  it('learns from a token-bearing request to a public endpoint', async () => {
    const email = `e2e-country-public-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    const res = await api.get('/content/posts', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '80.235.1.1' },
    });
    expect(res.status).toBe(200);

    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.detectedCountry).toBe('EE');
  });
});

describe('TC-COUNTRY-003 — the country follows the user', () => {
  it('moves when the same user turns up on another network', async () => {
    const email = `e2e-country-move-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    await api.get('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '80.235.1.1' },
    });
    let admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.detectedCountry).toBe('EE');

    // Nobody chooses their country in the UI, so unlike the language there is no user intent to
    // protect: the newest observation wins.
    await api.get('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '8.8.8.8' },
    });
    admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.detectedCountry).toBe('US');
  });
});

describe('TC-COUNTRY-004 — an address that places nobody changes nothing', () => {
  it('leaves the country unknown for a caller we cannot place', async () => {
    const email = `e2e-country-none-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    // A private address: the request came from inside a network, which names no country.
    const res = await api.get('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '192.168.1.50' },
    });
    expect(res.status).toBe(200);

    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.detectedCountry).toBeNull();
  });

  it('does not wipe a country we already know', async () => {
    const email = `e2e-country-keep-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    await api.get('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '8.8.8.8' },
    });

    await api.get('/users/me', {
      headers: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': '10.0.0.9' },
    });

    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.detectedCountry).toBe('US');
  });
});
