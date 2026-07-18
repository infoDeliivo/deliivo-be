import express from 'express';
import request from 'supertest';

class FakeRedis {
  map = new Map<string, number>();
  async incr(k: string): Promise<number> {
    const n = (this.map.get(k) ?? 0) + 1;
    this.map.set(k, n);
    return n;
  }
  async pexpire(): Promise<number> {
    return 1;
  }
  async pttl(): Promise<number> {
    return 900000;
  }
  async decr(k: string): Promise<number> {
    const n = (this.map.get(k) ?? 0) - 1;
    this.map.set(k, n);
    return n;
  }
  async del(k: string): Promise<number> {
    this.map.delete(k);
    return 1;
  }
}

const fakeRedis = new FakeRedis();
jest.mock('../cache/redis.js', () => ({ __esModule: true, default: fakeRedis }));

type Limiters = express.RequestHandler[];

const loadOtpLimiters = (env: Record<string, string>): Limiters => {
  let limiters: Limiters = [];
  jest.isolateModules(() => {
    for (const [k, v] of Object.entries(env)) process.env[k] = v;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    limiters = require('./rateLimit.js').otpLimiters as Limiters;
  });
  return limiters;
};

const buildApp = (limiters: Limiters): express.Express => {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.post('/otp', ...limiters, (_req, res) => {
    res.json({ ok: true });
  });
  return app;
};

const ENV_KEYS = [
  'OTP_RL_IDENTIFIER_MAX',
  'OTP_RL_IP_MAX',
  'OTP_RL_SUBNET_MAX',
  'OTP_RL_WINDOW_MS',
  'DISABLE_RATE_LIMIT',
];
const original: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) original[k] = process.env[k];
});
beforeEach(() => {
  fakeRedis.map = new Map();
  for (const k of ENV_KEYS) delete process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (original[k] === undefined) delete process.env[k];
    else process.env[k] = original[k];
  }
});

describe('otpLimiters (layered)', () => {
  it('blocks after the per-identifier limit for a repeated identifier', async () => {
    const app = buildApp(
      loadOtpLimiters({ OTP_RL_IDENTIFIER_MAX: '3', OTP_RL_IP_MAX: '100', OTP_RL_SUBNET_MAX: '100' }),
    );

    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post('/otp').send({ identifier: 'user@test.local' });
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).post('/otp').send({ identifier: 'user@test.local' });
    expect(blocked.status).toBe(429);
  });

  it('still blocks a rotating phone number via the IP bucket', async () => {
    const app = buildApp(
      loadOtpLimiters({ OTP_RL_IDENTIFIER_MAX: '100', OTP_RL_IP_MAX: '5', OTP_RL_SUBNET_MAX: '100' }),
    );

    // every request uses a fresh phone -> per-identifier bucket never trips
    for (let i = 0; i < 5; i++) {
      const ok = await request(app).post('/otp').send({ phone: `+3725100000${i}` });
      expect(ok.status).toBe(200);
    }
    const blocked = await request(app).post('/otp').send({ phone: '+37251999999' });
    expect(blocked.status).toBe(429);
  });

  it('does not count when the identifier is absent (IP/subnet still apply)', async () => {
    const app = buildApp(
      loadOtpLimiters({ OTP_RL_IDENTIFIER_MAX: '1', OTP_RL_IP_MAX: '100', OTP_RL_SUBNET_MAX: '100' }),
    );
    // no identifier in body; identifier limiter (max 1) must be skipped, so 3 pass
    for (let i = 0; i < 3; i++) {
      const res = await request(app).post('/otp').send({});
      expect(res.status).toBe(200);
    }
  });

  it('allows everything when DISABLE_RATE_LIMIT=true', async () => {
    const app = buildApp(
      loadOtpLimiters({ OTP_RL_IDENTIFIER_MAX: '1', OTP_RL_IP_MAX: '1', DISABLE_RATE_LIMIT: 'true' }),
    );
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/otp').send({ identifier: 'user@test.local' });
      expect(res.status).toBe(200);
    }
  });
});
