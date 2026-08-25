import {
    RIDE_START_EARLY_LIMIT_ENV,
    getRideStartEarlyLimitMinutes,
    isRideStartTooEarly,
    rideTooEarlyMessage,
} from './ride-start-window.js';

const DEPARTURE = new Date('2026-08-25T12:00:00.000Z');
const departurePlusMinutes = (minutes: number) => DEPARTURE.getTime() + minutes * 60 * 1000;

describe('ride start window', () => {
    const originalValue = process.env[RIDE_START_EARLY_LIMIT_ENV];

    afterEach(() => {
        if (originalValue === undefined) delete process.env[RIDE_START_EARLY_LIMIT_ENV];
        else process.env[RIDE_START_EARLY_LIMIT_ENV] = originalValue;
    });

    describe('getRideStartEarlyLimitMinutes', () => {
        it('returns null when the env var is unset', () => {
            delete process.env[RIDE_START_EARLY_LIMIT_ENV];
            expect(getRideStartEarlyLimitMinutes()).toBeNull();
        });

        it('returns null when the env var is blank', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = '   ';
            expect(getRideStartEarlyLimitMinutes()).toBeNull();
        });

        it('returns null for non-numeric or negative values', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = 'soon';
            expect(getRideStartEarlyLimitMinutes()).toBeNull();

            process.env[RIDE_START_EARLY_LIMIT_ENV] = '-5';
            expect(getRideStartEarlyLimitMinutes()).toBeNull();
        });

        it('parses configured minutes', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = '10';
            expect(getRideStartEarlyLimitMinutes()).toBe(10);

            process.env[RIDE_START_EARLY_LIMIT_ENV] = '0';
            expect(getRideStartEarlyLimitMinutes()).toBe(0);
        });
    });

    describe('isRideStartTooEarly', () => {
        it('never blocks when no limit is configured', () => {
            delete process.env[RIDE_START_EARLY_LIMIT_ENV];
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(-600))).toBe(false);
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(0))).toBe(false);
        });

        it('blocks before departure when the limit is 0', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = '0';
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(-1))).toBe(true);
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(0))).toBe(false);
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(5))).toBe(false);
        });

        it('allows starting inside the configured window', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = '10';
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(-11))).toBe(true);
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(-10))).toBe(false);
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(-1))).toBe(false);
        });

        it('falls back to no restriction on an invalid value', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = 'ten';
            expect(isRideStartTooEarly(DEPARTURE, departurePlusMinutes(-600))).toBe(false);
        });
    });

    describe('rideTooEarlyMessage', () => {
        it('describes the departure-time rule when there is no window', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = '0';
            expect(rideTooEarlyMessage()).toBe('Ride cannot be started before the scheduled departure time');
        });

        it('includes the configured minutes', () => {
            process.env[RIDE_START_EARLY_LIMIT_ENV] = '15';
            expect(rideTooEarlyMessage()).toBe(
                'Ride cannot be started more than 15 minutes before the scheduled departure time',
            );
        });
    });
});
