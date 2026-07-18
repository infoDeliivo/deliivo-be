/**
 * E2E — OTP Abuse Protection (provider abuse & rate-limit strategy)
 *
 * Exercises the layered OTP rate limiter and the SMS country allowlist through
 * the live API.
 *
 * These behaviours only activate when the server is started with rate limiting
 * enabled (i.e. WITHOUT DISABLE_RATE_LIMIT=true) and, for the country test, with
 * SMS_ALLOWED_COUNTRY_CODES restricting destinations. The standard e2e harness
 * sets DISABLE_RATE_LIMIT=true, so each test PROBES for its precondition and
 * skips cleanly when the guard is not in force — it never false-fails the normal
 * suite. To run the real assertions, start a server like:
 *
 *   EXPOSE_OTP_IN_RESPONSE=true SMS_MOCK_MODE=true BOOKING_PAYMENT_MODE=bypass \
 *   SMS_ALLOWED_COUNTRY_CODES=372 OTP_RL_IDENTIFIER_MAX=3 npm run dev:server
 */
import { api } from '../helpers/api.client';
import { readState } from '../helpers/state';

const runId = readState().runId;

const requestEmailOtp = (identifier: string) =>
  api.post('/auth/otp/request', { method: 'email', identifier, purpose: 'signup' });

const requestPhoneOtp = (identifier: string) =>
  api.post('/auth/otp/request', { method: 'phone', identifier, purpose: 'signup' });

describe('OTP abuse protection', () => {
  it('rate-limits repeated OTP requests for the same identifier (429)', async () => {
    const identifier = `e2e-otp-abuse-${runId}-${Date.now()}@test.local`;
    const statuses: number[] = [];

    // Fire enough requests to trip any reasonable per-identifier limit.
    for (let i = 0; i < 12; i++) {
      const res = await requestEmailOtp(identifier);
      statuses.push(res.status);
      if (res.status === 429) break;
    }

    const tripped = statuses.includes(429);
    if (!tripped) {
      console.warn(
        '[33-otp-abuse] No 429 seen — server appears to have rate limiting disabled ' +
          '(DISABLE_RATE_LIMIT=true). Skipping rate-limit assertion.',
      );
      return;
    }

    // First request must have been accepted; the 429 must be the last entry.
    expect(statuses[0]).toBe(200);
    expect(statuses[statuses.length - 1]).toBe(429);
    // At least one accepted request preceded the block.
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
  });

  it('blocks OTP SMS to a country outside the allowlist', async () => {
    // +1 (US/NANP) — not in a Deliivo allowlist of e.g. 372 (Estonia).
    const res = await requestPhoneOtp('+14155550123');

    if (res.status === 200) {
      console.warn(
        '[33-otp-abuse] Phone OTP to +1 was accepted — server allowlist is open ' +
          '(SMS_ALLOWED_COUNTRY_CODES unset). Skipping country-block assertion.',
      );
      return;
    }

    // Blocked: the SMS abuse gate rejects with a country message.
    expect(res.status).toBeGreaterThanOrEqual(400);
    const message = String(res.data?.message ?? '');
    expect(message).toMatch(/country|not supported/i);
  });
});
