import rateLimit from 'express-rate-limit';

const isRateLimitDisabled = process.env.DISABLE_RATE_LIMIT === 'true';

export const rateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isRateLimitDisabled ? 0 : 100, // 0 = unlimited
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tight limiter for OTP endpoints: 5 attempts per 15 minutes per IP/identifier
export const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isRateLimitDisabled ? 0 : 5,
  skip: () => isRateLimitDisabled,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.body?.identifier || req.body?.phone || req.body?.email || req.ip) as string,
});
