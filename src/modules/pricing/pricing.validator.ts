import { z } from 'zod';

export const pricePreviewSchema = z.object({
    distanceKm: z.number().positive(),
    regionCode: z.string().optional(),
});

export const validatePriceSchema = z.object({
    rideId: z.string().uuid(),
    distanceKm: z.number().positive(),
    selectedPricePerSeat: z.number().positive(),
    regionCode: z.string().optional(),
});
