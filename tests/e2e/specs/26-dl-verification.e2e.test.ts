/**
 * E2E — DL Verification
 * Covers: TC-DL-001 through TC-DL-010
 *
 * Tests the identity verification endpoints.
 * Note: Full Veriff flow cannot be tested without a real Veriff API key,
 * but we can test the endpoint contract and webhook validation.
 */
import crypto from 'crypto';
import path from 'path';
import dotenv from 'dotenv';
import { api, authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const pa = authed(state.passengerA.accessToken);
const pb = authed(state.passengerB.accessToken);

// Unique per run so re-runs against the same database never collide on the
// veriffSessionId unique constraint.
const registeredSessionId = `e2e-session-${crypto.randomUUID()}`;
const registeredSessionUrl = 'https://alchemy.veriff.com/v/e2e-token';

// The profile the setup creates carries a name but no date of birth or gender, which
// is exactly the state the KYC gate must refuse before it spends a Veriff check.
describe('TC-DL-001 — Create verification session', () => {
  it('refuses a profile without a date of birth or gender', async () => {
    const res = await pa.post('/dl-verification', {
      firstName: 'Test',
      lastName: 'PassengerAlpha',
    });

    expect(res.status).toBe(400);
    expect(res.data.message).toBe('PROFILE_INCOMPLETE');
  });

  it('opens a session once the profile is complete and the name is the caller own', async () => {
    // Assert the profile update itself: a silent failure here used to surface as an
    // unexplained PROFILE_INCOMPLETE from the endpoint under test.
    const profile = await pa.put('/users/me', { dob: '1990-05-15', gender: 'MALE' });
    expect(profile.status).toBe(200);

    const res = await pa.post('/dl-verification', {
      firstName: 'Test',
      lastName: 'PassengerAlpha',
    });

    // 200/201 if Veriff is configured, 500/503 if not — but never a validation refusal.
    expect([200, 201, 409, 500, 503]).toContain(res.status);
    expect(res.data.message).not.toBe('PROFILE_INCOMPLETE');
    if (res.status === 200 || res.status === 201) {
      const data = res.data.data ?? res.data;
      expect(data.sessionUrl || data.veriffSessionUrl).toBeTruthy();
    }
  });
});

describe('TC-DL-001b — KYC identity gate on session creation', () => {
  it('rejects a body with no name — this is KYC, the caller states the identity', async () => {
    const res = await pa.post('/dl-verification', {});

    expect(res.status).toBe(400);
    expect(res.data.message).toBe('Validation failed');
  });

  it('rejects a name that is not the caller own profile name', async () => {
    const res = await pa.post('/dl-verification', { firstName: 'Bob', lastName: 'Jones' });

    expect(res.status).toBe(400);
    expect(res.data.message).toBe('NAME_DOES_NOT_MATCH_PROFILE');
  });

  // A non-HTTPS callback is dropped server-side, not rejected.
  it('accepts a non-HTTPS callback instead of rejecting the request', async () => {
    const res = await pa.post('/dl-verification', {
      firstName: 'Test',
      lastName: 'PassengerAlpha',
      callback: 'http://localhost:3000/return',
    });

    expect(res.status).not.toBe(400);
    expect([200, 201, 409, 500, 503]).toContain(res.status);
  });

  it('still rejects a callback that is not a URL', async () => {
    const res = await pa.post('/dl-verification', {
      firstName: 'Test',
      lastName: 'PassengerAlpha',
      callback: 'not-a-url',
    });

    expect(res.status).toBe(400);
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
    // Auth runs before validation, so an unauthenticated caller never sees a 400.
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

// The browser SDK creates the Veriff session itself, so the backend only learns the
// session id when the client registers it. Without that row the decision webhook has
// nothing to attach the outcome to.
describe('TC-DL-006 — Unauthenticated cannot register a session', () => {
  it('returns 401', async () => {
    const res = await api.post('/dl-verification/register', {
      sessionId: registeredSessionId,
      sessionUrl: registeredSessionUrl,
    });
    expect(res.status).toBe(401);
  });
});

describe('TC-DL-007 — Register a browser-created session', () => {
  it('returns 201 and reports the session as PENDING', async () => {
    const res = await pa.post('/dl-verification/register', {
      sessionId: registeredSessionId,
      sessionUrl: registeredSessionUrl,
    });

    expect(res.status).toBe(201);
    const data = res.data.data ?? res.data;
    expect(data.sessionId).toBe(registeredSessionId);
    expect(data.sessionUrl).toBe(registeredSessionUrl);
    expect(data.verificationId).toBeTruthy();

    const statusRes = await pa.get('/dl-verification/status');
    expect(statusRes.status).toBe(200);
    const statusData = statusRes.data.data ?? statusRes.data;
    expect(statusData.sessionId).toBe(registeredSessionId);
    expect(statusData.status).toBe('PENDING');
  });

  it('rejects a non-HTTPS session URL', async () => {
    const res = await pa.post('/dl-verification/register', {
      sessionId: `${registeredSessionId}-insecure`,
      sessionUrl: 'http://alchemy.veriff.com/v/e2e-token',
    });
    expect(res.status).toBe(400);
  });
});

describe('TC-DL-008 — Re-registering the same session is idempotent', () => {
  it('succeeds again and returns the same verification record', async () => {
    const first = await pa.post('/dl-verification/register', {
      sessionId: registeredSessionId,
      sessionUrl: registeredSessionUrl,
    });
    expect(first.status).toBe(201);
    const firstData = first.data.data ?? first.data;

    const second = await pa.post('/dl-verification/register', {
      sessionId: registeredSessionId,
      sessionUrl: registeredSessionUrl,
    });
    expect(second.status).toBe(201);
    const secondData = second.data.data ?? second.data;

    // Same row, so no duplicate was created by the retry.
    expect(secondData.verificationId).toBe(firstData.verificationId);
  });
});

describe('TC-DL-009 — Cannot claim another user session', () => {
  it('returns 409', async () => {
    const res = await pb.post('/dl-verification/register', {
      sessionId: registeredSessionId,
      sessionUrl: registeredSessionUrl,
    });
    expect(res.status).toBe(409);
  });
});

// Veriff signs the exact bytes it sends. The webhook route is mounted with
// express.raw() before express.json() so the digest is checked against those bytes;
// a JSON-parsed mount would re-serialise the body and reject every real decision.
// The signature must be produced with the same secret the running server holds, which
// lives in .env (.env.test does not define it). Signed cases skip when it is unset.
dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });
const sharedSecret = process.env.VERIFF_SHARED_SECRET;

const signedPost = (rawBody: string, secret: string) =>
  api.post('/dl-verification/webhook', rawBody, {
    headers: {
      'Content-Type': 'application/json',
      'x-hmac-signature': crypto.createHmac('sha256', secret).update(rawBody).digest('hex'),
    },
    transformRequest: [(data: string) => data],
  });

const describeSigned = sharedSecret ? describe : describe.skip;

describeSigned('TC-DL-010 — Webhook accepts a signature over the raw body', () => {
  // Pretty-printed on purpose: JSON.stringify would collapse this whitespace, so a
  // route that re-serialises before hashing fails here and passes on compact input.
  const rawBody = JSON.stringify(
    {
      verification: {
        id: registeredSessionId,
        status: 'declined',
        code: 9102,
        reasonCode: '102',
        person: { firstName: 'Test', lastName: 'PassengerAlpha' },
      },
    },
    null,
    2,
  );

  it('processes a pretty-printed signed decision', async () => {
    const res = await signedPost(rawBody, sharedSecret as string);

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ received: true, status: 'DECLINED' });
  });

  it('records the decision against the session', async () => {
    const res = await pa.get('/dl-verification/status');

    expect(res.status).toBe(200);
    expect(res.data.data.status).toBe('DECLINED');
  });

  it('rejects the same body signed with the wrong secret', async () => {
    const res = await signedPost(rawBody, 'not-the-shared-secret');

    expect(res.status).toBe(401);
  });

  it('acknowledges a signed decision for an unknown session without creating one', async () => {
    const unknownBody = JSON.stringify({
      verification: { id: `e2e-unknown-${crypto.randomUUID()}`, status: 'declined' },
    });
    const res = await signedPost(unknownBody, sharedSecret as string);

    expect(res.status).toBe(200);
    expect(res.data).toMatchObject({ received: true, warning: 'SESSION_NOT_FOUND' });
  });
});
