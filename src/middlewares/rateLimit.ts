import rateLimit, { Store, Options, IncrementResponse } from 'express-rate-limit';
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
    const redisKey = `${this.prefix}:${key}`;
    const totalHits = await redis.incr(redisKey);
    if (totalHits === 1) {
      await redis.pexpire(redisKey, this.windowMs);
    }
    const ttl = await redis.pttl(redisKey);
    return { totalHits, resetTime: new Date(Date.now() + (ttl > 0 ? ttl : this.windowMs)) };
  }

  async decrement(key: string): Promise<void> {
    await redis.decr(`${this.prefix}:${key}`);
  }

  async resetKey(key: string): Promise<void> {
    await redis.del(`${this.prefix}:${key}`);
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
  keyGenerator: (req) => (req.body?.identifier || req.body?.phone || req.body?.email || req.ip) as string,
  store: new RedisStore('rl:otp'),
});
