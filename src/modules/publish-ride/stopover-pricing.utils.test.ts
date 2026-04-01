import {
    buildStopoverPricingByPlaceId,
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
});
