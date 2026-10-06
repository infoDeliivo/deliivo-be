import { z } from 'zod';

export const createDisputeSchema = z.object({
    rideId: z.string().uuid(),
    bookingId: z.string().uuid(),
    reason: z.string().min(3).max(200),
    description: z.string().max(2000).optional(),
});

export const resolveDisputeSchema = z.object({
    resolution: z.enum(['REFUND', 'PAYOUT', 'SPLIT', 'ESCALATE']),
    refundPercent: z.coerce.number().min(0).max(100).optional(),
});

export const adminListDisputesQuerySchema = z.object({
    status: z.string().trim().max(50).optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type AdminListDisputesQuery = z.infer<typeof adminListDisputesQuerySchema>;
