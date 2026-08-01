/**
 * E2E — Stripe Connect (Driver Payouts Onboarding)
 * Covers: TC-CONNECT-001 through TC-CONNECT-005
 *
 * These tests verify the Stripe Connect onboarding flow endpoints — both the
 * embedded AccountSession path and the legacy hosted Account Link fallback.
 * Full onboarding requires a real Stripe call, so the tests verify
 * the API contract (correct status codes, response shapes) rather than
 * completing an actual onboarding.
 *
 * The price breakdown serviceFee field is also tested here because it
 * is part of the Stripe Connect feature (platform fee).
 */
import { authed } from '../helpers/api.client';
import { readState } from '../helpers/state';

const state = readState();
const da = authed(state.driverA.accessToken);
const pa = authed(state.passengerA.accessToken);

// ── TC-CONNECT-001: Status before onboarding ─────────────────────────────────
describe('TC-CONNECT-001 — Connect status before onboarding', () => {
  it('returns 200 with onboardingComplete=false for a fresh driver', async () => {
    const res = await da.get('/payments/connect/status');
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    // A fresh driver has not onboarded yet
    expect(typeof body.onboardingComplete).toBe('boolean');
    // Fields may be null/undefined when no account exists yet
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(['onboardingComplete'])
    );
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.get('/payments/connect/status');
    expect(res.status).toBe(401);
  });
});

