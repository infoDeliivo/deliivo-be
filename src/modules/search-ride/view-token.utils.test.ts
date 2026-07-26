import { decodeViewToken, encodeViewToken } from './view-token.utils.js';

describe('viewToken', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
    });

    it('round-trips a valid payload', () => {
        const token = encodeViewToken({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'waypoint:wp-b',
            dropRef: 'waypoint:wp-c',
        });

        expect(decodeViewToken(token)).toMatchObject({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'waypoint:wp-b',
            dropRef: 'waypoint:wp-c',
        });
    });

    it('rejects a tampered token', () => {
        const token = encodeViewToken({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'origin',
            dropRef: 'destination',
        });

        expect(() => decodeViewToken(`${token}x`)).toThrow('INVALID_VIEW_TOKEN');
    });

    it('rejects malformed but correctly signed payloads', () => {
        const token = encodeViewToken({
            v: 1,
            rideId: '',
            mode: 'segment',
            pickupRef: 'bad-ref' as any,
            dropRef: 'destination',
        } as any);

        expect(() => decodeViewToken(token)).toThrow('INVALID_VIEW_TOKEN');
    });

    it('uses ACCESS_TOKEN_SECRET as the production fallback for segment tokens', () => {
        process.env = {
            ...originalEnv,
            NODE_ENV: 'production',
            ACCESS_TOKEN_SECRET: 'test-access-secret',
            JWT_SECRET: '',
            SEGMENT_VIEW_TOKEN_SECRET: '',
        };

        const token = encodeViewToken({
            v: 1,
            rideId: 'ride-1',
            mode: 'segment',
            pickupRef: 'origin',
            dropRef: 'destination',
        });

        expect(decodeViewToken(token)).toMatchObject({
            rideId: 'ride-1',
            pickupRef: 'origin',
            dropRef: 'destination',
        });
    });
});
