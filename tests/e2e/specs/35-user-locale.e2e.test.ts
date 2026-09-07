/**
 * E2E — User language captured at signup
 * Covers: TC-LOCALE-001 through TC-LOCALE-005
 *
 * The website sends the language it is being used in on POST /auth/signup. The backend resolves
 * it to a supported language (en/et/ru) and stores it on the user, where admin can read it.
 *
 * Admin role cannot be assigned via the API — promoted directly in the DB, same pattern as
 * 14-admin.e2e.test.ts.
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

/**
 * Sign up a brand-new email user, sending `locale` in the body and/or an Accept-Language header,
 * then verify the OTP. Returns the created user id.
 */
async function signupWithLocale(
  email: string,
  body: Record<string, unknown>,
  headers?: Record<string, string>,
): Promise<string> {
  const signupRes = await api.post(
    '/auth/signup',
    { method: 'email', email, ...body },
    headers ? { headers } : undefined,
  );
  if (signupRes.status !== 201) {
    throw new Error(`Signup failed for ${email}: HTTP ${signupRes.status} — ${JSON.stringify(signupRes.data)}`);
  }

  const code: string = signupRes.data?.data?.code;
  if (!code) {
    throw new Error('OTP not in signup response — start the server with EXPOSE_OTP_IN_RESPONSE=true');
  }

  const verifyRes = await api.post('/auth/otp/verify', {
    identifier: email,
    code,
    purpose: 'signup',
    method: 'email',
  });
  if (verifyRes.status !== 200) {
    throw new Error(`OTP verify failed for ${email}: HTTP ${verifyRes.status} — ${JSON.stringify(verifyRes.data)}`);
  }

  return verifyRes.data.data.user.id;
}

beforeAll(async () => {
  db = getDb();

  const adminEmail = `e2e-locale-admin-${state.runId}@test.local`;
  const result = await signupAndVerifyEmail(adminEmail);
  adminToken = result.accessToken;

  await db.user.update({ where: { id: result.user.id }, data: { role: 'ADMIN' } });

  // Re-issue the token so the JWT carries role=ADMIN.
  const refreshRes = await api.post('/auth/access-token', { refreshToken: result.refreshToken });
  if (refreshRes.status === 200 && refreshRes.data?.data?.accessToken) {
    adminToken = refreshRes.data.data.accessToken;
  }
}, 60000);

afterAll(async () => {
  await db?.$disconnect();
});

describe('TC-LOCALE-001 — a supported locale sent by the website is stored', () => {
  it('stores et and shows it to admin', async () => {
    const email = `e2e-locale-et-${state.runId}@test.local`;
    const userId = await signupWithLocale(email, { locale: 'et' });

    const res = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.data.data.user.preferredLocale).toBe('et');
  });
});

describe('TC-LOCALE-002 — a full tag is reduced to its language', () => {
  it('stores ru-RU as ru', async () => {
    const email = `e2e-locale-ruru-${state.runId}@test.local`;
    const userId = await signupWithLocale(email, { locale: 'ru-RU' });

    const res = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.data.data.user.preferredLocale).toBe('ru');
  });
});

describe('TC-LOCALE-003 — nothing is invented when the language is unknown', () => {
  it('leaves preferredLocale null for an unsupported locale and still creates the user', async () => {
    const email = `e2e-locale-none-${state.runId}@test.local`;
    // Unsupported in both the body and the header, so neither source can resolve.
    const userId = await signupWithLocale(email, { locale: 'de-DE' }, { 'Accept-Language': 'fr-FR' });

    const res = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.data.data.user.preferredLocale).toBeNull();
  });
});

describe('TC-LOCALE-004 — Accept-Language is the fallback', () => {
  it('uses the header when the website sends no locale', async () => {
    const email = `e2e-locale-header-${state.runId}@test.local`;
    const userId = await signupWithLocale(email, {}, { 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8' });

    const res = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.data.data.user.preferredLocale).toBe('ru');
  });
});

describe('TC-LOCALE-006 — every language the website ships in is accepted', () => {
  // Mirrors SUPPORTED_LOCALES in the webapp's src/lib/i18n.ts, including the /ee/ URL code it
  // uses for Estonian. A language the site offers but the API drops stores null instead.
  it.each([
    ['en', 'en'],
    ['et', 'et'],
    ['ee', 'et'],
    ['lv', 'lv'],
    ['lt', 'lt'],
    ['ru', 'ru'],
  ])('stores %s as %s', async (sent, stored) => {
    const email = `e2e-locale-all-${sent}-${state.runId}@test.local`;
    const userId = await signupWithLocale(email, { locale: sent });

    const res = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.data.data.user.preferredLocale).toBe(stored);
  });
});

