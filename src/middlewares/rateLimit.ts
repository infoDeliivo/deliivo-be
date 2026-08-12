import rateLimit, { Store, Options, IncrementResponse, ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';
import redis from '../cache/redis.js';

const parseIntEnv = (name: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
};

/** OTP request identifier: phone/email/identifier from the parsed body, if present. */
const getOtpIdentifier = (req: Request): string | undefined => {
  const body = req.body as { identifier?: string; phone?: string; email?: string } | undefined;
  const value = body?.identifier || body?.phone || body?.email;
  return typeof value === 'string' && value.trim() !== '' ? value.trim().toLowerCase() : undefined;
};

class RedisStore implements Store {
  prefix: string;
  windowMs: number;

  constructor(prefix: string) {
    this.prefix = prefix;
    this.windowMs = 0;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  async increment(key: string): Promise<IncrementResponse> {
    try {
      const redisKey = `${this.prefix}:${key}`;
      const totalHits = await redis.incr(redisKey);
      if (totalHits === 1) {
        await redis.pexpire(redisKey, this.windowMs);
      }
      const ttl = await redis.pttl(redisKey);
      return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
    } catch {
      // Fail open: if Redis is unavailable, allow the request
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key: string): Promise<void> {
    try {
      await redis.decr(`${this.prefix}:${key}`);
    } catch {}
  }

  async resetKey(key: string): Promise<void> {
    try {
      await redis.del(`${this.prefix}:${key}`);
    } catch {}
  }
}

const isRateLimitDisabled = process.env.DISABLE_RATE_LIMIT === 'true';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isRateLimitDisabled ? 0 : 100,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore('rl:api'),
});

/**
 * Layered OTP protection. A request must pass ALL of: per-identifier, per-IP and
 * per-subnet limits. Unlike the old fallback-OR keying, rotating the phone number
 * no longer earns a fresh bucket — the IP/subnet counters still trip. Apply by
 * spreading the array onto a route: `app.use(path, ...otpLimiters)`.
 */
const otpWindowMs = parseIntEnv('OTP_RL_WINDOW_MS', 15 * 60 * 1000, 1000, 24 * 60 * 60 * 1000);
const otpIdentifierMax = parseIntEnv('OTP_RL_IDENTIFIER_MAX', 5, 1, 10000);
const otpIpMax = parseIntEnv('OTP_RL_IP_MAX', 15, 1, 10000);
const otpSubnetMax = parseIntEnv('OTP_RL_SUBNET_MAX', 40, 1, 10000);

const identifierLimiter = rateLimit({
  windowMs: otpWindowMs,
  max: isRateLimitDisabled ? 0 : otpIdentifierMax,
  // Skip when there is no identifier (e.g. body-less request) so callers are not
  // all collapsed onto a single empty-string bucket — IP/subnet limiters still apply.
  skip: (req) => isRateLimitDisabled || getOtpIdentifier(req) === undefined,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => getOtpIdentifier(req) ?? 'anonymous',
  store: new RedisStore('rl:otp:id'),
});

const ipLimiter = rateLimit({
  windowMs: otpWindowMs,
  max: isRateLimitDisabled ? 0 : otpIpMax,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1'),
  store: new RedisStore('rl:otp:ip'),
});

const subnetLimiter = rateLimit({
  windowMs: otpWindowMs,
  max: isRateLimitDisabled ? 0 : otpSubnetMax,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  // ipKeyGenerator masks IPv6 to a /56 subnet (IPv4 returned as-is), catching an
  // attacker who rotates addresses within a range.
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? '127.0.0.1', 56),
  store: new RedisStore('rl:otp:net'),
});

export const otpLimiters: RequestHandler[] = [ipLimiter, subnetLimiter, identifierLimiter];

// Tighter limiter for CPU-heavy search endpoints: 20 per minute
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isRateLimitDisabled ? 0 : 20,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore('rl:search'),
});

// Tighter limiter for booking creation: 10 per minute
export const bookingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isRateLimitDisabled ? 0 : 10,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  store: new RedisStore('rl:booking'),
});
