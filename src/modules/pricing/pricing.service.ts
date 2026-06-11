import { prisma } from '../../config/index.js';
import {
    getActivePricingConfig,
    calculatePrice,
    validateDriverPrice,
    PriceCalculation,
} from './pricing.calculator.js';

const DEFAULT_REGION = 'BALTIC';

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