describe('TC-LOCALE-007 — a language we already know is not rewritten by traffic', () => {
  it('holds the stored language when later requests arrive in another one', async () => {
    const email = `e2e-locale-switch-${state.runId}@test.local`;

    // Signs up reading Estonian.
    const signupRes = await api.post('/auth/signup', { method: 'email', email, locale: 'et' });
    expect(signupRes.status).toBe(201);
    const verifyRes = await api.post('/auth/otp/verify', {
      identifier: email,
      code: signupRes.data.data.code,
      purpose: 'signup',
      method: 'email',
    });
    expect(verifyRes.status).toBe(200);

    const userId = verifyRes.data.data.user.id;
    const token = verifyRes.data.data.accessToken;

    let admin = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(admin.data.data.user.preferredLocale).toBe('et');

    // A request in another language is not evidence of a choice: the website redirects any link
    // without a locale prefix to /en, so its own polling would otherwise rewrite the user to
    // English seconds after they picked Estonian.
    const other = await api.get('/users/me', {
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'lv-LV,lv;q=0.9' },
    });
    expect(other.status).toBe(200);

    admin = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(admin.data.data.user.preferredLocale).toBe('et');
  });

  it('keeps the stored language when a request names none', async () => {
    const email = `e2e-locale-keep-${state.runId}@test.local`;

    const signupRes = await api.post('/auth/signup', { method: 'email', email, locale: 'ru' });
    expect(signupRes.status).toBe(201);
    const verifyRes = await api.post('/auth/otp/verify', {
      identifier: email,
      code: signupRes.data.data.code,
      purpose: 'signup',
      method: 'email',
    });
    expect(verifyRes.status).toBe(200);

    const userId = verifyRes.data.data.user.id;

    // An unsupported language must not wipe what we already know.
    const res = await api.get('/users/me', {
      headers: {
        Authorization: `Bearer ${verifyRes.data.data.accessToken}`,
        'Accept-Language': 'de-DE,fr;q=0.8',
      },
    });
    expect(res.status).toBe(200);

    const admin = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(admin.data.data.user.preferredLocale).toBe('ru');
  });
});

describe('TC-LOCALE-008 — the language switcher records the change immediately', () => {
  // PATCH /users/me/locale is what the webapp's LanguageSwitcher calls. Without it a user who
  // switches language and then goes idle stays recorded under the old one until their next call.
  it('stores the new language without waiting for another request', async () => {
    const email = `e2e-locale-switcher-${state.runId}@test.local`;
    const signupRes = await api.post('/auth/signup', { method: 'email', email, locale: 'en' });
    expect(signupRes.status).toBe(201);

    const verifyRes = await api.post('/auth/otp/verify', {
      identifier: email,
      code: signupRes.data.data.code,
      purpose: 'signup',
      method: 'email',
    });
    expect(verifyRes.status).toBe(200);

    const userId = verifyRes.data.data.user.id;
    const token = verifyRes.data.data.accessToken;

    // The switcher fires on the click, so the call carries the old Accept-Language: the body is
    // the only thing naming the new language.
    const patched = await api.patch(
      '/users/me/locale',
      { locale: 'lt' },
      { headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'en-GB,en;q=0.9' } },
    );
    expect(patched.status).toBe(200);
    expect(patched.data.data.preferredLocale).toBe('lt');

    const admin = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(admin.data.data.user.preferredLocale).toBe('lt');

    // The explicit choice must survive: the passive sync may not overwrite it on the next request.
    const me = await api.get('/users/me', {
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'lt-LT,lt;q=0.9' },
    });
    expect(me.status).toBe(200);
    expect(me.data.data.preferredLocale ?? me.data.data.user?.preferredLocale).toBe('lt');
  });

  it('rejects a language the site does not ship in', async () => {
    const email = `e2e-locale-switcher-bad-${state.runId}@test.local`;
    const signupRes = await api.post('/auth/signup', { method: 'email', email, locale: 'et' });
    expect(signupRes.status).toBe(201);

    const verifyRes = await api.post('/auth/otp/verify', {
      identifier: email,
      code: signupRes.data.data.code,
      purpose: 'signup',
      method: 'email',
    });
    expect(verifyRes.status).toBe(200);

    const userId = verifyRes.data.data.user.id;
    const res = await authed(verifyRes.data.data.accessToken).patch('/users/me/locale', { locale: 'de' });
    expect(res.status).toBe(400);

    // The language already known must be left alone.
    const admin = await authed(adminToken).get(`/admin/users/${userId}`);
    expect(admin.data.data.user.preferredLocale).toBe('et');
  });
});

