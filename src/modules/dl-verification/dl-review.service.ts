import { prisma } from '../../config/index.js';
import { logWarn } from '../../utils/logger.js';
import type { DlVerificationStatus, Prisma } from '@prisma/client';

/**
 * Manual driving-licence review.
 *
 * Veriff is the primary path: a driver completes a document scan and a webhook
 * decides. A driver who cannot or will not finish that flow may instead upload a
 * photo of their licence for an admin to read. Both paths land on the same
 * `DlVerification` table and the same `user.dlVerified` flag, so every downstream
 * gate (publishing a ride, accepting a booking) is unchanged.
 *
 * The manual row is keyed on a deterministic session id — one row per user, updated
 * in place across re-submissions, rather than a new row per attempt.
 */

/** Deterministic key for a user's manual review row. */
export const manualSessionId = (userId: string): string => `manual:${userId}`;

const manualSessionUrl = (userId: string): string => `https://manual-review.local/dl/${userId}`;

const payload = (
  action: string,
  extra: Record<string, string | null> = {},
): Prisma.InputJsonValue => ({
  source: 'MANUAL_REVIEW',
  action,
  at: new Date().toISOString(),
  ...extra,
});

/**
 * True when the user has a licence image on file — in any state. Used by the vehicle
 * gate: a driver uploads their licence once, not once per vehicle.
 */
export const hasDlDocumentOnFile = async (userId: string): Promise<boolean> => {
  const existing = await prisma.dlVerification.findFirst({
    where: { userId, documentImageKey: { not: null } },
    select: { id: true },
  });
  return existing !== null;
};

/**
 * Driver submits (or replaces) their licence image. The row goes back to PENDING so a
 * re-upload after a decline re-enters the queue, and any prior decline reason is
 * cleared so the driver is not shown a stale rejection.
 *
 * An already-approved user is refused: re-uploading would silently drop them out of
 * verified state, and there is no product reason to replace a licence that passed.
 */
export const submitDlDocument = async (userId: string, documentImageKey: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, dlVerified: true },
  });

  if (!user) throw new Error('USER_NOT_FOUND');
  if (user.dlVerified) throw new Error('ALREADY_VERIFIED');

  const veriffSessionId = manualSessionId(userId);

  const fields = {
    status: 'PENDING' as DlVerificationStatus,
    documentImageKey,
    declineReason: null,
    reviewedById: null,
    reviewedAt: null,
    decisionPayload: payload('SUBMITTED'),
  };

  return prisma.dlVerification.upsert({
    where: { veriffSessionId },
    create: {
      userId,
      veriffSessionId,
      veriffSessionUrl: manualSessionUrl(userId),
      ...fields,
    },
    update: fields,
  });
};

export interface DlReviewQueueQuery {
  status?: DlVerificationStatus;
  page?: number;
  limit?: number;
}

/**
 * The admin review queue. Only rows carrying an uploaded image are listed — a Veriff
 * row has nothing for an admin to look at. Oldest first, so the list arrives in the
 * order it should be worked.
 *
 * `documentImageKey` is returned as `previewKey`: it is a private S3 key, and the
 * caller exchanges it for a short-lived signed URL via GET /uploads/read.
 */
export const listDlReviewQueue = async (query: DlReviewQueueQuery = {}) => {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(100, Math.max(1, query.limit ?? 20));

  const where: Prisma.DlVerificationWhereInput = {
    documentImageKey: { not: null },
    ...(query.status ? { status: query.status } : {}),
  };

  const [rows, total] = await prisma.$transaction([
    prisma.dlVerification.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        userId: true,
        status: true,
        documentImageKey: true,
        declineReason: true,
        reviewedAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            dob: true,
            dlVerified: true,
          },
        },
      },
    }),
    prisma.dlVerification.count({ where }),
  ]);

  return {
    submissions: rows.map(({ documentImageKey, ...row }) => ({
      ...row,
      previewKey: documentImageKey,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
};

/** Loads the manual row an admin decision applies to, or throws. */
const loadPendingRow = async (userId: string) => {
  const row = await prisma.dlVerification.findUnique({
    where: { veriffSessionId: manualSessionId(userId) },
    select: { id: true, documentImageKey: true },
  });

  if (!row) throw new Error('DL_SUBMISSION_NOT_FOUND');
  if (!row.documentImageKey) throw new Error('DL_DOCUMENT_MISSING');

  return row;
};

/**
 * Admin approves the licence. Mirrors what a passing Veriff decision writes: the row
 * goes APPROVED and the user becomes DL-verified. The match flags are set true
 * because a human read the document against the profile — that IS the identity check
 * on this path.
 */
export const approveDlDocument = async (userId: string, adminId: string | null) => {
  await loadPendingRow(userId);

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { firstName: true, lastName: true, dob: true, gender: true },
  });

  if (!user) throw new Error('USER_NOT_FOUND');

  const [record] = await prisma.$transaction([
    prisma.dlVerification.update({
      where: { veriffSessionId: manualSessionId(userId) },
      data: {
        status: 'APPROVED',
        declineReason: null,
        reviewedById: adminId,
        reviewedAt: new Date(),
        verifiedName: [user.firstName, user.lastName].filter(Boolean).join(' ').trim() || null,
        verifiedDob: user.dob ? user.dob.toISOString().slice(0, 10) : null,
        verifiedGender: user.gender ?? null,
        nameMatch: true,
        dobMatch: true,
        genderMatch: true,
        decisionPayload: payload('APPROVED', { adminId }),
      },
    }),
    prisma.user.update({ where: { id: userId }, data: { dlVerified: true } }),
  ]);

  logWarn('DL_MANUAL_APPROVED', { adminId, targetUserId: userId });

  return { record, dlVerified: true };
};

/**
 * Admin declines. The reason is shown to the driver verbatim so they know what to fix,
 * which is why the route layer requires it to be non-empty. `dlVerified` is cleared:
 * a decline must revoke a verification the user may already hold.
 */
export const declineDlDocument = async (
  userId: string,
  reason: string,
  adminId: string | null,
) => {
  await loadPendingRow(userId);

  const [record] = await prisma.$transaction([
    prisma.dlVerification.update({
      where: { veriffSessionId: manualSessionId(userId) },
      data: {
        status: 'DECLINED',
        declineReason: reason,
        reviewedById: adminId,
        reviewedAt: new Date(),
        nameMatch: false,
        dobMatch: false,
        genderMatch: false,
        decisionPayload: payload('DECLINED', { adminId, reason }),
      },
    }),
    prisma.user.update({ where: { id: userId }, data: { dlVerified: false } }),
  ]);

  logWarn('DL_MANUAL_DECLINED', { adminId, targetUserId: userId });

  return { record, dlVerified: false };
};
