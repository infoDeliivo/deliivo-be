import { z } from 'zod';

// ============ Query Schemas ============

export const getNotificationsQuerySchema = z.object({
    cursor: z.string().uuid().optional(),
    limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 20))
        .pipe(z.number().int().min(1).max(50)),
});

// ============ Body Schemas ============

export const markReadSchema = z.object({
    notificationIds: z.array(z.string().uuid()).min(1, 'At least one notification ID is required').max(100),
});

export const registerDeviceSchema = z.object({
    platform: z.string().min(1, 'Platform is required'),
    token: z.string().min(1, 'Device token is required'),
});

// ============ Param Schemas ============

export const tokenIdParamSchema = z.object({
    tokenId: z.string().uuid('Invalid token ID'),
});

export const notificationIdParamSchema = z.object({
    notificationId: z.string().uuid('Invalid notification ID'),
});
