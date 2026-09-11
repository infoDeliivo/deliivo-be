import { calculateBookingPrice } from './booking-price.js';

describe('calculateBookingPrice', () => {
    it('adds the fee on top so the driver keeps the fare they set', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 20,
            seatsBooked: 1,
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });

        expect(b.subtotal).toBe(20);
        expect(b.serviceFee).toBe(0.4);
        expect(b.totalPrice).toBe(20.4);
        expect(b.subtotal).toBe(20); // unchanged by the fee
    });

    it('scales the subtotal by seats and charges the fee once on the booking', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 14,
            seatsBooked: 2,
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });

        expect(b.subtotal).toBe(28);
        expect(b.serviceFee).toBe(0.56);
        expect(b.totalPrice).toBe(28.56);
    });

    it('does not accumulate per-seat rounding drift', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 3.3,
            seatsBooked: 3,
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });

        // Per-seat would be round(0.066) = 0.07, times 3 = 0.21. The charged fee is on 9.90.
        expect(b.subtotal).toBe(9.9);
        expect(b.serviceFee).toBe(0.2);
        expect(b.serviceFee).not.toBe(0.21);
        expect(b.totalPrice).toBe(10.1);
    });

    it('keeps subtotal + luggageFee + serviceFee exactly equal to totalPrice', () => {
        for (const [price, seats] of [[3.33, 3], [7.77, 2], [12.5, 4], [0.01, 1]] as const) {
            const b = calculateBookingPrice({
                basePricePerSeat: price,
                seatsBooked: seats,
                serviceFeePercent: 2,
                serviceFeeFlat: 0,
            });
            const cents = (n: number) => Math.round(n * 100);
            expect(cents(b.subtotal) + cents(b.luggageFee) + cents(b.serviceFee)).toBe(cents(b.totalPrice));
        }
    });

    it('charges nothing extra at a zero rate', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 10,
            seatsBooked: 2,
            serviceFeePercent: 0,
            serviceFeeFlat: 0,
        });

        expect(b.serviceFee).toBe(0);
        expect(b.totalPrice).toBe(b.subtotal);
    });

    it('rounds a sub-cent fee down to zero without breaking the total', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 0.01,
            seatsBooked: 1,
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });

        expect(b.serviceFee).toBe(0);
        expect(b.totalPrice).toBe(0.01);
    });

    it('adds the flat component once per booking, not per seat', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 10,
            seatsBooked: 3,
            serviceFeePercent: 0,
            serviceFeeFlat: 0.3,
        });

        expect(b.subtotal).toBe(30);
        expect(b.serviceFee).toBe(0.3);
        expect(b.totalPrice).toBe(30.3);
    });

    it('never treats luggage as a surcharge', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 10,
            seatsBooked: 1,
            luggageCount: 3,
            serviceFeePercent: 2,
            serviceFeeFlat: 0,
        });

        expect(b.luggageFee).toBe(0);
        expect(b.totalPrice).toBe(10.2);
    });

    it('reports the rate it used so clients need no arithmetic', () => {
        const b = calculateBookingPrice({
            basePricePerSeat: 10,
            seatsBooked: 1,
            currency: 'EUR',
            serviceFeePercent: 2,
            serviceFeeFlat: 0.3,
        });

        expect(b.serviceFeePercent).toBe(2);
        expect(b.serviceFeeFlat).toBe(0.3);
        expect(b.currency).toBe('EUR');
    });
});
