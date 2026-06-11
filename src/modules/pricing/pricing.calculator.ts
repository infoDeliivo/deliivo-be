import { prisma } from '../../config/index.js';

export interface PricingConfigData {
    id: string;
    regionCode: string;
    currency: string;
    minRatePerKm: number;
    recommendedRatePerKm: number;
    maxRatePerKm: number;
    minimumSeatPrice: number;
    roundingStrategy: string;
}

export interface PriceCalculation {
    regionCode: string;
    currency: string;
    distanceKm: number;
    minRatePerKm: number;
    recommendedRatePerKm: number;
    maxRatePerKm: number;
    minimumSeatPrice: number;
    recommendedPricePerSeat: number;
    minAllowedPricePerSeat: number;
    maxAllowedPricePerSeat: number;
    roundingStrategy: string;
}

export interface SegmentPriceResult {
    fromPosition: number;
    toPosition: number;
    distanceKm: number;
    pricePerSeat: number;
}

const applyRounding = (amount: number, strategy: string): number => {
    switch (strategy) {
        case 'NEAREST_EURO':
            return Math.round(amount);
        case 'NEAREST_HALF_EURO':
            return Math.round(amount * 2) / 2;
        default:
            return Math.round(amount * 100) / 100;
    }
};

export const getActivePricingConfig = async (regionCode: string): Promise<PricingConfigData | null> => {
    const config = await prisma.pricingConfig.findFirst({
        where: {
            regionCode,
            active: true,
            validFrom: { lte: new Date() },
            OR: [
                { validTo: null },
                { validTo: { gt: new Date() } },
            ],
        },
        orderBy: { validFrom: 'desc' },
    });
    return config;
};

export const calculatePrice = (distanceKm: number, config: PricingConfigData): PriceCalculation => {
    const rawRecommended = distanceKm * config.recommendedRatePerKm;
    const rawMin = distanceKm * config.minRatePerKm;
    const rawMax = distanceKm * config.maxRatePerKm;

    const recommendedPricePerSeat = Math.max(
        config.minimumSeatPrice,
        applyRounding(rawRecommended, config.roundingStrategy)
    );
    const minAllowedPricePerSeat = Math.max(
        config.minimumSeatPrice,
        applyRounding(rawMin, config.roundingStrategy)
    );
    const maxAllowedPricePerSeat = Math.max(
        config.minimumSeatPrice,
        applyRounding(rawMax, config.roundingStrategy)
    );

    return {
        regionCode: config.regionCode,
        currency: config.currency,
        distanceKm,
        minRatePerKm: config.minRatePerKm,
        recommendedRatePerKm: config.recommendedRatePerKm,
        maxRatePerKm: config.maxRatePerKm,
        minimumSeatPrice: config.minimumSeatPrice,
        recommendedPricePerSeat,
        minAllowedPricePerSeat,
        maxAllowedPricePerSeat,
        roundingStrategy: config.roundingStrategy,
    };
};

export const validateDriverPrice = (
    selectedPrice: number,
    calculation: PriceCalculation
): { valid: boolean; reason?: string } => {
    if (selectedPrice < calculation.minAllowedPricePerSeat) {
        return { valid: false, reason: `Price below minimum (${calculation.minAllowedPricePerSeat} ${calculation.currency})` };
    }
    if (selectedPrice > calculation.maxAllowedPricePerSeat) {
        return { valid: false, reason: `Price above maximum (${calculation.maxAllowedPricePerSeat} ${calculation.currency})` };
    }
    return { valid: true };
};

export const calculateSegmentPrices = (
    totalDistanceKm: number,
    selectedPricePerSeat: number,
    segments: Array<{ fromPosition: number; toPosition: number; distanceKm: number }>,
    minimumSeatPrice: number,
    roundingStrategy: string
): SegmentPriceResult[] => {
    const ratePerKm = selectedPricePerSeat / totalDistanceKm;

    return segments.map(seg => {
        const rawPrice = seg.distanceKm * ratePerKm;
        const price = Math.max(minimumSeatPrice, applyRounding(rawPrice, roundingStrategy));
        return {
            fromPosition: seg.fromPosition,
            toPosition: seg.toPosition,
            distanceKm: seg.distanceKm,
            pricePerSeat: price,
        };
    });
};
