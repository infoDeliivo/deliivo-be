/**
 * E2E — DL Verification
 * Covers: TC-DL-001 through TC-DL-005
 *
 * Tests the identity verification endpoints.
 * Note: Full Veriff flow cannot be tested without a real Veriff API key,
 * but we can test the endpoint contract and webhook validation.
 */
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const pa = authed(state.passengerA.accessToken);

describe('TC-DL-001 — Create verification session', () => {
  it('returns 200/201 or appropriate error if Veriff not configured', async () => {
    const res = await pa.post('/dl-verification', {
      firstName: 'Test',
      lastName: 'Passenger',
    });
    // 200/201 if Veriff is configured, 500/503 if not configured
    expect([200, 201, 400, 500, 503]).toContain(res.status);
    if (res.status === 200 || res.status === 201) {
      const data = res.data.data ?? res.data;
      expect(data.sessionUrl || data.veriffSessionUrl).toBeTruthy();
    }
  });
});

describe('TC-DL-002 — Get verification status', () => {
  it('returns current DL verification status', async () => {
    const res = await pa.get('/dl-verification/status');
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const data = res.data.data ?? res.data;
      expect(['PENDING', 'APPROVED', 'DECLINED', 'RESUBMISSION_REQUESTED', 'EXPIRED', 'NOT_STARTED', null])
        .toContain(data.status ?? null);
    }
  });
});

describe('TC-DL-003 — Unauthenticated cannot create session', () => {
  it('returns 401', async () => {
    const res = await api.post('/dl-verification', {
      firstName: 'Anon',
      lastName: 'User',
    });
    expect(res.status).toBe(401);
  });
});

describe('TC-DL-004 — Webhook rejects invalid HMAC', () => {
  it('returns 400 or 401 for invalid signature', async () => {
    const res = await api.post('/dl-verification/webhook', {
      id: 'fake-session-id',
      status: 'approved',
      verification: { status: 'approved' },
    });
    // Should reject without valid HMAC header
    expect([400, 401, 403]).toContain(res.status);
  });
});

describe('TC-DL-005 — Webhook endpoint exists', () => {
  it('does not return 404', async () => {
    const res = await api.post('/dl-verification/webhook', {});
    expect(res.status).not.toBe(404);
  });
});
