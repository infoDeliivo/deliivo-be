import { z } from 'zod';

export const bookingIdParamSchema = z.object({
    id: z.string().uuid('Invalid booking ID'),
});

export const otpSchema = z.object({
    otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits'),
});

export const rejectReasonSchema = z.object({
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason must be 500 characters or less'),
});

export const cancelReasonSchema = z.object({
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason must be 500 characters or less'),
});