describe('TC-LOCALE-009 — an already-authorized user is followed on public routes too', () => {
  // The point of the whole feature: a signed-in reader browsing the blog in Lithuanian teaches us
  // their language, without signing in again and without touching a single protected endpoint.
  it('learns the language from a public request that carries the token', async () => {
    const email = `e2e-locale-public-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    const res = await api.get('/content/posts', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': 'lt-LT,lt;q=0.9' },
    });
    expect(res.status).toBe(200);

    let admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.preferredLocale).toBe('lt');

    // A later request in a different language must not move it — that request may well be an
    // English fallback page rather than anything the user chose.
    const fallback = await api.get('/content/posts', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': 'en-GB,en;q=0.9' },
    });
    expect(fallback.status).toBe(200);

    admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.preferredLocale).toBe('lt');
  });

  it('leaves a public route public for an anonymous or stale caller', async () => {
    const anonymous = await api.get('/content/posts', {
      headers: { 'Accept-Language': 'lv-LV' },
    });
    expect(anonymous.status).toBe(200);

    // A token we cannot read must not turn a public page into a 401.
    const stale = await api.get('/content/posts', {
      headers: { Authorization: 'Bearer not-a-real-token', 'Accept-Language': 'lv-LV' },
    });
    expect(stale.status).toBe(200);
  });
});

describe('TC-LOCALE-010 — renewing a session records the language', () => {
  it('follows the language sent with a token refresh', async () => {
    const email = `e2e-locale-refresh-${state.runId}@test.local`;
    const { user, refreshToken } = await signupAndVerifyEmail(email);

    const res = await api.post(
      '/auth/access-token',
      { refreshToken },
      { headers: { 'Accept-Language': 'ru-RU,ru;q=0.9' } },
    );
    expect(res.status).toBe(200);

    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.preferredLocale).toBe('ru');
  });

  it('learns nothing from a refresh naming a language we do not serve', async () => {
    const email = `e2e-locale-refresh-unknown-${state.runId}@test.local`;
    const { user, refreshToken } = await signupAndVerifyEmail(email);

    const res = await api.post(
      '/auth/access-token',
      { refreshToken },
      { headers: { 'Accept-Language': 'de-DE,fr;q=0.8' } },
    );
    expect(res.status).toBe(200);

    // "We learned nothing" — not "they read the site in English".
    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.preferredLocale).toBeNull();
  });
});

describe('TC-LOCALE-011 — an explicit choice outranks anything detected later', () => {
  it('keeps the chosen language when a later request arrives in another one', async () => {
    const email = `e2e-locale-newest-${state.runId}@test.local`;
    const { user, accessToken } = await signupAndVerifyEmail(email);

    const chosen = await authed(accessToken).patch('/users/me/locale', { locale: 'lv' });
    expect(chosen.status).toBe(200);

    const res = await api.get('/content/posts', {
      headers: { Authorization: `Bearer ${accessToken}`, 'Accept-Language': 'lt-LT' },
    });
    expect(res.status).toBe(200);

    // The switcher is the user speaking. Nothing detected afterwards may overrule it.
    const admin = await authed(adminToken).get(`/admin/users/${user.id}`);
    expect(admin.data.data.user.preferredLocale).toBe('lv');
  });
});

describe('TC-LOCALE-005 — the user can read back their own language', () => {
  it('returns preferredLocale on the profile and in the admin list', async () => {
    const email = `e2e-locale-me-${state.runId}@test.local`;
    const signupRes = await api.post('/auth/signup', { method: 'email', email, locale: 'eesti' });
    expect(signupRes.status).toBe(201);

    const verifyRes = await api.post('/auth/otp/verify', {
      identifier: email,
      code: signupRes.data.data.code,
      purpose: 'signup',
      method: 'email',
    });
    expect(verifyRes.status).toBe(200);

    // The alias `eesti` resolves to et, and the user sees it on their own profile.
    const me = await authed(verifyRes.data.data.accessToken).get('/users/me');
    expect(me.status).toBe(200);
    expect(me.data.data.preferredLocale ?? me.data.data.user?.preferredLocale).toBe('et');

    // Admin sees the same value in the list.
    const list = await authed(adminToken).get('/admin/users', { search: email, limit: 10 });
    expect(list.status).toBe(200);
    const row = list.data.data.users.find((u: { email: string }) => u.email === email);
    expect(row?.preferredLocale).toBe('et');
  });
});
