import { prisma } from '../../config/index.js';
import { Prisma } from '@prisma/client';
import {
    getActivePricingConfig,
    calculatePrice,
    validateDriverPrice,
    PriceCalculation,
} from './pricing.calculator.js';

const DEFAULT_REGION = 'BALTIC';
const DEFAULT_PRICING_CREATED_BY = 'system';

export const DEFAULT_BALTIC_PRICING_CONFIG = {
    id: 'default-baltic-distance-pricing',
    regionCode: DEFAULT_REGION,
    currency: 'EUR',
    minRatePerKm: 0.06,
    recommendedRatePerKm: 0.08,
    maxRatePerKm: 0.12,
    minimumSeatPrice: 3,
    roundingStrategy: 'NEAREST_EURO',
    serviceFeePercent: 2,
    serviceFeeFlat: 0,
} as const;

export interface PricingConfigInput {
    regionCode: string;
    currency: string;
    minRatePerKm: number;
    recommendedRatePerKm: number;
    maxRatePerKm: number;
    minimumSeatPrice: number;
    roundingStrategy: string;
    serviceFeePercent: number;
    serviceFeeFlat: number;
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
    tx?: Prisma.TransactionClient;
}): Promise<{ valid: boolean; reason?: string; snapshotId?: string }> => {
    const regionCode = params.regionCode || DEFAULT_REGION;
    const config = await getActivePricingConfig(regionCode);
    if (!config) throw new Error('PRICING_CONFIG_NOT_FOUND');

    const calculation = calculatePrice(params.distanceKm, config);
    const validation = validateDriverPrice(params.selectedPricePerSeat, calculation);

    if (!validation.valid) {
        return validation;
    }

    const db = params.tx ?? prisma;
    const snapshot = await db.ridePricingSnapshot.create({
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
            serviceFeePercent: config.serviceFeePercent,
            serviceFeeFlat: config.serviceFeeFlat,
        },
    });

    return { valid: true, snapshotId: snapshot.id };
};

export interface ServiceFeeTerms {
    serviceFeePercent: number;
    serviceFeeFlat: number;
    source: 'SNAPSHOT' | 'ACTIVE_CONFIG' | 'DEFAULT';
}

/**
 * Fee terms for a published ride. Prefers the snapshot frozen at publish time so that changing the
 * admin rate never reprices a ride whose price was already advertised to riders and drivers.
 */
export const resolveRideFeeTerms = async (rideId: string): Promise<ServiceFeeTerms> => {
    const snapshot = await prisma.ridePricingSnapshot.findUnique({
        where: { rideId },
        select: { regionCode: true, serviceFeePercent: true, serviceFeeFlat: true },
    });

    if (snapshot) {
        return {
            serviceFeePercent: snapshot.serviceFeePercent,
            serviceFeeFlat: snapshot.serviceFeeFlat,
            source: 'SNAPSHOT',
        };
    }

    // Snapshot creation is best-effort at publish time (skipped when route distance is unknown), so
    // fall back to the live config for snapshot-less rides rather than charging nothing.
    return resolveActiveFeeTerms();
};

/**
 * Fee terms for many rides at once — one snapshot query plus one config read.
 *
 * Search prices every candidate ride, so resolving per ride would issue a query per result. Rides
 * without a snapshot fall back to the live config, matching `resolveRideFeeTerms`.
 */
export const resolveFeeTermsForRides = async (
    rideIds: string[]
): Promise<Map<string, ServiceFeeTerms>> => {
    const terms = new Map<string, ServiceFeeTerms>();
    if (rideIds.length === 0) return terms;

    const snapshots = await prisma.ridePricingSnapshot.findMany({
        where: { rideId: { in: rideIds } },
        select: { rideId: true, serviceFeePercent: true, serviceFeeFlat: true },
    });

    for (const snapshot of snapshots) {
        terms.set(snapshot.rideId, {
            serviceFeePercent: snapshot.serviceFeePercent,
            serviceFeeFlat: snapshot.serviceFeeFlat,
            source: 'SNAPSHOT',
        });
    }

    if (terms.size < rideIds.length) {
        const fallback = await resolveActiveFeeTerms();
        for (const rideId of rideIds) {
            if (!terms.has(rideId)) terms.set(rideId, fallback);
        }
    }

    return terms;
};

/** Fee terms for the live config — used by the publish flow, where no ride exists yet. */
export const resolveActiveFeeTerms = async (regionCode?: string): Promise<ServiceFeeTerms> => {
    const config = await getActivePricingConfig(regionCode || DEFAULT_REGION);
    if (config) {
        return {
            serviceFeePercent: config.serviceFeePercent,
            serviceFeeFlat: config.serviceFeeFlat,
            source: 'ACTIVE_CONFIG',
        };
    }

    // Seed the row for next time, but fall back to the compiled-in defaults for the answer: this
    // function promises a value, so it must not depend on the write round-tripping.
    const ensured = await ensureDefaultPricingConfig().catch(() => null);
    return {
        serviceFeePercent: ensured?.serviceFeePercent ?? DEFAULT_BALTIC_PRICING_CONFIG.serviceFeePercent,
        serviceFeeFlat: ensured?.serviceFeeFlat ?? DEFAULT_BALTIC_PRICING_CONFIG.serviceFeeFlat,
        source: 'DEFAULT',
    };
};

export const getActiveConfigs = async () => {
    await ensureDefaultPricingConfig();
    return prisma.pricingConfig.findMany({
        where: { active: true },
        orderBy: { regionCode: 'asc' },
    });
};

export const ensureDefaultPricingConfig = async () => {
    const existing = await prisma.pricingConfig.findFirst({
        where: { regionCode: DEFAULT_REGION },
        orderBy: [{ active: 'desc' }, { validFrom: 'desc' }, { createdAt: 'desc' }],
    });

    if (existing) return existing;

    return prisma.pricingConfig.create({
        data: {
            ...DEFAULT_BALTIC_PRICING_CONFIG,
            active: true,
            validFrom: new Date(),
            validTo: null,
            createdBy: DEFAULT_PRICING_CREATED_BY,
        },
    });
};

export const listPricingConfigs = async () => {
    await ensureDefaultPricingConfig();
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
                serviceFeePercent: input.serviceFeePercent,
                serviceFeeFlat: input.serviceFeeFlat,
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
                ...(input.serviceFeePercent !== undefined ? { serviceFeePercent: input.serviceFeePercent } : {}),
                ...(input.serviceFeeFlat !== undefined ? { serviceFeeFlat: input.serviceFeeFlat } : {}),
                ...(input.active !== undefined ? { active: input.active } : {}),
                ...(input.validFrom !== undefined ? { validFrom: input.validFrom } : {}),
                ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
                ...(input.createdBy !== undefined ? { createdBy: input.createdBy } : {}),
                ...(input.active === true ? { validTo: null } : {}),
            },
        });
    });
};
