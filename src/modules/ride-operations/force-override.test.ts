import { RideStatus } from '@prisma/client';
import {
    createForceContext,
    assertForceAllowedOnRide,
    FORCE_REQUIRES_RIDE_IN_PROGRESS,
} from './force-override.js';

describe('force override context', () => {
    it('throws the guard code when the caller did not force', () => {
        const context = createForceContext({});

        expect(() => context.assertOrForce(true, 'WAIT_TIME_NOT_ELAPSED')).toThrow('WAIT_TIME_NOT_ELAPSED');
        expect(context.forced).toBe(false);
        expect(context.summary().skippedChecks).toEqual([]);
    });

    it('records the guard instead of throwing when forced', () => {
        const context = createForceContext({ force: true, overrideReason: 'Rider never showed' });

        expect(() => context.assertOrForce(true, 'WAIT_TIME_NOT_ELAPSED')).not.toThrow();
        expect(context.summary()).toEqual({
            forced: true,
            overrideReason: 'Rider never showed',
            skippedChecks: ['WAIT_TIME_NOT_ELAPSED'],
        });
    });

    it('leaves a satisfied guard out of the skipped list', () => {
        const context = createForceContext({ force: true, overrideReason: 'Rider never showed' });

        context.assertOrForce(false, 'WAIT_TIME_NOT_ELAPSED');

        expect(context.summary().skippedChecks).toEqual([]);
    });

    it('does not repeat a guard code', () => {
        const context = createForceContext({ force: true, overrideReason: 'Rider never showed' });

        context.assertOrForce(true, 'BOOKING_NOT_AT_PICKUP');
        context.assertOrForce(true, 'BOOKING_NOT_AT_PICKUP');

        expect(context.summary().skippedChecks).toEqual(['BOOKING_NOT_AT_PICKUP']);
    });

    it('ignores advisory skips when the caller did not force', () => {
        const context = createForceContext({});

        context.noteSkip('GEOFENCE_OUT_OF_RANGE');

        expect(context.summary().skippedChecks).toEqual([]);
    });

    it('produces no event metadata unless forced', () => {
        expect(createForceContext({}).metadata()).toEqual({});
        expect(createForceContext({ overrideReason: 'just a note' }).metadata()).toEqual({});
    });

    it('annotates the event once forced', () => {
        const context = createForceContext({ force: true, overrideReason: '  Phone was dead  ' });
        context.assertOrForce(true, 'INVALID_PICKUP_OTP');

        expect(context.metadata()).toEqual({
            forced: true,
            manualOverride: true,
            overrideReason: 'Phone was dead',
            skippedChecks: ['INVALID_PICKUP_OTP'],
        });
    });
});

describe('assertForceAllowedOnRide', () => {
    const live = RideStatus.IN_PROGRESS;

    it('allows a forced action on a running ride', () => {
        const context = createForceContext({ force: true, overrideReason: 'Phone was dead' });

        expect(() => assertForceAllowedOnRide(context, live)).not.toThrow();
    });

    it.each([
        RideStatus.PUBLISHED,
        RideStatus.READY_TO_START,
        RideStatus.COMPLETED,
        RideStatus.CANCELLED,
        RideStatus.EXPIRED,
    ])('refuses a forced action while the ride is %s', (status) => {
        const context = createForceContext({ force: true, overrideReason: 'Phone was dead' });

        expect(() => assertForceAllowedOnRide(context, status)).toThrow(FORCE_REQUIRES_RIDE_IN_PROGRESS);
    });

    it('leaves an unforced call alone whatever the ride status', () => {
        const context = createForceContext({});

        expect(() => assertForceAllowedOnRide(context, RideStatus.CANCELLED)).not.toThrow();
    });
});
