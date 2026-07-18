/**
 * Uses an in-memory fake Redis so counter/TTL/NX behavior is exercised for real
 * rather than asserting on mock call counts.
 */
class FakeRedis {
  private store = new Map<string, string>();

  async incr(key: string): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1;
    this.store.set(key, String(next));
    return next;
  }

  async expire(_key: string, _seconds: number): Promise<number> {
    return 1;
  }

  async set(
    key: string,
    value: string,
    _ex?: string,
    _ttl?: number,
    nx?: string,
  ): Promise<'OK' | null> {
    if (nx === 'NX' && this.store.has(key)) {
      return null;
    }
    this.store.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
}

const mockRedis = new FakeRedis();
const mockSendMail = jest.fn().mockResolvedValue(undefined);

jest.mock('../../cache/redis.js', () => ({
  __esModule: true,
  default: mockRedis,
}));

jest.mock('../mail/mail.service.js', () => ({
  __esModule: true,
  sendMail: (...args: unknown[]) => mockSendMail(...args),
}));

import { assertSmsAllowed } from './sms.abuse.js';

describe('assertSmsAllowed', () => {
  const ENV_KEYS = [
    'SMS_ALLOWED_COUNTRY_CODES',
    'SMS_PER_PHONE_DAILY_MAX',
    'SMS_DAILY_SPEND_CAP',
    'SMS_MONTHLY_SPEND_CAP',
    'ADMIN_ALERT_EMAIL',
  ];
  const original: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const k of ENV_KEYS) original[k] = process.env[k];
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (mockRedis as unknown as { store: Map<string, string> }).store = new Map();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterAll(() => {
    for (const k of ENV_KEYS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
  });

  it('allows a number whose country code is in the allowlist', async () => {
    process.env.SMS_ALLOWED_COUNTRY_CODES = '372';
    const result = await assertSmsAllowed('+37251234567');
    expect(result.ok).toBe(true);
  });

  it('rejects a number whose country code is not in the allowlist', async () => {
    process.env.SMS_ALLOWED_COUNTRY_CODES = '372';
    const result = await assertSmsAllowed('+14155550123'); // US +1
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/country|not supported/i);
  });

  it('allows all countries when the allowlist is empty', async () => {
    const result = await assertSmsAllowed('+14155550123');
    expect(result.ok).toBe(true);
  });

  it('blocks once the per-phone daily cap is exceeded', async () => {
    process.env.SMS_ALLOWED_COUNTRY_CODES = '372';
    process.env.SMS_PER_PHONE_DAILY_MAX = '3';
    const phone = '+37251234567';

    for (let i = 0; i < 3; i++) {
      expect((await assertSmsAllowed(phone)).ok).toBe(true);
    }
    const blocked = await assertSmsAllowed(phone);
    expect(blocked.ok).toBe(false);
  });

  it('per-phone cap is independent per number', async () => {
    process.env.SMS_ALLOWED_COUNTRY_CODES = '372';
    process.env.SMS_PER_PHONE_DAILY_MAX = '1';

    expect((await assertSmsAllowed('+37251234567')).ok).toBe(true);
    expect((await assertSmsAllowed('+37251234567')).ok).toBe(false);
    // different number still allowed
    expect((await assertSmsAllowed('+37259999999')).ok).toBe(true);
  });

  it('blocks and alerts once when the daily spend cap is breached', async () => {
    process.env.SMS_ALLOWED_COUNTRY_CODES = '372';
    process.env.SMS_PER_PHONE_DAILY_MAX = '100';
    process.env.SMS_DAILY_SPEND_CAP = '2';
    process.env.ADMIN_ALERT_EMAIL = 'ops@deliivo.test';

    // 2 allowed (different phones so per-phone cap is not the limiter)
    expect((await assertSmsAllowed('+37251000001')).ok).toBe(true);
    expect((await assertSmsAllowed('+37251000002')).ok).toBe(true);
    // 3rd exceeds daily cap
    expect((await assertSmsAllowed('+37251000003')).ok).toBe(false);
    // 4th also blocked but no second alert
    expect((await assertSmsAllowed('+37251000004')).ok).toBe(false);

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@deliivo.test' }),
    );
  });

  it('does not enforce spend cap when unset', async () => {
    process.env.SMS_ALLOWED_COUNTRY_CODES = '372';
    process.env.SMS_PER_PHONE_DAILY_MAX = '100';
    for (let i = 0; i < 10; i++) {
      expect((await assertSmsAllowed(`+3725100000${i}`)).ok).toBe(true);
    }
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
