import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../../config/index.js';
import { logError, logWarn, logDebug } from '../../utils/logger.js';
import { exactNamesMatch, matchIdentityStrict, normalizeGender } from '../../utils/nameMatch.js';
import type { DlVerificationStatus, Prisma } from '@prisma/client';

const VERIFF_BASE_URL = process.env.VERIFF_BASE_URL || 'https://stationapi.veriff.com/v1';
const VERIFF_API_KEY = process.env.VERIFF_API_KEY || '';
const VERIFF_SHARED_SECRET = process.env.VERIFF_SHARED_SECRET || '';
const VERIFF_CALLBACK_URL = process.env.VERIFF_CALLBACK_URL || '';

// Veriff only accepts HTTPS return URLs (API error 1302). Drop anything else
// instead of letting the session-create call fail with a 400.
const resolveCallbackUrl = (requested?: string): string | undefined => {
  for (const candidate of [requested, VERIFF_CALLBACK_URL]) {
    if (!candidate) continue;
    if (candidate.startsWith('https://')) return candidate;
    logWarn('Ignoring non-HTTPS Veriff callback URL', { callback: candidate });
  }
  return undefined;
};

interface CreateVeriffSessionOptions {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
  // dateOfBirth and gender are deliberately absent: they come from the profile, which
  // is what the webhook enforces the document against.
  idNumber?: string;
  fullName?: string;
  documentNumber?: string;
  documentCountry?: string; // ISO 3166-1 Alpha-2
  documentValidFrom?: string; // Format: YYYY-MM-DD
  documentValidUntil?: string; // Format: YYYY-MM-DD
  fullAddress?: string;
  callback?: string;
  endUserId?: string; // UUID
  consents?: Array<{
    type: 'ine' | 'bipa' | 'aadhaar' | 'general' | 'dvs';
    approved: boolean;
  }>;
  tag?: string; // Max 64 characters
}

// A driver who is already approved must not open a second session, whichever side
// creates it.
const hasApprovedVerification = async (userId: string): Promise<boolean> => {
  const existing = await prisma.dlVerification.findFirst({
    where: { userId, status: 'APPROVED' },
    select: { id: true },
  });
  return existing !== null;
};

