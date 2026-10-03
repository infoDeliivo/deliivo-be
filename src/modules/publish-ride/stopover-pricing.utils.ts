import { StopoverPricingInput } from './publish-ride.types.js';

export type StopoverPricingByPlaceId = Record<string, number>;

export const buildStopoverPricingByPlaceId = (
    stopoverPricing: StopoverPricingInput[]
): StopoverPricingByPlaceId => {
    return stopoverPricing.reduce<StopoverPricingByPlaceId>((acc, item) => {
        acc[item.placeId] = item.pricePerSeat;
        return acc;
    }, {});
};

export interface StopoverFare {
    recommendedPrice: number;
    minPrice: number;
    maxPrice: number;
}

const STOPOVER_MIN_PRICE_MULTIPLIER = 0.8;
const STOPOVER_MAX_PRICE_MULTIPLIER = 1.67; // 250/150

/**
 * Distance-based fare for a single stopover.
 *
 * The publish preview and the saved draft must land on the same number, so this is the only place
 * the split is computed. Both distances are kilometres and must be passed unrounded — rounding the
 * numerator before taking the ratio is what made the preview disagree with what was persisted.
 */
export const calculateStopoverFare = (
    basePricePerSeat: number,
    distanceFromOriginKm: number,
    totalDistanceKm: number
): StopoverFare => {
    if (totalDistanceKm <= 0) {
        return { recommendedPrice: 0, minPrice: 0, maxPrice: 0 };
    }

    const ratio = Math.max(0, distanceFromOriginKm / totalDistanceKm);
    const stopoverBasePrice = basePricePerSeat * ratio;
    const round = (value: number) => Math.round(value * 100) / 100;

    // The upper multiplier can exceed the full-ride fare on a stop late in the route, which would
    // let part of the journey cost more than all of it. Cap it at the base price.
    const maxPrice = Math.min(stopoverBasePrice * STOPOVER_MAX_PRICE_MULTIPLIER, basePricePerSeat);

    return {
        recommendedPrice: round(stopoverBasePrice),
        minPrice: round(stopoverBasePrice * STOPOVER_MIN_PRICE_MULTIPLIER),
        maxPrice: round(maxPrice),
    };
};

/**
 * Hold a driver-chosen stopover fare inside the allowed range.
 *
 * The range moves whenever the base price or the route changes, so a fare the driver set earlier
 * can fall outside it later; clamping keeps the saved value legal instead of rejecting the update.
 */
export const clampToRange = (value: number, minPrice: number, maxPrice: number): number => {
    if (maxPrice < minPrice) {
        return Math.round(value * 100) / 100;
    }

    return Math.round(Math.min(Math.max(value, minPrice), maxPrice) * 100) / 100;
};

export const getStopoverPriceByPlaceId = (
    stopoverPricingByPlaceId: StopoverPricingByPlaceId | undefined,
    placeId: string
): number | null => {
    if (!stopoverPricingByPlaceId) {
        return null;
    }

    return Object.prototype.hasOwnProperty.call(stopoverPricingByPlaceId, placeId)
        ? stopoverPricingByPlaceId[placeId]
        : null;
};
