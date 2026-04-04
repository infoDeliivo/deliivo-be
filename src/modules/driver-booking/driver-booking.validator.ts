import { z } from 'zod';

export const bookingIdParamSchema = z.object({
    id: z.string().uuid('Invalid booking ID'),
});

export const otpSchema = z.object({
    otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits'),
});