// ─── Create a Veriff session for DL verification ───────────────────
export const createVeriffSession = async (
  options: CreateVeriffSessionOptions
) => {
  const {
    userId,
    firstName,
    lastName,
    email,
    phoneNumber,
    idNumber,
    fullName,
    documentNumber,
    documentCountry,
    documentValidFrom,
    documentValidUntil,
    fullAddress,
    callback,
    endUserId,
    consents,
    tag,
  } = options;

  if (await hasApprovedVerification(userId)) {
    return { success: false, reason: 'ALREADY_VERIFIED' };
  }

  const callbackUrl = resolveCallbackUrl(callback);

  const profile = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, dob: true, gender: true, email: true, phone: true },
  });

  // The webhook requires an exact name + DOB + gender match before it will verify
  // anyone, so a profile missing any of those can never pass. Fail here instead of
  // spending a Veriff check on a decision that is guaranteed to be withheld.
  const profileName = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  const profileDob = profile?.dob ? profile.dob.toISOString().slice(0, 10) : null;
  const profileGender = normalizeGender(profile?.gender);

  if (!profileName || !profile?.firstName || !profile?.lastName || !profileDob || !profileGender) {
    logWarn('Veriff createSession blocked: profile incomplete for KYC', {
      userId,
      hasFirstName: Boolean(profile?.firstName),
      hasLastName: Boolean(profile?.lastName),
      hasDob: Boolean(profileDob),
      comparableGender: Boolean(profileGender),
    });
    return { success: false, reason: 'PROFILE_INCOMPLETE' };
  }

  // A caller verifies their own identity. A name that differs from the profile is a
  // guaranteed IDENTITY_MISMATCH on the webhook, so reject it up front.
  if (!exactNamesMatch(`${firstName} ${lastName}`, profileName)) {
    logWarn('Veriff createSession blocked: submitted name does not match the profile', { userId });
    return { success: false, reason: 'NAME_DOES_NOT_MATCH_PROFILE' };
  }

  const resolvedEmail = email ?? profile.email ?? undefined;
  const resolvedPhoneNumber = phoneNumber ?? profile.phone ?? undefined;

  const payload: any = {
    verification: {
      ...(callbackUrl && { callback: callbackUrl }),
      person: {
        firstName,
        lastName,
        // Sent from the profile, not the body: these are the exact values the webhook
        // will enforce, so Veriff compares the document against the same identity.
        dateOfBirth: profileDob,
        gender: profileGender === 'MALE' ? 'M' : 'F',
        ...(idNumber && { idNumber }),
        ...(resolvedPhoneNumber && { phoneNumber: resolvedPhoneNumber }),
        ...(resolvedEmail && { email: resolvedEmail }),
        ...(fullName && { fullName }),
      },
      // Only pinned when the caller actually knows the document. Veriff has nothing to
      // render for a type/country combination the integration does not support, and the
      // flow then loads as a blank frame rather than reporting an error — so a guessed
      // country is worse than none. Left out, the driver picks their own document, which
      // is also the only thing that works for a licence issued anywhere.
      ...((documentCountry || documentNumber || documentValidFrom || documentValidUntil) && {
        document: {
          type: 'DRIVERS_LICENSE',
          ...(documentCountry && { country: documentCountry }),
          ...(documentNumber && { number: documentNumber }),
          ...(documentValidFrom && { validFrom: documentValidFrom }),
          ...(documentValidUntil && { validUntil: documentValidUntil }),
        },
      }),
      ...(fullAddress && {
        address: {
          fullAddress,
        },
      }),
      vendorData: userId,
      ...(endUserId && { endUserId }),
      ...(consents && consents.length > 0 && { consents }),
      ...(tag && { tag }),
    },
  };
  try {
    const payloadString = JSON.stringify(payload);
    const signature = crypto
      .createHmac('sha256', VERIFF_SHARED_SECRET)
      .update(payloadString)
      .digest('hex');

    const response = await axios.post(`${VERIFF_BASE_URL}/sessions`, payloadString, {
      headers: {
        'X-AUTH-CLIENT': VERIFF_API_KEY,
        'X-HMAC-SIGNATURE': signature,
        'Content-Type': 'application/json',
      },
    });

    const { id: sessionId, url: sessionUrl } = response.data.verification;

    // Save session in DB
    const record = await prisma.dlVerification.create({
      data: {
        userId,
        veriffSessionId: sessionId,
        veriffSessionUrl: sessionUrl,
        status: 'PENDING',
      },
    });

    return {
      success: true,
      data: {
        verificationId: record.id,
        sessionId,
        sessionUrl,
      },
    };
  } catch (error: any) {
    logError('Veriff createSession error', error, { detail: error?.response?.data });
    return {
      success: false,
      reason: 'VERIFF_API_ERROR',
      detail: error?.response?.data?.message || error.message,
    };
  }
};

interface RegisterVeriffSessionOptions {
  userId: string;
  sessionId: string;
  sessionUrl: string;
}

interface RegisterVeriffSessionResult {
  success: boolean;
  reason?: string;
  data?: {
    verificationId: string;
    sessionId: string;
    sessionUrl: string;
  };
}

// Prisma throws a tagged error object rather than a typed class we can narrow on,
// so the unique-constraint code is read defensively.
const isUniqueConstraintError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === 'P2002';

// ─── Attach a browser-created Veriff session to its user ───────────
// The js-sdk creates the session client-side, so the backend never sees the id
// until the browser reports it. Without this row the decision webhook has nothing
// to attach the outcome to.
export const registerVeriffSession = async (
  options: RegisterVeriffSessionOptions
): Promise<RegisterVeriffSessionResult> => {
  const { userId, sessionId, sessionUrl } = options;

  if (await hasApprovedVerification(userId)) {
    return { success: false, reason: 'ALREADY_VERIFIED' };
  }

  const existing = await prisma.dlVerification.findUnique({
    where: { veriffSessionId: sessionId },
  });

  if (existing) {
    if (existing.userId !== userId) {
      logWarn('Veriff register: session already owned by another user', {
        sessionId,
        userId,
        ownerId: existing.userId,
      });
      return { success: false, reason: 'SESSION_OWNED_BY_ANOTHER_USER' };
    }
    // Idempotent: the browser may retry the same session.
    return {
      success: true,
      data: {
        verificationId: existing.id,
        sessionId: existing.veriffSessionId,
        sessionUrl: existing.veriffSessionUrl,
      },
    };
  }

  try {
    const record = await prisma.dlVerification.create({
      data: {
        userId,
        veriffSessionId: sessionId,
        veriffSessionUrl: sessionUrl,
        status: 'PENDING',
      },
    });

    return {
      success: true,
      data: {
        verificationId: record.id,
        sessionId: record.veriffSessionId,
        sessionUrl: record.veriffSessionUrl,
      },
    };
  } catch (error: unknown) {
    // Two concurrent registrations of the same session: re-read instead of 500ing.
    if (isUniqueConstraintError(error)) {
      const raced = await prisma.dlVerification.findUnique({
        where: { veriffSessionId: sessionId },
      });
      if (raced && raced.userId === userId) {
        return {
          success: true,
          data: {
            verificationId: raced.id,
            sessionId: raced.veriffSessionId,
            sessionUrl: raced.veriffSessionUrl,
          },
        };
      }
      return { success: false, reason: 'SESSION_OWNED_BY_ANOTHER_USER' };
    }
    logError('Veriff registerSession error', error);
    return { success: false, reason: 'REGISTER_FAILED' };
  }
};

