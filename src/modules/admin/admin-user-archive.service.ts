import { AdminUserAuditAction, Prisma, UserRole } from '@prisma/client';
import { prisma } from '../../config/index.js';
import redis from '../../cache/redis.js';
import { cancelUserActivity, hardDeleteUserAccount } from '../user/user-gdpr.service.js';

/**
 * Admin archive is a reversible removal: the account is locked and hidden but its row and
 * PII stay intact, so an admin can restore it. Permanent deletion (purge) is only possible
 * from the archive, after the admin types the target's phone (or email when it has no
 * phone) in the admin portal.
 */

export type AdminUserArchiveErrorCode =
    | 'USER_NOT_FOUND'
    | 'CANNOT_ARCHIVE_ADMIN'
    | 'ALREADY_ARCHIVED'
    | 'NOT_ARCHIVED'
    | 'PURGE_CONFIRMATION_MISMATCH'
    | 'PURGE_INCOMPLETE';

export class AdminUserArchiveError extends Error {
    constructor(readonly code: AdminUserArchiveErrorCode) {
        super(code);
        this.name = 'AdminUserArchiveError';
    }
}

/** Same key `protect` checks; set while archived so live access tokens stop working at once. */
const bannedKey = (userId: string) => `banned:${userId}`;

const targetSelect = {
    id: true,
    role: true,
    firstName: true,
    lastName: true,
    email: true,
    phone: true,
    isBanned: true,
    archivedAt: true,
    archiveReason: true,
} satisfies Prisma.UserSelect;

type ArchiveTarget = Prisma.UserGetPayload<{ select: typeof targetSelect }>;

const loadTarget = async (userId: string): Promise<ArchiveTarget> => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: targetSelect });
    if (!user) throw new AdminUserArchiveError('USER_NOT_FOUND');
    return user;
};

const snapshotOf = (user: ArchiveTarget): Prisma.InputJsonObject => ({
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    phone: user.phone,
    role: user.role,
    isBanned: user.isBanned,
});

const writeAudit = (
    action: AdminUserAuditAction,
    actorId: string,
    target: ArchiveTarget,
    reason: string | null,
) =>
    prisma.adminUserAuditLog.create({
        data: {
            action,
            actorId,
            targetUserId: target.id,
            targetSnapshot: snapshotOf(target),
            reason,
        },
    });

/** Phones are compared on digits and a leading plus only, so "+372 5555 1234" matches "+37255551234". */
const normalizePhone = (value: string) => value.replace(/[^\d+]/g, '');

/**
 * The admin proves they mean this account by typing its phone, or its email when it has
 * no phone (email-only accounts are common, especially test users).
 */
const confirmationMatches = (target: ArchiveTarget, typed: string): boolean => {
    const value = typed.trim();
    if (!value) return false;
    if (target.phone) return normalizePhone(target.phone) === normalizePhone(value);
    if (target.email) return target.email.toLowerCase() === value.toLowerCase();
    return false;
};

/* ================= ARCHIVE ================= */
export const archiveUser = async (adminId: string, userId: string, reason: string | null) => {
    const target = await loadTarget(userId);
    if (target.role === UserRole.ADMIN) throw new AdminUserArchiveError('CANNOT_ARCHIVE_ADMIN');
    if (target.archivedAt) throw new AdminUserArchiveError('ALREADY_ARCHIVED');

    // Lock first: once the key is set no live token can start new activity while the
    // cancellations below are running.
    await redis.set(bannedKey(userId), '1');

    try {
        // Cancels upcoming rides and bookings with a full refund, and revokes refresh tokens.
        await cancelUserActivity(userId);
    } catch (error) {
        // Not archived after all, so do not leave the account locked out.
        if (!target.isBanned) await redis.del(bannedKey(userId));
        throw error;
    }

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { archivedAt: new Date(), archivedById: adminId, archiveReason: reason },
        select: { id: true, archivedAt: true, archivedById: true, archiveReason: true },
    });

    await writeAudit(AdminUserAuditAction.ARCHIVE, adminId, target, reason);
    return updated;
};

/* ================= RESTORE ================= */
export const restoreUser = async (adminId: string, userId: string) => {
    const target = await loadTarget(userId);
    if (!target.archivedAt) throw new AdminUserArchiveError('NOT_ARCHIVED');

    const updated = await prisma.user.update({
        where: { id: userId },
        data: { archivedAt: null, archivedById: null, archiveReason: null },
        select: { id: true, archivedAt: true, isBanned: true },
    });

    // A ban that was in force before the archive must survive the restore.
    if (!target.isBanned) {
        await redis.del(bannedKey(userId));
    }

    await writeAudit(AdminUserAuditAction.RESTORE, adminId, target, null);
    return updated;
};

/* ================= PURGE ================= */
export const purgeUser = async (
    adminId: string,
    userId: string,
    input: { confirmIdentifier: string },
) => {
    const target = await loadTarget(userId);
    // Only archived users can be purged, so a live account always goes through the
    // reversible archive step first.
    if (!target.archivedAt) throw new AdminUserArchiveError('NOT_ARCHIVED');

    if (!confirmationMatches(target, input.confirmIdentifier)) {
        throw new AdminUserArchiveError('PURGE_CONFIRMATION_MISMATCH');
    }

    // Audit before the delete: if the process dies mid-purge the intent is still recorded.
    await writeAudit(AdminUserAuditAction.PURGE, adminId, target, target.archiveReason);

    // The `banned:<id>` key is left in place: any access token still alive for this id
    // must keep failing at `protect`.
    const result = await hardDeleteUserAccount(userId);
    if (!result.hardDeleted) throw new AdminUserArchiveError('PURGE_INCOMPLETE');

    return { id: userId, purged: true };
};
