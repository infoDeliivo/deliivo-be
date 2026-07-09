import { createHmac, timingSafeEqual } from "crypto";

/**
 * HMAC token for the local-dev direct-upload receiver.
 * Only used when STORAGE_PROVIDER=local (no bucket configured). Signs the staged
 * object key + expiry so the PUT receiver can't be used to write arbitrary paths.
 */
const secret = () => process.env.JWT_SECRET || process.env.ACCESS_TOKEN_SECRET || 'local-dev-upload-secret';

const sign = (payload: string): string =>
    createHmac('sha256', secret()).update(payload).digest('base64url');

export const createLocalUploadToken = (key: string, expiresInSec = 300): string => {
    const exp = Math.floor(Date.now() / 1000) + expiresInSec;
    const payload = `${Buffer.from(key).toString('base64url')}.${exp}`;
    return `${payload}.${sign(payload)}`;
};

export const verifyLocalUploadToken = (token: string): { key: string } | null => {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [encKey, expStr, sig] = parts;
    const payload = `${encKey}.${expStr}`;
    const expected = sign(payload);
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;
    return { key: Buffer.from(encKey, 'base64url').toString('utf8') };
};