// Veriff signs with HMAC-SHA256, so the header is always 64 hex characters.
const HEX_SHA256 = /^[0-9a-f]{64}$/i;

/**
 * Fails startup when the webhook secret is missing. Without it every HMAC would be
 * computed with an empty key, which anyone can reproduce — a forged decision webhook
 * would then be enough to self-approve a driving licence.
 */
export const assertVeriffWebhookConfigured = (): void => {
  if (VERIFF_SHARED_SECRET) return;
  const message =
    'VERIFF_SHARED_SECRET is not set; the Veriff decision webhook cannot be authenticated.';
  if (process.env.NODE_ENV === 'production') {
    throw new Error(message);
  }
  logWarn(`${message} Webhook decisions will be rejected.`);
};

// ─── Validate HMAC-SHA256 webhook signature ────────────────────────
// `payload` must be the exact bytes Veriff sent: re-serialising the parsed body
// changes whitespace and escaping, which changes the digest.
export const validateWebhookSignature = (
  payload: string | Buffer,
  signature: string,
): boolean => {
  // Fail closed rather than validating everything against an empty-key HMAC.
  if (!VERIFF_SHARED_SECRET) {
    logError('Veriff webhook rejected: VERIFF_SHARED_SECRET is not configured');
    return false;
  }

  // Buffer.from() silently truncates malformed hex, so an odd or non-hex header
  // must be rejected before it can be compared against a shortened digest.
  if (typeof signature !== 'string' || !HEX_SHA256.test(signature)) {
    return false;
  }

  const expected = crypto
    .createHmac('sha256', VERIFF_SHARED_SECRET)
    .update(payload)
    .digest();
  const provided = Buffer.from(signature, 'hex');

  // timingSafeEqual throws on a length mismatch; the regex above makes that
  // unreachable, but the guard keeps it from ever becoming a 500.
  if (provided.length !== expected.length) return false;

  return crypto.timingSafeEqual(provided, expected);
};

/**
 * Veriff person fields may arrive as a plain string or as `{ value }`.
 * Returns the trimmed string value, or empty string when absent.
 */
const extractVeriffField = (field: unknown): string => {
  if (typeof field === 'string') return field.trim();
  if (field && typeof field === 'object' && 'value' in field) {
    const value = (field as { value: unknown }).value;
    return typeof value === 'string' ? value.trim() : '';
  }
  return '';
};

