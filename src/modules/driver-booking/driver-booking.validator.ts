import { z } from 'zod';
import { forceFields, refineForceReason } from '../ride-operations/ride-operations.validator.js';

export const bookingIdParamSchema = z.object({
    id: z.string().uuid('Invalid booking ID'),
});

export const otpSchema = z.object({
    // Optional only when forcing — a driver overriding the OTP has no code to send.
    otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits').optional(),
    ...forceFields,
})
    .superRefine(refineForceReason)
    .superRefine((value, ctx) => {
        if (value.force !== true && !value.otp) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: ['otp'],
                message: 'otp is required unless force is true',
            });
        }
    });

export const rejectReasonSchema = z.object({
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason must be 500 characters or less'),
});

export const cancelReasonSchema = z.object({
    reason: z.string().min(1, 'Reason is required').max(500, 'Reason must be 500 characters or less'),
});
