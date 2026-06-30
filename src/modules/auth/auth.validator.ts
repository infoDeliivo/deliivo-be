import { z } from 'zod';
import { isValidE164PhoneNumber } from '../sms/sms.config.js';

const otpPurposeSchema = z
  .enum(['signup', 'login', 'reset', 'reset_password'])
  .transform((purpose) => (purpose === 'reset' ? 'reset_password' : purpose));

export const signupSchema = z
  .object({
    method: z.enum(['email', 'phone']),
    email: z.string().email().optional(),
    phone: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.method === 'email' && !data.email) return false;
      if (data.method === 'phone' && (!data.phone || !isValidE164PhoneNumber(data.phone))) return false;
      return true;
    },
    {
      message: 'Email is required for email method, phone must be a valid E.164 number for phone method',
      path: ['method'],
    },
  );

export const otpRequestSchema = z
  .object({
    method: z.enum(['email', 'phone']),
    identifier: z.string(),
    purpose: otpPurposeSchema,
  })
  .refine(
    (data) => (data.method === 'phone' ? isValidE164PhoneNumber(data.identifier) : true),
    {
      message: 'Phone identifier must be a valid E.164 number',
      path: ['identifier'],
    },
  );

export const otpVerifySchema = z
  .object({
    code: z.string().length(4),
    method: z.enum(['email', 'phone']),
    identifier: z.string(),
    purpose: otpPurposeSchema,
  })
  .strict()
  .refine(
    (data) => (data.method === 'phone' ? isValidE164PhoneNumber(data.identifier) : true),
    {
      message: 'Phone identifier must be a valid E.164 number',
      path: ['identifier'],
    },
  );


export const loginSchema = z
  .object({
    method: z.enum(['email', 'phone']),
    identifier: z.string(),
  })
  .refine(
    (data) => (data.method === 'phone' ? isValidE164PhoneNumber(data.identifier) : true),
    {
      message: 'Phone identifier must be a valid E.164 number',
      path: ['identifier'],
    },
  );

export const refreshTokenSchema = z.object({
  refreshToken: z.string(),
});

export const acceptTosSchema = z.object({
  tosVersion: z.string().min(1),
  privacyVersion: z.string().min(1),
});
