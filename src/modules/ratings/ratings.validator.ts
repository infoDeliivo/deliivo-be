import { z } from 'zod';

export const submitRatingParamsSchema = z.object({
  bookingId: z.string().uuid('Invalid booking ID'),
});

export const submitRatingBodySchema = z.object({
  stars: z.number().int().min(1).max(5),
  reviewText: z.string().trim().max(500).optional(),
});
