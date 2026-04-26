import axios from 'axios';
import crypto from 'crypto';
import { prisma } from '../../config/index.js';

const VERIFF_BASE_URL = process.env.VERIFF_BASE_URL || 'https://stationapi.veriff.com/v1';
const VERIFF_API_KEY = process.env.VERIFF_API_KEY || '';
const VERIFF_SHARED_SECRET = process.env.VERIFF_SHARED_SECRET || '';
const VERIFF_CALLBACK_URL = process.env.VERIFF_CALLBACK_URL || '';

// ─── Create a Veriff session for DL verification ───────────────────
export const createVeriffSession = async (
  userId: string,
  firstName: string,
  lastName: string,
) => {
  // Check if user already has an approved verification
  const existing = await prisma.dlVerification.findFirst({
    where: { userId, status: 'APPROVED' },
  });

  if (existing) {
    return { success: false, reason: 'ALREADY_VERIFIED' };
  }

  const payload = {
    verification: {
      callback: VERIFF_CALLBACK_URL,
      person: {
        firstName,
        lastName,
      },
      document: {
        type: 'DRIVERS_LICENSE',
        country: 'GB',
      },
      vendorData: userId,
    },
    timestamp: new Date().toISOString(),
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
    console.error('Veriff createSession error:', error?.response?.data || error.message);
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
    console.warn(`Veriff webhook: no record found for session ${sessionId}`);
    return { success: false, reason: 'SESSION_NOT_FOUND' };
  }

  // Update verification record
  await prisma.dlVerification.update({
    where: { veriffSessionId: sessionId },
    data: {
      status: mappedStatus as any,
      decisionCode: code ? Number(code) : null,
      reasonCode: reasonCode || null,
      decisionPayload: body,
    },
  });

  // If approved, mark user as DL-verified
  if (mappedStatus === 'APPROVED') {
    await prisma.user.update({
      where: { id: record.userId },
      data: { dlVerified: true },
    });
  }

  return { success: true, status: mappedStatus };
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