interface VeriffWebhookVerification {
  id?: unknown;
  status?: unknown;
  code?: unknown;
  reasonCode?: unknown;
  vendorData?: unknown;
  person?: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// ─── Handle webhook decision from Veriff ───────────────────────────
export const handleWebhookDecision = async (body: unknown) => {
  const verification: VeriffWebhookVerification | null =
    isRecord(body) && isRecord(body.verification) ? body.verification : null;

  if (!verification || typeof verification.id !== 'string' || !verification.id) {
    return { success: false, reason: 'INVALID_PAYLOAD' };
  }

  const sessionId = verification.id;
  const status = typeof verification.status === 'string' ? verification.status : ''; // approved | declined | resubmission_requested | expired
  const code = verification.code;
  const reasonCode = typeof verification.reasonCode === 'string' ? verification.reasonCode : null;

  // Map Veriff status to our enum
  const statusMap: Record<string, string> = {
    approved: 'APPROVED',
    declined: 'DECLINED',
    resubmission_requested: 'RESUBMISSION_REQUESTED',
    expired: 'EXPIRED',
  };

  const mappedStatus = statusMap[status] || 'DECLINED';

  // Find and update the verification record
  const record = await prisma.dlVerification.findUnique({
    where: { veriffSessionId: sessionId },
  });

  // vendorData is the user id we pass at session creation. Veriff sets it and echoes
  // it back untouched, so when it disagrees with the stored row it is the authority:
  // a client can register an arbitrary session id through the API, but it cannot
  // choose what vendorData a session carries.
  //
  // That holds because the web app renders a backend-created session (createVeriffSession
  // sets vendorData itself). A session created client-side and attached through
  // registerVeriffSession carries whatever vendorData that client chose — but claiming
  // another user there only misroutes the decision onto that user's record, where the
  // identity check below still refuses to verify anyone whose document does not match.
  const vendorData =
    typeof verification.vendorData === 'string' ? verification.vendorData.trim() : '';
  const vendorUser = vendorData
    ? await prisma.user.findUnique({ where: { id: vendorData }, select: { id: true } })
    : null;

  const userId = vendorUser?.id ?? record?.userId;

  if (!userId) {
    logWarn('Veriff webhook: no record found', { sessionId, vendorData });
    return { success: false, reason: 'SESSION_NOT_FOUND' };
  }

  if (record && vendorUser && record.userId !== vendorUser.id) {
    logWarn('Veriff webhook: vendorData disagrees with stored record — trusting vendorData', {
      sessionId,
      recordUserId: record.userId,
      vendorUserId: vendorUser.id,
    });
  }

  if (!record) {
    // A session created in the browser that was never registered. veriffSessionUrl is
    // required and non-nullable; the real URL is gone by now, so it stays empty.
    await prisma.dlVerification.create({
      data: {
        userId,
        veriffSessionId: sessionId,
        veriffSessionUrl: '',
        status: 'PENDING',
      },
    });
  }

  // Extract the verified person's identity (name, DOB, gender) and compare it to
  // the entered profile — a matching identity is required before we trust the DL.
  const person = verification.person ?? {};
  const firstName = extractVeriffField(person.firstName);
  const lastName = extractVeriffField(person.lastName);
  const verifiedName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
  const verifiedDob = extractVeriffField(person.dateOfBirth) || null;
  const verifiedGender = extractVeriffField(person.gender) || null;

  const driver = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, dob: true, gender: true },
  });

  // The profile stores the given and family name separately; Veriff returns them
  // the same way, so both sides are compared as one joined full name.
  const driverName = [driver?.firstName, driver?.lastName].filter(Boolean).join(' ').trim() || null;

  const match =
    mappedStatus === 'APPROVED'
      ? matchIdentityStrict(
          { name: driverName, dob: driver?.dob, gender: driver?.gender },
          { name: verifiedName, dob: verifiedDob, gender: verifiedGender },
        )
      : null;
  const approvedAndMatched = mappedStatus === 'APPROVED' && match?.overall === true;

  // Hard block: an approved decision whose identity does not match is flagged
  // IDENTITY_MISMATCH and does NOT verify the user.
  const finalStatus: DlVerificationStatus =
    mappedStatus === 'APPROVED' && !approvedAndMatched
      ? 'IDENTITY_MISMATCH'
      : (mappedStatus as DlVerificationStatus);

  // Update verification record
  await prisma.dlVerification.update({
    where: { veriffSessionId: sessionId },
    data: {
      // Corrects ownership when vendorData disagreed with what was registered.
      userId,
      status: finalStatus,
      decisionCode:
        typeof code === 'number' || typeof code === 'string' ? Number(code) : null,
      reasonCode,
      decisionPayload: body as Prisma.InputJsonValue,
      verifiedName,
      verifiedDob,
      verifiedGender,
      nameMatch: match?.nameMatch ?? null,
      dobMatch: match?.dobMatch ?? null,
      genderMatch: match?.genderMatch ?? null,
    },
  });

  // Only mark the user DL-verified when approved AND the identity matches.
  if (approvedAndMatched) {
    await prisma.user.update({
      where: { id: userId },
      data: { dlVerified: true },
    });
  } else if (mappedStatus === 'APPROVED') {
    logWarn('Veriff webhook: DL approved but identity mismatch — verification withheld', {
      sessionId,
      userId,
      nameMatch: match?.nameMatch,
      dobMatch: match?.dobMatch,
      genderMatch: match?.genderMatch,
    });
  }

  return { success: true, status: finalStatus };
};

// ─── Get DL verification status for a user ─────────────────────────
export const getVerificationStatus = async (userId: string) => {
  const records = await prisma.dlVerification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 1,
  });

  if (records.length === 0) {
    return { success: true, data: { status: 'NOT_STARTED', record: null } };
  }

  const latest = records[0];

  return {
    success: true,
    data: {
      status: latest.status,
      verificationId: latest.id,
      sessionId: latest.veriffSessionId,
      sessionUrl: latest.veriffSessionUrl,
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
    },
  };
};
