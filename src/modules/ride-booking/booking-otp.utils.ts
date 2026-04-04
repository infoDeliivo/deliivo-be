import { createHash, randomInt } from 'crypto';

export const generateBookingOtp = (): string => String(randomInt(100000, 1000000));

export const hashOtp = (otp: string): string =>
    createHash('sha256').update(otp).digest('hex');

export const isOtpValid = (inputOtp: string, storedHash: string): boolean =>
    hashOtp(inputOtp) === storedHash;
