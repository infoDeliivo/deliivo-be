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
