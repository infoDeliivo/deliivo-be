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

export const userIdParamSchema = z.object({
    id: z.string().uuid('A valid user id is required'),
});
