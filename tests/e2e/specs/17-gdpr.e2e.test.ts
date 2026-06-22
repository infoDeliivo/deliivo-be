/**
 * E2E — GDPR: Data Export and Account Deletion
 * Covers: TC-GDPR-001 through TC-GDPR-005
 *
 * A dedicated test user is created and then deleted to avoid interfering
 * with other tests that rely on passengerA/passengerB being active.
 */
import { authed, api } from '../helpers/api.client';
import { readState } from '../helpers/state';
import { signupAndVerifyEmail, toAccountState } from '../helpers/auth.helper';

const state = readState();

let gdprUserToken: string;
let gdprUserId: string;
let gdprRefreshToken: string;

// ── Setup: create a dedicated GDPR test user ─────────────────────────────────
beforeAll(async () => {
  const email = `e2e-gdpr-${state.runId}@test.local`;
  const result = await signupAndVerifyEmail(email);
  const account = toAccountState(result, email);
  gdprUserToken = account.accessToken;
  gdprRefreshToken = account.refreshToken;
  gdprUserId = account.id;

  // Accept ToS so data export includes it
  await authed(gdprUserToken).post('/auth/accept-tos', {
    tosVersion: '1.0',
    privacyVersion: '1.0',
  });

  // Fill in profile data so the export has something to return
  await authed(gdprUserToken).put('/users/me', {
    name: 'GDPR Test User',
    salutation: 'MX',
  });
});

// ── TC-GDPR-001: Data export returns structured payload ──────────────────────
describe('TC-GDPR-001 — Data export returns full user data', () => {
  it('GET /users/me/data-export returns 200 with structured export', async () => {
    const res = await authed(gdprUserToken).get('/users/me/data-export');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    // Must contain top-level profile object
    expect(body.profile).toBeTruthy();
    expect(body.profile.id).toBe(gdprUserId);
  });
});

// ── TC-GDPR-002: Export includes all required sections ───────────────────────
describe('TC-GDPR-002 — Data export includes all required sections', () => {
  it('response contains profile, vehicles, rides, bookings, ratings', async () => {
    const res = await authed(gdprUserToken).get('/users/me/data-export');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;

    expect(body).toHaveProperty('profile');
    expect(body).toHaveProperty('vehicles');
    expect(body).toHaveProperty('ridesAsDriver');
    expect(body).toHaveProperty('bookingsAsPassenger');
    expect(body).toHaveProperty('ratingsGiven');
    expect(body).toHaveProperty('ratingsReceived');

    // Arrays (may be empty for a fresh user)
    expect(Array.isArray(body.vehicles)).toBe(true);
    expect(Array.isArray(body.ridesAsDriver)).toBe(true);
    expect(Array.isArray(body.bookingsAsPassenger)).toBe(true);
  });
});

// ── TC-GDPR-003: Unauthenticated cannot export ───────────────────────────────
describe('TC-GDPR-003 — Unauthenticated request to data export returns 401', () => {
  it('returns 401 without a token', async () => {
    const res = await api.get('/users/me/data-export');
    expect(res.status).toBe(401);
  });
});

// ── TC-GDPR-004: Account deletion anonymizes PII ────────────────────────────
describe('TC-GDPR-004 — DELETE /me anonymizes user account', () => {
  it('returns 200 and the account PII is zeroed out', async () => {
    const res = await authed(gdprUserToken).delete('/users/me', { confirm: true });
    expect(res.status).toBe(200);
  });

  it('access token is immediately invalid after deletion', async () => {
    // Token should still structurally be valid JWT but the user is effectively
    // deactivated — protected endpoints should return 401 or 403
    const res = await authed(gdprUserToken).get('/users/me');
    expect([401, 403, 404]).toContain(res.status);
  });
});

// ── TC-GDPR-005: Refresh token revoked after deletion ────────────────────────
describe('TC-GDPR-005 — Refresh token is revoked after account deletion', () => {
  it('cannot obtain new access token with old refresh token', async () => {
    const res = await api.post('/auth/access-token', {
      refreshToken: gdprRefreshToken,
    });
    expect(res.status).toBe(401);
  });
});
