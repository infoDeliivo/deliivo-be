import { sumReservedSeats } from './segment-capacity.utils.js';

const reserved = (seatsBooked: number) => ({ seatsBooked, seatsReservedAt: new Date() });
const unreserved = (seatsBooked: number) => ({ seatsBooked, seatsReservedAt: null });

describe('sumReservedSeats', () => {
    it('returns 0 for a ride with no bookings', () => {
        expect(sumReservedSeats([])).toBe(0);
    });

    it('counts only bookings that hold seats', () => {
        expect(sumReservedSeats([reserved(1), unreserved(2), reserved(1)])).toBe(2);
    });

    it('sums seats, not booking rows', () => {
        expect(sumReservedSeats([reserved(3), reserved(2)])).toBe(5);
    });

    it('counts a segment booking alongside whole-route ones', () => {
        // The reported regression: two whole-route riders plus one segment rider on a
        // 3-seat ride. The driver must see 3, whichever legs the segment covers.
        expect(sumReservedSeats([reserved(1), reserved(1), reserved(1)])).toBe(3);
    });

    it('reports seats sold even when peak occupancy is lower', () => {
        // Two riders on disjoint legs: availableSeats (totalSeats - peak) would say one
        // seat is taken, but two were sold.
        const bookings = [reserved(1), reserved(1)];
        const totalSeats = 3;
        const peakOccupied = 1;

        expect(sumReservedSeats(bookings)).toBe(2);
        expect(totalSeats - peakOccupied).toBe(2); // availableSeats, a different question
    });
});
