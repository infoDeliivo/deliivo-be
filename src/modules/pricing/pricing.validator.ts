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

export const pricingConfigIdSchema = z.object({
    id: z.string().uuid('Invalid pricing config ID'),
});

const pricingConfigBaseSchema = z.object({
    regionCode: z.string().trim().min(2).max(32),
    currency: z.string().trim().min(3).max(3),
    minRatePerKm: z.number().positive(),
    recommendedRatePerKm: z.number().positive(),
    maxRatePerKm: z.number().positive(),
    minimumSeatPrice: z.number().positive(),
    roundingStrategy: z.enum(['NEAREST_EURO', 'NEAREST_HALF_EURO', 'DECIMAL']),
    active: z.boolean().optional(),
    validFrom: z.coerce.date().optional(),
    validTo: z.coerce.date().nullable().optional(),
    createdBy: z.string().uuid().optional(),
});

export const pricingConfigCreateSchema = pricingConfigBaseSchema.refine((data) => data.minRatePerKm <= data.recommendedRatePerKm, {
    message: 'minRatePerKm must be less than or equal to recommendedRatePerKm',
    path: ['recommendedRatePerKm'],
}).refine((data) => data.recommendedRatePerKm <= data.maxRatePerKm, {
    message: 'recommendedRatePerKm must be less than or equal to maxRatePerKm',
    path: ['maxRatePerKm'],
});

export const pricingConfigUpdateSchema = pricingConfigBaseSchema.partial().extend({
    active: z.boolean().optional(),
});
