import { z } from 'zod';

export const createDisputeSchema = z.object({
    rideId: z.string().uuid(),
    bookingId: z.string().uuid(),
    reason: z.string().min(3).max(200),
    description: z.string().max(2000).optional(),
});

export const resolveDisputeSchema = z.object({
    resolution: z.enum(['REFUND', 'PAYOUT', 'SPLIT', 'ESCALATE']),
});
