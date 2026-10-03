import { rideEventSchema, verifyPickupOtpSchema, offlineSyncSchema } from './ride-operations.validator.js';

const issuePaths = (result: { success: boolean; error?: { issues: Array<{ path: PropertyKey[] }> } }) =>
    (result.error?.issues ?? []).map((issue) => issue.path.join('.'));

describe('ride event body', () => {
    it('accepts an empty body and defaults force to false', () => {
        const result = rideEventSchema.safeParse(undefined);

        expect(result.success).toBe(true);
        expect(result.success && result.data.force).toBe(false);
    });

    it('rejects force without a reason', () => {
        const result = rideEventSchema.safeParse({ force: true });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('overrideReason');
    });

    it('rejects a reason that explains nothing', () => {
        const result = rideEventSchema.safeParse({ force: true, overrideReason: 'x' });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('overrideReason');
    });

    it('accepts force with a written reason', () => {
        const result = rideEventSchema.safeParse({ force: true, overrideReason: 'Rider never showed up' });

        expect(result.success).toBe(true);
        expect(result.success && result.data.overrideReason).toBe('Rider never showed up');
    });

    it('still accepts a reason on its own — it is metadata, not an override', () => {
        const result = rideEventSchema.safeParse({ overrideReason: 'noting this down' });

        expect(result.success).toBe(true);
        expect(result.success && result.data.force).toBe(false);
    });
});

describe('verify pickup OTP body', () => {
    it('requires the OTP when not forcing', () => {
        const result = verifyPickupOtpSchema.safeParse({});

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('otp');
    });

    it('drops the OTP requirement when forcing with a reason', () => {
        const result = verifyPickupOtpSchema.safeParse({
            force: true,
            overrideReason: 'Rider phone was dead, checked ID',
        });

        expect(result.success).toBe(true);
    });

    it('still rejects a malformed OTP while forcing', () => {
        const result = verifyPickupOtpSchema.safeParse({
            otp: '12ab',
            force: true,
            overrideReason: 'Rider phone was dead, checked ID',
        });

        expect(result.success).toBe(false);
        expect(issuePaths(result)).toContain('otp');
    });
});

describe('offline sync body', () => {
    const action = {
        actionId: '11111111-1111-4111-8111-111111111111',
        eventType: 'MANUAL_CONFIRM_DROPOFF',
        rideId: '22222222-2222-4222-8222-222222222222',
        clientTimestamp: '2026-09-16T10:00:00.000Z',
    };

    it('rejects a forced queued action with no reason', () => {
        const result = offlineSyncSchema.safeParse({ actions: [{ ...action, force: true }] });

        expect(result.success).toBe(false);
    });

    it('accepts a forced queued action with a reason', () => {
        const result = offlineSyncSchema.safeParse({
            actions: [{ ...action, force: true, overrideReason: 'Queued while offline' }],
        });

        expect(result.success).toBe(true);
    });
});
