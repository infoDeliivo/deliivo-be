import { combineDepartureDateTimeInRideTimezone } from './ride-timezone.js';

describe('ride-timezone', () => {
    it('maps local Tallinn departure time to the correct UTC instant during summer time', () => {
        const departureAt = combineDepartureDateTimeInRideTimezone(
            new Date('2026-08-06T22:00:00.000Z'),
            '13:00',
        );

        expect(departureAt.toISOString()).toBe('2026-08-07T10:00:00.000Z');
    });

    it('rejects invalid departure times', () => {
        expect(() =>
            combineDepartureDateTimeInRideTimezone(new Date('2026-08-06T22:00:00.000Z'), '25:00'),
        ).toThrow('INVALID_RIDE_DEPARTURE_TIME');
    });
});
