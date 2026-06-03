import { z } from 'zod';

const otpPurposeSchema = z
  .enum(['signup', 'login', 'reset', 'reset_password'])
  .transform((purpose) => (purpose === 'reset' ? 'reset_password' : purpose));

export const signupSchema = z
  .object({
    method: z.enum(['email', 'phone']),
    email: z.string().email().optional(),
    phone: z.string().min(10).optional(),
  })
  .refine(
    (data) => {
      if (data.method === 'email' && !data.email) return false;
      if (data.method === 'phone' && !data.phone) return false;
      return true;
    },
    {
      message: 'Email is required for email method, Phone is required for phone method',
      path: ['method'],
    },
  );

export const otpRequestSchema = z.object({
  method: z.enum(['email', 'phone']),
  identifier: z.string(),
  purpose: otpPurposeSchema,
});

export const otpVerifySchema = z.object({
  code: z.string().length(4),
  method: z.enum(['email', 'phone']),
  identifier: z.string(),
  purpose: otpPurposeSchema,
}).strict();


export const loginSchema = z.object({
  method: z.enum(['email', 'phone']),
  identifier: z.string(),
});

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const acceptTosSchema = z.object({
  tosVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
});
