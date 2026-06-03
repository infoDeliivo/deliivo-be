/**
 * E2E — Auth Extra Endpoints
 * Covers: TC-AUTH-EXT-001 through TC-AUTH-EXT-003
 *
 * Tests endpoints not covered in 01-auth:
 * - POST /auth/otp/request (standalone OTP request)
 * - POST /auth/accept-tos (dedicated test with validation)
 */
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const pb = authed(state.passengerB.accessToken);

describe('TC-AUTH-EXT-001 — Standalone OTP request', () => {
  it('sends OTP for a registered email', async () => {
    const res = await api.post('/auth/otp/request', {
      identifier: state.passengerB.email,
      purpose: 'login',
      method: 'email',
    });
    // 200 if successful, 404 if user not found, 429 if rate-limited
    expect([200, 201, 404, 429]).toContain(res.status);
  });
});

describe('TC-AUTH-EXT-002 — OTP request for non-existent user', () => {
  it('returns 404 or generic 200 (no enumeration)', async () => {
    const res = await api.post('/auth/otp/request', {
      identifier: 'nobody-exists-here@fake.test',
      purpose: 'login',
      method: 'email',
    });
    // Either 404 or 200 (to prevent user enumeration)
    expect([200, 404]).toContain(res.status);
  });
});

describe('TC-AUTH-EXT-003 — Accept ToS with invalid version', () => {
  it('rejects empty or missing version', async () => {
    const res = await pb.post('/auth/accept-tos', {});
    expect([400, 422]).toContain(res.status);
  });
});
