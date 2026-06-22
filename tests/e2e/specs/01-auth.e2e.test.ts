/**
 * E2E — Authentication
 * Covers: TC-AUTH-001 through TC-AUTH-016
 */
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const RUN = state.runId;

// Fresh email used only for auth tests (not pre-created in globalSetup)
const AUTH_TEST_EMAIL = `e2e-auth-${RUN}@test.local`;

let capturedOtp: string;
let capturedRefreshToken: string;
let capturedAccessToken: string;

describe('TC-AUTH-001 — Signup with email', () => {
  it('returns 201 with next=verify_otp and an OTP code', async () => {
    const res = await api.post('/auth/signup', { method: 'email', email: AUTH_TEST_EMAIL });
    expect(res.status).toBe(201);
    expect(res.data.data.next).toBe('verify_otp');
    expect(typeof res.data.data.code).toBe('string');
    capturedOtp = res.data.data.code;
  });
});

describe('TC-AUTH-003 — Signup with already verified email', () => {
  it('returns 409 conflict for the pre-created driver_a email', async () => {
    const res = await api.post('/auth/signup', {
      method: 'email',
      email: state.driverA.email,
    });
    expect(res.status).toBe(409);
  });
});

describe('TC-AUTH-006 — Verify OTP with wrong code', () => {
  it('returns 400 for an incorrect OTP', async () => {
    // OTP is 4 digits — submit a wrong 4-digit code
    const res = await api.post('/auth/otp/verify', {
      identifier: AUTH_TEST_EMAIL,
      code: '0000',
      purpose: 'signup',
      method: 'email',
    });
    expect(res.status).toBe(400);
  });
});

describe('TC-AUTH-005 — Verify OTP happy path', () => {
  it('returns 200 with tokens and next=onboarding for new user', async () => {
    expect(capturedOtp).toBeDefined();
    const res = await api.post('/auth/otp/verify', {
      identifier: AUTH_TEST_EMAIL,
      code: capturedOtp,
      purpose: 'signup',
      method: 'email',
    });
    expect(res.status).toBe(200);
    expect(res.data.data.accessToken).toBeTruthy();
    expect(res.data.data.refreshToken).toBeTruthy();
    expect(res.data.data.next).toBe('onboarding');
    capturedAccessToken = res.data.data.accessToken;
    capturedRefreshToken = res.data.data.refreshToken;
  });
});

describe('TC-AUTH-009 — Resend OTP during cooldown', () => {
  it('returns 429 if called twice within cooldown window', async () => {
    // Use a dedicated email so the cooldown does not interfere with TC-AUTH-010 login
    const resendEmail = `e2e-auth-resend-${RUN}@test.local`;
    await api.post('/auth/signup', { method: 'email', email: resendEmail });

    // First resend (should succeed — reuses the OTP from signup)
    await api.post('/auth/otp/resend', {
      identifier: resendEmail,
      purpose: 'signup',
      method: 'email',
    });
    // Second resend immediately — should hit cooldown
    const res = await api.post('/auth/otp/resend', {
      identifier: resendEmail,
      purpose: 'signup',
      method: 'email',
    });
    expect(res.status).toBe(429);
    expect(res.data.message).toMatch(/wait/i);
  });
});

describe('TC-AUTH-010 — Login happy path', () => {
  it('sends login OTP and verifies it, returning tokens with next=home', async () => {
    // Request login OTP
    const loginRes = await api.post('/auth/login', {
      method: 'email',
      identifier: AUTH_TEST_EMAIL,
    });
    expect(loginRes.status).toBe(200);
    const loginOtp: string = loginRes.data.data.code;
    expect(loginOtp).toBeTruthy();

    // Verify login OTP
    const verifyRes = await api.post('/auth/otp/verify', {
      identifier: AUTH_TEST_EMAIL,
      code: loginOtp,
      purpose: 'login',
      method: 'email',
    });
    expect(verifyRes.status).toBe(200);
    // New user has not completed onboarding so next may be 'onboarding'
    expect(['home', 'onboarding']).toContain(verifyRes.data.data.next);
    capturedRefreshToken = verifyRes.data.data.refreshToken;
    capturedAccessToken = verifyRes.data.data.accessToken;
  });
});

describe('TC-AUTH-011 — Login with non-existent user', () => {
  it('returns 404', async () => {
    const res = await api.post('/auth/login', {
      method: 'email',
      identifier: 'nobody-at-all@test.local',
    });
    expect(res.status).toBe(404);
  });
});

describe('TC-AUTH-012/013 — Refresh token rotation', () => {
  it('issues new tokens on refresh', async () => {
    const res = await api.post('/auth/access-token', { refreshToken: capturedRefreshToken });
    expect(res.status).toBe(200);
    expect(res.data.data.accessToken).toBeTruthy();
    expect(res.data.data.refreshToken).toBeTruthy();
    // Store the new refresh token
    const newRefreshToken: string = res.data.data.refreshToken;

    // TC-AUTH-013: old token is now revoked
    const reuseRes = await api.post('/auth/access-token', { refreshToken: capturedRefreshToken });
    expect(reuseRes.status).toBe(401);

    capturedRefreshToken = newRefreshToken;
    capturedAccessToken = res.data.data.accessToken;
  });
});

describe('TC-AUTH-014 — Logout', () => {
  it('revokes the refresh token and returns 200', async () => {
    const res = await api.post('/auth/logout', { refreshToken: capturedRefreshToken });
    expect(res.status).toBe(200);
    expect(res.data.message).toMatch(/logged out/i);

    // Confirm token is now invalid
    const retryRes = await api.post('/auth/access-token', { refreshToken: capturedRefreshToken });
    expect(retryRes.status).toBe(401);
  });
});

describe('TC-AUTH-015 — Access protected route without token', () => {
  it('returns 401', async () => {
    const res = await api.get('/users/me');
    expect(res.status).toBe(401);
  });
});

describe('TC-AUTH-016 — Access protected route with tampered token', () => {
  it('returns 401 for a token with a modified payload', async () => {
    const parts = capturedAccessToken?.split('.') ?? ['a', 'b', 'c'];
    const tamperedToken = [parts[0], 'tampered-payload', parts[2]].join('.');
    const res = await authed(tamperedToken).get('/users/me');
    expect(res.status).toBe(401);
  });
});
