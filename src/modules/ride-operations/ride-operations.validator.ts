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

const rideEventFields = {
    actionId: z.string().uuid('actionId must be a UUID (client-generated for idempotency)').default(() => randomUUID()),
    lat: latitude.optional(),
    lng: longitude.optional(),
    clientTimestamp: isoTimestamp.default(() => new Date().toISOString()),
};

// ============ RIDE EVENT BODY (start / finish / dropoff confirmations / missed pickup) ============
export const rideEventSchema = z.preprocess(
    (value) => value ?? {},
    z.object(rideEventFields)
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
        otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be 6 digits'),
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
        })
    ).min(1).max(50),
});

