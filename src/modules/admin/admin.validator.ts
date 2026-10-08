import { z } from 'zod';
import { SUPPORTED_LOCALES } from '../../utils/locale.js';

export const vehicleIdParamSchema = z.object({
    id: z.string().uuid('A valid vehicle id is required'),
});

export const userIdParamSchema = z.object({
    id: z.string().uuid('A valid user id is required'),
});

const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true');

export const ADMIN_USER_SORT_FIELDS = ['createdAt', 'firstName', 'email'] as const;

export const adminListUsersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(200).optional(),
    status: z.enum(['active', 'banned', 'archived', 'all']).optional(),
    // Legacy filter, kept for existing callers; `status` supersedes it.
    isBanned: queryBoolean.optional(),
    role: z.string().trim().max(20).optional(),
    dlVerified: queryBoolean.optional(),
    country: z
        .string()
        .trim()
        .regex(/^[A-Za-z]{2}$/, 'country must be an ISO 3166-1 alpha-2 code')
        .transform((value) => value.toUpperCase())
        .optional(),
    // Only users with a DL upload or vehicle waiting on an admin decision.
    pending: queryBoolean.optional(),
    // Per-column filters from the admin users table.
    name: z.string().trim().min(1).max(100).optional(),
    email: z.string().trim().min(1).max(200).optional(),
    phone: z.string().trim().min(1).max(50).optional(),
    // `none` = the locale was never detected.
    language: z.enum([...SUPPORTED_LOCALES, 'none']).optional(),
    joinedFrom: z.coerce.date().optional(),
    joinedTo: z.coerce.date().optional(),
    // Same states the Vehicle and Payout columns display.
    vehicleState: z.enum(['NONE', 'PENDING', 'APPROVED', 'REJECTED']).optional(),
    payoutState: z.enum(['NOT_STARTED', 'INCOMPLETE', 'READY']).optional(),
    sortBy: z.enum(ADMIN_USER_SORT_FIELDS).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
});

export type AdminListUsersQuery = z.infer<typeof adminListUsersQuerySchema>;

export const adminUserCountriesQuerySchema = adminListUsersQuerySchema.pick({ status: true });

export type AdminUserCountriesQuery = z.infer<typeof adminUserCountriesQuerySchema>;

export const adminArchiveUserSchema = z.object({
    reason: z
        .string()
        .trim()
        .max(500, 'Archive reason must be 500 characters or fewer')
        .optional()
        .transform((value) => value || null),
});

export type AdminArchiveUserInput = z.infer<typeof adminArchiveUserSchema>;

export const adminPurgeUserSchema = z.object({
    // The target's phone, or its email when it has no phone.
    confirmIdentifier: z.string().trim().min(3, "Type the user's phone or email to confirm").max(254),
});

export type AdminPurgeUserInput = z.infer<typeof adminPurgeUserSchema>;

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

export const adminVerificationEmailSchema = z.object({
    subject: z
        .string()
        .trim()
        .min(3, 'Email subject is required')
        .max(160, 'Email subject must be 160 characters or fewer'),
    text: z
        .string()
        .trim()
        .min(20, 'Email text is required')
        .max(5000, 'Email text must be 5000 characters or fewer'),
});

export type AdminVerificationEmailInput = z.infer<typeof adminVerificationEmailSchema>;

export const rideOverrideQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    actorId: z.string().uuid('actorId must be a UUID').optional(),
    rideId: z.string().uuid('rideId must be a UUID').optional(),
    bookingId: z.string().uuid('bookingId must be a UUID').optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
});
