import { decodeViewToken, encodeViewToken } from './view-token.utils.js';

describe('viewToken', () => {
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
});
