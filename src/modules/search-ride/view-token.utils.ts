import { createHmac, timingSafeEqual } from 'node:crypto';
import { SegmentPointRef } from './segment-view.utils.js';

export interface ViewTokenPayload {
    v: 1;
    rideId: string;
    mode: 'segment';
    pickupRef: SegmentPointRef;
    dropRef: SegmentPointRef;
}

const INVALID_VIEW_TOKEN = 'INVALID_VIEW_TOKEN';

const isValidRef = (value: string): value is SegmentPointRef =>
    value === 'origin' ||
    value === 'destination' ||
    (value.startsWith('waypoint:') && value.slice('waypoint:'.length).trim().length > 0);

const getSecret = (): string => {
    const secret = process.env.SEGMENT_VIEW_TOKEN_SECRET || process.env.JWT_SECRET;
    if (secret) {
        return secret;
    }

    if (process.env.NODE_ENV === 'production') {
        throw new Error(INVALID_VIEW_TOKEN);
    }

    return 'dev-segment-secret';
};

const base64UrlEncode = (input: Buffer | string): string =>
    Buffer.isBuffer(input) ? input.toString('base64url') : Buffer.from(input).toString('base64url');

const safeEqual = (left: string, right: string): boolean => {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
};

export const encodeViewToken = (payload: ViewTokenPayload): string => {
    const body = base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac('sha256', getSecret()).update(body).digest('base64url');

    return `${body}.${signature}`;
};

export const decodeViewToken = (token: string): ViewTokenPayload => {
    try {
        const [body, signature, ...rest] = token.split('.');
        if (!body || !signature || rest.length > 0) {
            throw new Error(INVALID_VIEW_TOKEN);
        }

        const expectedSignature = createHmac('sha256', getSecret()).update(body).digest('base64url');
        if (!safeEqual(signature, expectedSignature)) {
            throw new Error(INVALID_VIEW_TOKEN);
        }

        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown;
        if (
            !payload ||
            typeof payload !== 'object' ||
            (payload as ViewTokenPayload).v !== 1 ||
            (payload as ViewTokenPayload).mode !== 'segment' ||
            typeof (payload as ViewTokenPayload).rideId !== 'string' ||
            (payload as ViewTokenPayload).rideId.trim().length === 0 ||
            typeof (payload as ViewTokenPayload).pickupRef !== 'string' ||
            typeof (payload as ViewTokenPayload).dropRef !== 'string' ||
            !isValidRef((payload as ViewTokenPayload).pickupRef) ||
            !isValidRef((payload as ViewTokenPayload).dropRef)
        ) {
            throw new Error(INVALID_VIEW_TOKEN);
        }

        return payload as ViewTokenPayload;
    } catch {
        throw new Error(INVALID_VIEW_TOKEN);
    }
};
