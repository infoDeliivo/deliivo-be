import { z } from 'zod';
import { randomUUID } from 'crypto';

// ============ PARAM SCHEMAS ============
export const rideIdParamSchema = z.object({
    rideId: z.string().uuid('Invalid ride ID'),
});

export const bookingIdParamSchema = z.object({
    id: z.string().uuid('Invalid booking ID'),
});

// ============ SHARED FIELD SHAPES ============
const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const isoTimestamp = z.string().datetime({ offset: true, message: 'timestamp must be an ISO 8601 date-time string' });

/** Minimum length of a written override reason — enough to be a real explanation. */
export const OVERRIDE_REASON_MIN_LENGTH = 5;

export const forceFields = {
    force: z.boolean().optional().default(false),
    overrideReason: z
        .string()
        .trim()
        .min(OVERRIDE_REASON_MIN_LENGTH, `overrideReason must be at least ${OVERRIDE_REASON_MIN_LENGTH} characters`)
        .max(500)
        .optional(),
};

/** A forced action is only accepted with a written reason — it ends up in the audit trail. */
export const refineForceReason = (
    value: { force?: boolean; overrideReason?: string },
    ctx: z.RefinementCtx
) => {
    if (value.force === true && !value.overrideReason?.trim()) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['overrideReason'],
            message: 'overrideReason is required when force is true',
        });
    }
};

const rideEventFields = {
    actionId: z.string().uuid('actionId must be a UUID (client-generated for idempotency)').default(() => randomUUID()),
    lat: latitude.optional(),
    lng: longitude.optional(),
    clientTimestamp: isoTimestamp.default(() => new Date().toISOString()),
    ...forceFields,
};

// ============ RIDE EVENT BODY (start / finish / dropoff confirmations / missed pickup) ============
export const rideEventSchema = z.preprocess(
    (value) => value ?? {},
    z.object(rideEventFields).superRefine(refineForceReason)
);

// ============ LOCATION BODY (driver GPS ping) ============
export const locationSchema = z.object({
    lat: latitude,
    lng: longitude,
    speed: z.number().min(0).optional(),
    heading: z.number().min(0).max(360).optional(),
    accuracy: z.number().min(0).optional(),
    timestamp: isoTimestamp,
});

// ============ VERIFY PICKUP OTP BODY ============
export const verifyPickupOtpSchema = z.preprocess(
    (value) => value ?? {},
    z.object({
        ...rideEventFields,
        // Optional only when forcing — a driver overriding the OTP has no code to send.
        otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits').optional(),
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
        })
);

// ============ OFFLINE SYNC BODY ============
export const offlineSyncSchema = z.object({
    actions: z.array(
        z.object({
            actionId: z.string().uuid('actionId must be a UUID'),
            eventType: z.string().min(1),
            rideId: z.string().uuid('rideId must be a UUID'),
            bookingId: z.string().uuid('bookingId must be a UUID').optional(),
            lat: latitude.optional(),
            lng: longitude.optional(),
            clientTimestamp: isoTimestamp,
            ...forceFields,
        }).superRefine(refineForceReason)
    ).min(1).max(50),
});
