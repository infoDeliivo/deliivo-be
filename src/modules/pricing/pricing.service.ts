import { prisma } from '../../config/index.js';
import {
    getActivePricingConfig,
    calculatePrice,
    validateDriverPrice,
    PriceCalculation,
} from './pricing.calculator.js';

const DEFAULT_REGION = 'BALTIC';

export interface PricingConfigInput {
    regionCode: string;
    currency: string;
    minRatePerKm: number;
    recommendedRatePerKm: number;
    maxRatePerKm: number;
    minimumSeatPrice: number;
    roundingStrategy: string;
    active?: boolean;
    validFrom?: Date;
    validTo?: Date | null;
    createdBy?: string;
}

const assertPricingBounds = (minRatePerKm: number, recommendedRatePerKm: number, maxRatePerKm: number) => {
    if (minRatePerKm > recommendedRatePerKm) {
        throw new Error('INVALID_PRICING_CONFIG');
    }
    if (recommendedRatePerKm > maxRatePerKm) {
        throw new Error('INVALID_PRICING_CONFIG');
    }
};

export const getPricePreview = async (params: {
    distanceKm: number;
    regionCode?: string;
}): Promise<PriceCalculation> => {
    const regionCode = params.regionCode || DEFAULT_REGION;
    const config = await getActivePricingConfig(regionCode);
    if (!config) throw new Error('PRICING_CONFIG_NOT_FOUND');

    return calculatePrice(params.distanceKm, config);
};

export const validateAndSnapshotPricing = async (params: {
    rideId: string;
    distanceKm: number;
    selectedPricePerSeat: number;
    regionCode?: string;
}): Promise<{ valid: boolean; reason?: string; snapshotId?: string }> => {
    const regionCode = params.regionCode || DEFAULT_REGION;
    const config = await getActivePricingConfig(regionCode);
    if (!config) throw new Error('PRICING_CONFIG_NOT_FOUND');

    const calculation = calculatePrice(params.distanceKm, config);
    const validation = validateDriverPrice(params.selectedPricePerSeat, calculation);

    if (!validation.valid) {
        return validation;
    }

    const snapshot = await prisma.ridePricingSnapshot.create({
        data: {
            rideId: params.rideId,
            pricingVersion: 'DISTANCE_RATE_V1',
            regionCode,
            currency: config.currency,
            distanceKm: params.distanceKm,
            minRatePerKm: config.minRatePerKm,
            recommendedRatePerKm: config.recommendedRatePerKm,
            maxRatePerKm: config.maxRatePerKm,
            minimumSeatPrice: config.minimumSeatPrice,
            recommendedPricePerSeat: calculation.recommendedPricePerSeat,
            minAllowedPricePerSeat: calculation.minAllowedPricePerSeat,
            maxAllowedPricePerSeat: calculation.maxAllowedPricePerSeat,
            selectedPricePerSeat: params.selectedPricePerSeat,
            roundingStrategy: config.roundingStrategy,
        },
    });

    return { valid: true, snapshotId: snapshot.id };
};

export const getActiveConfigs = async () => {
    return prisma.pricingConfig.findMany({
        where: { active: true },
        orderBy: { regionCode: 'asc' },
    });
};

export const listPricingConfigs = async () => {
    return prisma.pricingConfig.findMany({
        orderBy: [{ regionCode: 'asc' }, { validFrom: 'desc' }, { createdAt: 'desc' }],
    });
};

export const createPricingConfig = async (input: PricingConfigInput) => {
    const validFrom = input.validFrom ?? new Date();
    const shouldActivate = input.active ?? true;
    assertPricingBounds(input.minRatePerKm, input.recommendedRatePerKm, input.maxRatePerKm);

    return prisma.$transaction(async (tx) => {
        if (shouldActivate) {
            await tx.pricingConfig.updateMany({
                where: {
                    regionCode: input.regionCode,
                    active: true,
                },
                data: {
                    active: false,
                    validTo: validFrom,
                },
            });
        }

        return tx.pricingConfig.create({
            data: {
                regionCode: input.regionCode,
                currency: input.currency,
                minRatePerKm: input.minRatePerKm,
                recommendedRatePerKm: input.recommendedRatePerKm,
                maxRatePerKm: input.maxRatePerKm,
                minimumSeatPrice: input.minimumSeatPrice,
                roundingStrategy: input.roundingStrategy,
                active: shouldActivate,
                validFrom,
                validTo: shouldActivate ? null : (input.validTo ?? null),
                createdBy: input.createdBy ?? null,
            },
        });
    });
};

export const updatePricingConfig = async (id: string, input: Partial<PricingConfigInput>) => {
    const existing = await prisma.pricingConfig.findUnique({ where: { id } });
    if (!existing) {
        throw new Error('PRICING_CONFIG_NOT_FOUND');
    }

    const nextRegionCode = input.regionCode ?? existing.regionCode;
    const nextValidFrom = input.validFrom ?? existing.validFrom;
    const nextActive = input.active ?? existing.active;
    const nextMinRatePerKm = input.minRatePerKm ?? existing.minRatePerKm;
    const nextRecommendedRatePerKm = input.recommendedRatePerKm ?? existing.recommendedRatePerKm;
    const nextMaxRatePerKm = input.maxRatePerKm ?? existing.maxRatePerKm;

    assertPricingBounds(nextMinRatePerKm, nextRecommendedRatePerKm, nextMaxRatePerKm);

    return prisma.$transaction(async (tx) => {
        if (nextActive) {
            await tx.pricingConfig.updateMany({
                where: {
                    regionCode: nextRegionCode,
                    active: true,
                    NOT: { id },
                },
                data: {
                    active: false,
                    validTo: nextValidFrom,
                },
            });
        }

        return tx.pricingConfig.update({
            where: { id },
            data: {
                ...(input.regionCode !== undefined ? { regionCode: input.regionCode } : {}),
                ...(input.currency !== undefined ? { currency: input.currency } : {}),
                ...(input.minRatePerKm !== undefined ? { minRatePerKm: input.minRatePerKm } : {}),
                ...(input.recommendedRatePerKm !== undefined ? { recommendedRatePerKm: input.recommendedRatePerKm } : {}),
                ...(input.maxRatePerKm !== undefined ? { maxRatePerKm: input.maxRatePerKm } : {}),
                ...(input.minimumSeatPrice !== undefined ? { minimumSeatPrice: input.minimumSeatPrice } : {}),
                ...(input.roundingStrategy !== undefined ? { roundingStrategy: input.roundingStrategy } : {}),
                ...(input.active !== undefined ? { active: input.active } : {}),
                ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
                ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
                ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}),
                ...(input.active === true ? { validTo: null } : {}),
            },
        });
    });
};
