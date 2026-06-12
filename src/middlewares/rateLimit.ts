import rateLimit, { Store, Options, IncrementResponse, ipKeyGenerator } from 'express-rate-limit';
import redis from '../cache/redis.js';

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

// Tight limiter for OTP endpoints: 5 attempts per 15 minutes per IP/identifier
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isRateLimitDisabled ? 0 : 5,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body?.identifier || req.body?.phone || req.body?.email || ipKeyGenerator(req.ip ?? '127.0.0.1')),
  store: new RedisStore('rl:otp'),
});

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
