import redis from '../../cache/redis.js';
import twilio from 'twilio';
import { OTP_EXPIRY_MINUTES, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SEC } from './otp.constants.js';

const otpKey = (identifier: string, purpose: string, method: string) =>
  `otp:${purpose}:${identifier}:${method}`;

export const createOtp = async (
  identifier: string,
  purpose: 'signup' | 'login' | 'reset_password',
  method: string,
) => {
  const isOtpDebugMode = process.env.NODE_ENV === 'staging' || process.env.DISABLE_REAL_OTP === 'true';
  const useTwilioVerify = !isOtpDebugMode && process.env.OTP_ENGINE === 'twilio_verify' && method === 'phone';
  if (useTwilioVerify) {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await client.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID as string).verifications.create({
      to: identifier,
      channel: 'sms',
    });
    return { success: true, code: 'TWILIO_VERIFY', reason: null };
  }

  const key = otpKey(identifier, purpose, method);

  const ttl = await redis.ttl(key);

  // Cooldown check
  if (ttl > OTP_EXPIRY_MINUTES * 60 - OTP_RESEND_COOLDOWN_SEC) {
    return { success: false, reason: 'cooldown', code: null };
  }

  // 🔢 4-digit OTP
  const code = Math.floor(1000 + Math.random() * 9000).toString();

  await redis.set(key, JSON.stringify({ code, attempts: 0 }), 'EX', OTP_EXPIRY_MINUTES * 60);

  return { success: true, code, reason: null };
};

export const verifyOtp = async (
  identifier: string,
  purpose: 'signup' | 'login' | 'reset_password',
  code: string,
  method: string,
) => {
  const isOtpDebugMode = process.env.NODE_ENV === 'staging' || process.env.DISABLE_REAL_OTP === 'true';
  const useTwilioVerify = !isOtpDebugMode && process.env.OTP_ENGINE === 'twilio_verify' && method === 'phone';
  if (useTwilioVerify) {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const check = await client.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID as string).verificationChecks.create({
        to: identifier,
        code,
      });
      if (check.status === 'approved') return { success: true };
      return { success: false, reason: 'invalid_otp' };
    } catch (err: any) {
      if (err.status === 404) return { success: false, reason: 'expired' };
      if (err.status === 429) return { success: false, reason: 'too_many_attempts' };
      return { success: false, reason: 'invalid_otp' };
    }
  }


  const key = otpKey(identifier, purpose, method);
  const data = await redis.get(key);

  if (!data) return { success: false, reason: 'expired' };

  const parsed = JSON.parse(data);

  if (parsed.attempts >= OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    return { success: false, reason: 'too_many_attempts' };
  }

  if (parsed.code !== code) {
    parsed.attempts += 1;
    await redis.set(key, JSON.stringify(parsed), 'KEEPTTL');
    return { success: false, reason: 'invalid_otp' };
  }

  await redis.del(key);
  return { success: true };
};

export const resendOtp = async (
  identifier: string,
  purpose: 'signup' | 'login' | 'reset_password',
  method: string,
) => {
  const isOtpDebugMode = process.env.NODE_ENV === 'staging' || process.env.DISABLE_REAL_OTP === 'true';
  const useTwilioVerify = !isOtpDebugMode && process.env.OTP_ENGINE === 'twilio_verify' && method === 'phone';
  if (useTwilioVerify) {
    const otp = await createOtp(identifier, purpose, method);
    return { success: true, otp: otp.code, reused: false };
  }


  const key = otpKey(identifier, purpose, method);
  const ttl = await redis.ttl(key);

  // No OTP exists → create fresh
  if (ttl <= 0) {
    const otp = await createOtp(identifier, purpose, method);
    return { success: true, otp: otp.code, reused: false };
  }

  // Cooldown still active
  if (ttl > OTP_EXPIRY_MINUTES * 60 - OTP_RESEND_COOLDOWN_SEC) {
    return { success: false, reason: 'cooldown' };
  }

  // Reuse existing OTP
  const data = await redis.get(key);
  if (!data) {
    const otp = await createOtp(identifier, purpose, method);
    return { success: true, otp: otp.code, reused: false };
  }

  const parsed = JSON.parse(data);

  return {
    success: true,
    otp: parsed.code,
    reused: true,
  };
};
