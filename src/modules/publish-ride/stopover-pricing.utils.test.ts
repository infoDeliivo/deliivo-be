import {
    buildStopoverPricingByPlaceId,
    calculateStopoverFare,
    clampToRange,
    getStopoverPriceByPlaceId,
} from './stopover-pricing.utils';

describe('stopover-pricing utils', () => {
    it('builds a placeId-keyed pricing map from draft stopover pricing input', () => {
        const map = buildStopoverPricingByPlaceId([
            { placeId: 'stop-1', pricePerSeat: 12.5 },
            { placeId: 'stop-2', pricePerSeat: 20 },
            { placeId: 'stop-1', pricePerSeat: 15 },
        ]);

        expect(map).toEqual({
            'stop-1': 15,
            'stop-2': 20,
        });
    });

    it('returns null when a placeId is missing from the pricing map', () => {
        expect(getStopoverPriceByPlaceId({ 'stop-1': 12.5 }, 'stop-1')).toBe(12.5);
        expect(getStopoverPriceByPlaceId({ 'stop-1': 12.5 }, 'missing')).toBeNull();
        expect(getStopoverPriceByPlaceId(undefined, 'stop-1')).toBeNull();
    });

    it('splits the base price by the share of the route covered', () => {
        expect(calculateStopoverFare(40, 50, 200)).toEqual({
            recommendedPrice: 10,
            minPrice: 8,
            maxPrice: 16.7,
        });
    });

    it('never lets a stop cost more than the full ride', () => {
        // 90% of the route: 1.67x the share would be 60.12, above the 40 charged end to end.
        expect(calculateStopoverFare(40, 180, 200).maxPrice).toBe(40);
    });

    it('prices from the unrounded distance, not a pre-rounded one', () => {
        // 0.04 km of numerator drift is what used to separate the preview from the saved draft.
        expect(calculateStopoverFare(100, 49.96, 100).recommendedPrice).toBe(49.96);
        expect(calculateStopoverFare(100, 50, 100).recommendedPrice).toBe(50);
    });

    it('returns zero fares when the route distance is unknown', () => {
        expect(calculateStopoverFare(40, 50, 0)).toEqual({
            recommendedPrice: 0,
            minPrice: 0,
            maxPrice: 0,
        });
    });

    it('holds a driver-chosen fare inside the allowed range', () => {
        expect(clampToRange(12, 8, 16.7)).toBe(12);
        expect(clampToRange(2, 8, 16.7)).toBe(8);
        expect(clampToRange(9999, 8, 16.7)).toBe(16.7);
    });
});
