import { parsePhoneNumberFromString } from 'libphonenumber-js';
import redis from '../../cache/redis.js';
import logger from '../../utils/logger.js';
import { sendMail } from '../mail/mail.service.js';
import { loadSmsAbuseConfig, maskPhoneNumber } from './sms.config.js';

export type SmsAllowResult = { ok: true } | { ok: false; error: string };

const PER_PHONE_TTL_SEC = 60 * 60 * 48; // 48h — key is date-scoped, TTL just reaps it
const DAILY_TTL_SEC = 60 * 60 * 48;
const MONTHLY_TTL_SEC = 60 * 60 * 24 * 40; // ~40 days

const dayId = (now: Date): string => now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
const monthId = (now: Date): string => now.toISOString().slice(0, 7).replace('-', ''); // YYYYMM

/** Increment a counter and set its TTL on first write. Returns the new value. */
const bumpCounter = async (key: string, ttlSec: number): Promise<number> => {
  const value = await redis.incr(key);
  if (value === 1) {
    await redis.expire(key, ttlSec);
  }
  return value;
};

/** Fire a spend-cap alert at most once per window using a Redis NX flag. */
const alertSpendCapOnce = async (
  scope: 'daily' | 'monthly',
  windowId: string,
  count: number,
  cap: number,
  ttlSec: number,
  adminAlertEmail?: string,
): Promise<void> => {
  const flagKey = `sms:spend:alerted:${scope}:${windowId}`;
  const acquired = await redis.set(flagKey, '1', 'EX', ttlSec, 'NX');
  if (acquired !== 'OK') {
    return; // already alerted this window
  }

  logger.error('[SMS] Spend cap breached — SMS sending halted', {
    scope,
    windowId,
    count,
    cap,
  });

  if (!adminAlertEmail) {
    return;
  }

  try {
    await sendMail({
      to: adminAlertEmail,
      subject: `[Deliivo] SMS ${scope} spend cap reached`,
      html: `<p>The <strong>${scope}</strong> SMS spend cap of <strong>${cap}</strong> has been reached for window <strong>${windowId}</strong> (count ${count}). Outgoing OTP SMS are now blocked until the window resets.</p>`,
      text: `The ${scope} SMS spend cap of ${cap} was reached for window ${windowId} (count ${count}). Outgoing OTP SMS are now blocked until the window resets.`,
    });
  } catch (error) {
    logger.error('[SMS] Failed to send spend-cap alert email', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

/**
 * Application-level SMS abuse gate, checked once per accepted OTP send.
 * Order: country allowlist → per-phone daily cap → global daily/monthly spend cap.
 * Counters increment as a side effect so repeated blocked attempts stay blocked.
 */
export const assertSmsAllowed = async (to: string): Promise<SmsAllowResult> => {
  const config = loadSmsAbuseConfig();

  // 1. Country allowlist — reject before spending any counter budget.
  if (config.allowedCountryCodes.length > 0) {
    const parsed = parsePhoneNumberFromString(to);
    const callingCode = parsed?.countryCallingCode;
    if (!callingCode || !config.allowedCountryCodes.includes(callingCode)) {
      return {
        ok: false,
        error: 'SMS to this country is not supported',
      };
    }
  }

  const now = new Date();

  // 2. Per-phone daily cap.
  const perPhoneCount = await bumpCounter(`sms:phone:${dayId(now)}:${to}`, PER_PHONE_TTL_SEC);
  if (perPhoneCount > config.perPhoneDailyMax) {
    logger.warn('[SMS] Per-phone daily cap exceeded', {
      to: maskPhoneNumber(to),
      count: perPhoneCount,
      cap: config.perPhoneDailyMax,
    });
    return {
      ok: false,
      error: 'Too many OTP requests for this number today. Try again later.',
    };
  }

  // 3. Global spend circuit breaker (daily + monthly).
  if (config.dailySpendCap !== null) {
    const day = dayId(now);
    const dailyCount = await bumpCounter(`sms:spend:${day}`, DAILY_TTL_SEC);
    if (dailyCount > config.dailySpendCap) {
      await alertSpendCapOnce('daily', day, dailyCount, config.dailySpendCap, DAILY_TTL_SEC, config.adminAlertEmail);
      return { ok: false, error: 'SMS temporarily unavailable. Please try again later.' };
    }
  }

  if (config.monthlySpendCap !== null) {
    const month = monthId(now);
    const monthlyCount = await bumpCounter(`sms:spend:${month}`, MONTHLY_TTL_SEC);
    if (monthlyCount > config.monthlySpendCap) {
      await alertSpendCapOnce('monthly', month, monthlyCount, config.monthlySpendCap, MONTHLY_TTL_SEC, config.adminAlertEmail);
      return { ok: false, error: 'SMS temporarily unavailable. Please try again later.' };
    }
  }

  return { ok: true };
};
