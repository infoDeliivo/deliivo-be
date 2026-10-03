import redis from '../../cache/redis.js';
import { prisma } from '../../config/index.js';
import { createOtp, verifyOtp } from '../otp/otp.service.js';
import { OTP_EXPIRY_MINUTES } from '../otp/otp.constants.js';
import type {
  ContactMethod,
  ContactChangeError,
  ContactChangeResult,
  ContactRequestData,
} from './user.types.js';

const CONTACT_OTP_PURPOSE = 'contact_change' as const;

/** Same normalisation as auth signup/login, so a stored contact is always found at login. */
export const normalizeContact = (method: ContactMethod, identifier: string): string =>
  method === 'email' ? identifier.trim().toLowerCase() : identifier.trim();

/**
 * The OTP key is keyed by identifier only (Twilio Verify needs the raw number), so this pending
 * record is what binds a code to the user who asked for it.
 */
const pendingKey = (userId: string, method: ContactMethod) => `contact_change:pending:${userId}:${method}`;

const contactWhere = (method: ContactMethod, identifier: string) =>
  method === 'email'
    ? { email: { equals: identifier, mode: 'insensitive' as const } }
    : { phone: identifier };

const fail = (error: ContactChangeError): { success: false; error: ContactChangeError } => ({
  success: false,
  error,
});

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';

/**
 * Start adding or replacing the user's email/phone: checks the value is free, issues an OTP to it
 * and remembers which value this user is verifying. The caller delivers the code.
 */
export const requestContactChangeService = async (
  userId: string,
  method: ContactMethod,
  rawIdentifier: string,
): Promise<ContactChangeResult<ContactRequestData>> => {
  const identifier = normalizeContact(method, rawIdentifier);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, phone: true, emailVerified: true, phoneVerified: true },
  });
  if (!user) return fail('USER_NOT_FOUND');

  const current = method === 'email' ? user.email : user.phone;
  const currentVerified = method === 'email' ? user.emailVerified : user.phoneVerified;
  if (current && currentVerified && normalizeContact(method, current) === identifier) {
    return fail('CONTACT_UNCHANGED');
  }

  const owner = await prisma.user.findFirst({
    where: { ...contactWhere(method, identifier), id: { not: userId }, isVerified: true },
    select: { id: true },
  });
  if (owner) return fail('CONTACT_IN_USE');

  const otp = await createOtp(identifier, CONTACT_OTP_PURPOSE, method);
  if (!otp.success || !otp.code) {
    return fail(otp.reason === 'cooldown' ? 'OTP_COOLDOWN' : 'OTP_FAILED');
  }

  await redis.set(pendingKey(userId, method), identifier, 'EX', OTP_EXPIRY_MINUTES * 60);

  return { success: true, data: { identifier, code: otp.code } };
};

/**
 * Finish the change: the code must match the value this user requested. On success the value is
 * stored as verified; an unverified signup leftover holding the same value is released.
 */
export const verifyContactChangeService = async (
  userId: string,
  method: ContactMethod,
  rawIdentifier: string,
  code: string,
): Promise<ContactChangeResult<{ identifier: string }>> => {
  const identifier = normalizeContact(method, rawIdentifier);
  const key = pendingKey(userId, method);

  const pending = await redis.get(key);
  if (pending !== identifier) return fail('NO_PENDING_CHANGE');

  const check = await verifyOtp(identifier, CONTACT_OTP_PURPOSE, code, method);
  if (!check.success) {
    if (check.reason === 'expired') return fail('OTP_EXPIRED');
    if (check.reason === 'too_many_attempts') return fail('OTP_TOO_MANY_ATTEMPTS');
    return fail('OTP_INVALID');
  }

  try {
    await prisma.$transaction(async (tx) => {
      const owner = await tx.user.findFirst({
        where: { ...contactWhere(method, identifier), id: { not: userId }, isVerified: true },
        select: { id: true },
      });
      if (owner) throw new Error('CONTACT_IN_USE');

      await tx.user.updateMany({
        where: { ...contactWhere(method, identifier), id: { not: userId }, isVerified: false },
        data: method === 'email' ? { email: null } : { phone: null },
      });

      await tx.user.update({
        where: { id: userId },
        data:
          method === 'email'
            ? { email: identifier, emailVerified: true }
            : { phone: identifier, phoneVerified: true },
      });
    });
  } catch (error) {
    if ((error instanceof Error && error.message === 'CONTACT_IN_USE') || isUniqueViolation(error)) {
      await redis.del(key);
      return fail('CONTACT_IN_USE');
    }
    throw error;
  }

  await redis.del(key);
  return { success: true, data: { identifier } };
};
