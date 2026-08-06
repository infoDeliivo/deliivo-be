import { z } from 'zod';

export const vehicleIdParamSchema = z.object({
    id: z.string().uuid('A valid vehicle id is required'),
});

export const rejectVehicleSchema = z.object({
    // The reason is shown to the driver verbatim in the rejection notification, so it
    // must actually say something.
    reason: z
        .string()
        .trim()
        .min(1, 'A rejection reason is required')
        .max(500, 'Rejection reason must be 500 characters or fewer'),
});

export type RejectVehicleInput = z.infer<typeof rejectVehicleSchema>;

const adminResolutionReason = z
    .string()
    .trim()
    .min(5, 'A support reason is required')
    .max(1000, 'Support reason must be 1000 characters or fewer');

export const bookingIdParamSchema = z.object({
    id: z.string().uuid('A valid booking id is required'),
});

export const adminForceCompleteBookingSchema = z.object({
    reason: adminResolutionReason,
});

export const adminOpenBookingDisputeSchema = z.object({
    reason: adminResolutionReason,
    description: z
        .string()
        .trim()
        .max(2000, 'Description must be 2000 characters or fewer')
        .optional(),
});

export type AdminForceCompleteBookingInput = z.infer<typeof adminForceCompleteBookingSchema>;
export type AdminOpenBookingDisputeInput = z.infer<typeof adminOpenBookingDisputeSchema>;
