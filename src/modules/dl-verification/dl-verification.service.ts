import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../../config/index.js';
import { logError, logWarn, logDebug } from '../../utils/logger.js';
import { matchIdentity } from '../../utils/nameMatch.js';
import type { DlVerificationStatus } from '@prisma/client';

const VERIFF_BASE_URL = process.env.VERIFF_BASE_URL || 'https://stationapi.veriff.com/v1';
const VERIFF_API_KEY = process.env.VERIFF_API_KEY || '';
const VERIFF_SHARED_SECRET = process.env.VERIFF_SHARED_SECRET || '';
const VERIFF_CALLBACK_URL = process.env.VERIFF_CALLBACK_URL || '';

interface CreateVeriffSessionOptions {
  userId: string;
  firstName: string;
  lastName: string;
  email?: string;
  phoneNumber?: string;
  dateOfBirth?: string; // Format: YYYY-MM-DD
  gender?: 'M' | 'MALE' | 'F' | 'FEMALE';
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
    dateOfBirth,
    gender,
    idNumber,
    fullName,
    documentNumber,
    documentCountry = 'IN',
    documentValidFrom,
    documentValidUntil,
    fullAddress,
    callback,
    endUserId,
    consents,
    tag,
  } = options;

  // Check if user already has an approved verification
  const existing = await prisma.dlVerification.findFirst({
    where: { userId, status: 'APPROVED' },
  });

  if (existing) {
    return { success: false, reason: 'ALREADY_VERIFIED' };
  }

  const payload: any = {
    verification: {
      callback: callback || VERIFF_CALLBACK_URL,
      person: {
        firstName,
        lastName,
        ...(idNumber && { idNumber }),
        ...(phoneNumber && { phoneNumber }),
        ...(gender && { gender }),
        ...(dateOfBirth && { dateOfBirth }),
        ...(email && { email }),
        ...(fullName && { fullName }),
      },
      document: {
        type: 'DRIVERS_LICENSE',
        country: documentCountry,
        ...(documentNumber && { number: documentNumber }),
        ...(documentValidFrom && { validFrom: documentValidFrom }),
        ...(documentValidUntil && { validUntil: documentValidUntil }),
      },
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

// ─── Validate HMAC-SHA256 webhook signature ────────────────────────
export const validateWebhookSignature = (
  payload: string,
  signature: string,
): boolean => {
  const expectedSignature = crypto
    .createHmac('sha256', VERIFF_SHARED_SECRET)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex'),
  );
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

// ─── Handle webhook decision from Veriff ───────────────────────────
export const handleWebhookDecision = async (body: any) => {
  const { verification } = body;

  if (!verification || !verification.id) {
    return { success: false, reason: 'INVALID_PAYLOAD' };
  }

  const sessionId = verification.id;
  const status = verification.status; // approved | declined | resubmission_requested | expired
  const code = verification.code;
  const reasonCode = verification.reasonCode;

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

  if (!record) {
    logWarn('Veriff webhook: no record found', { sessionId });
    return { success: false, reason: 'SESSION_NOT_FOUND' };
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
    where: { id: record.userId },
    select: { name: true, dob: true, gender: true },
  });

  const match =
    mappedStatus === 'APPROVED'
      ? matchIdentity(
          { name: driver?.name, dob: driver?.dob, gender: driver?.gender },
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
      status: finalStatus,
      decisionCode: code ? Number(code) : null,
      reasonCode: reasonCode || null,
      decisionPayload: body,
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
      where: { id: record.userId },
      data: { dlVerified: true },
    });
  } else if (mappedStatus === 'APPROVED') {
    logWarn('Veriff webhook: DL approved but identity mismatch — verification withheld', {
      sessionId,
      userId: record.userId,
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