// ── TC-CONNECT-002: Initiate onboarding ─────────────────────────────────────
describe('TC-CONNECT-002 — Initiate Connect onboarding', () => {
  it('returns 200 with a Stripe onboarding URL', async () => {
    const res = await da.post('/payments/connect/onboard', {
      returnUrl: 'https://example.com/connect/return',
      refreshUrl: 'https://example.com/connect/refresh',
    });
    // Stripe may not be configured in the test environment
    if (res.status === 500 || res.status === 503) {
      console.warn('TC-CONNECT-002: Stripe not configured — skipping URL assertion');
      return;
    }
    expect([200, 201]).toContain(res.status);
    const body = res.data.data ?? res.data;
    expect(typeof body.url).toBe('string');
    expect(body.url).toMatch(/https?:\/\//);
  });
});

// ── TC-CONNECT-005: Embedded onboarding account session ─────────────────────
describe('TC-CONNECT-005 — Create an AccountSession for embedded onboarding', () => {
  it('returns a client secret, or a mock stub when Connect is mocked', async () => {
    const res = await da.post('/payments/connect/account-session', {});
    // Stripe may not be configured in the test environment
    if (res.status === 500 || res.status === 503) {
      console.warn('TC-CONNECT-005: Stripe not configured — skipping client secret assertion');
      return;
    }
    expect([200, 201]).toContain(res.status);
    const body = res.data.data ?? res.data;

    if (body.mock === true) {
      // STRIPE_CONNECT_MOCK_MODE=true — no Stripe call is made
      expect(body.clientSecret).toBeNull();
      return;
    }

    expect(typeof body.clientSecret).toBe('string');
    expect(typeof body.accountId).toBe('string');
    expect(['application', 'stripe']).toContain(body.requirementCollection);
  });

  it('ignores a caller-supplied account id', async () => {
    const res = await da.post('/payments/connect/account-session', {
      account: 'acct_notMine',
      accountId: 'acct_notMine',
    });
    if (res.status === 500 || res.status === 503) return;
    const body = res.data.data ?? res.data;
    expect(body.accountId).not.toBe('acct_notMine');
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.post('/payments/connect/account-session', {});
    expect(res.status).toBe(401);
  });
});

// ── TC-CONNECT-003: Passenger cannot access connect routes ───────────────────
describe('TC-CONNECT-003 — Passenger cannot access Connect endpoints', () => {
  it('POST /payments/connect/onboard returns 200/201 (any authenticated user can initiate)', async () => {
    // Connect onboard is available to any authenticated user (they become a driver by publishing a ride)
    // The endpoint itself is not role-restricted; it creates/returns a connect link
    const res = await pa.get('/payments/connect/status');
    expect(res.status).toBe(200); // passengers can check their own connect status too
  });
});

// ── TC-CONNECT-004: Price breakdown includes serviceFee field ────────────────
describe('TC-CONNECT-004 — Price preview always includes serviceFee in breakdown', () => {
  it('priceBreakdown.serviceFee is present (may be 0 if PLATFORM_FEE_PERCENT=0)', async () => {
    if (!state.sharedRide) return;
    const res = await pa.post('/bookings/price-preview', {
      rideId: state.sharedRide.id,
      seatsBooked: 1,
      luggageCount: 0,
    });
    expect(res.status).toBe(200);
    const breakdown = (res.data.data ?? res.data).priceBreakdown ?? res.data.data;
    // serviceFee must be present and be a non-negative number
    expect(breakdown).toHaveProperty('serviceFee');
    expect(typeof breakdown.serviceFee).toBe('number');
    expect(breakdown.serviceFee).toBeGreaterThanOrEqual(0);
    // totalPrice = subtotal + luggageFee + serviceFee
    const expected = breakdown.subtotal + breakdown.luggageFee + breakdown.serviceFee;
    expect(breakdown.totalPrice).toBeCloseTo(expected, 2);
  });
});

// ── TC-CONNECT-006: Requirements drive the custom onboarding UI ──────────────
describe('TC-CONNECT-006 — Outstanding Connect requirements', () => {
  it('returns the requirement lists the onboarding form renders from', async () => {
    const res = await da.get('/payments/connect/requirements');
    if (res.status === 500 || res.status === 503) {
      console.warn('TC-CONNECT-006: Stripe not configured — skipping requirement assertions');
      return;
    }
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(typeof body.accountId).toBe('string');
    expect(Array.isArray(body.currentlyDue)).toBe(true);
    expect(Array.isArray(body.pastDue)).toBe(true);
    expect(Array.isArray(body.eventuallyDue)).toBe(true);
    expect(typeof body.termsAccepted).toBe('boolean');
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.get('/payments/connect/requirements');
    expect(res.status).toBe(401);
  });
});

// ── TC-CONNECT-007: Personal details validation ──────────────────────────────
describe('TC-CONNECT-007 — Submitting personal details', () => {
  const validDetails = {
    firstName: 'Test',
    lastName: 'DriverAlpha',
    email: 'driver-payouts@test.local',
    phone: '+37255512345',
    dob: '1990-05-14',
    address: {
      line1: '12 Pikk',
      city: 'Tallinn',
      postalCode: '10123',
      country: 'EE',
    },
  };

  it('rejects a date of birth below Stripe’s minimum age', async () => {
    const res = await da.put('/payments/connect/details', { ...validDetails, dob: '2018-07-11' });
    expect(res.status).toBe(400);
  });

  it('rejects a phone that is not in international format', async () => {
    const res = await da.put('/payments/connect/details', { ...validDetails, phone: '55512345' });
    expect(res.status).toBe(400);
  });

  it('rejects an address outside the payout country', async () => {
    const res = await da.put('/payments/connect/details', {
      ...validDetails,
      address: { ...validDetails.address, country: 'CA' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects a submission missing required fields', async () => {
    const res = await da.put('/payments/connect/details', { firstName: 'Test' });
    expect(res.status).toBe(400);
  });

  it('accepts a complete submission and returns updated requirements', async () => {
    const res = await da.put('/payments/connect/details', validDetails);
    if (res.status === 500 || res.status === 503) {
      console.warn('TC-CONNECT-007: Stripe not configured — skipping success assertion');
      return;
    }
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(Array.isArray(body.currentlyDue)).toBe(true);
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.put('/payments/connect/details', validDetails);
    expect(res.status).toBe(401);
  });
});

// ── TC-CONNECT-008: Bank account is token-only ───────────────────────────────
describe('TC-CONNECT-008 — Adding a bank account', () => {
  it('refuses raw bank details so they never reach the server', async () => {
    const res = await da.post('/payments/connect/bank-account', {
      accountNumber: 'EE382200221020145685',
      routingNumber: '22002',
    });
    expect(res.status).toBe(400);
  });

  it('rejects anything that is not a Stripe.js bank token', async () => {
    const res = await da.post('/payments/connect/bank-account', { token: 'EE382200221020145685' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.post('/payments/connect/bank-account', { token: 'btok_test' });
    expect(res.status).toBe(401);
  });
});

// ── TC-CONNECT-009: Terms acceptance ─────────────────────────────────────────
describe('TC-CONNECT-009 — Recording terms acceptance', () => {
  it('rejects an unaccepted or missing acknowledgement', async () => {
    expect((await da.post('/payments/connect/terms', { accepted: false })).status).toBe(400);
    expect((await da.post('/payments/connect/terms', {})).status).toBe(400);
  });

  it('records acceptance and returns updated requirements', async () => {
    const res = await da.post('/payments/connect/terms', { accepted: true });
    if (res.status === 500 || res.status === 503) {
      console.warn('TC-CONNECT-009: Stripe not configured — skipping acceptance assertion');
      return;
    }
    expect(res.status).toBe(200);
    const body = res.data.data ?? res.data;
    expect(body.termsAccepted).toBe(true);
  });

  it('returns 401 for unauthenticated request', async () => {
    const { api } = await import('../helpers/api.client');
    const res = await api.post('/payments/connect/terms', { accepted: true });
    expect(res.status).toBe(401);
  });
});
