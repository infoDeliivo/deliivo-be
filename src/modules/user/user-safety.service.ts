import { prisma } from '../../config/index.js';

/* ================= REPORT USER ================= */
export const reportUser = async (reporterId: string, reportedId: string, reason: string, details?: string) => {
    if (reporterId === reportedId) throw new Error('CANNOT_REPORT_SELF');

    const reported = await prisma.user.findUnique({ where: { id: reportedId }, select: { id: true } });
    if (!reported) throw new Error('USER_NOT_FOUND');

    const existing = await prisma.userReport.findUnique({
        where: { reporterId_reportedId: { reporterId, reportedId } },
    });
    if (existing) throw new Error('ALREADY_REPORTED');

    return prisma.userReport.create({
        data: { reporterId, reportedId, reason, details },
        select: { id: true, reporterId: true, reportedId: true, reason: true, createdAt: true },
    });
};

/* ================= BLOCK USER ================= */
export const blockUser = async (blockerId: string, blockedId: string) => {
    if (blockerId === blockedId) throw new Error('CANNOT_BLOCK_SELF');

    const blocked = await prisma.user.findUnique({ where: { id: blockedId }, select: { id: true } });
    if (!blocked) throw new Error('USER_NOT_FOUND');

    return prisma.userBlock.upsert({
        where: { blockerId_blockedId: { blockerId, blockedId } },
        create: { blockerId, blockedId },
        update: {},
        select: { id: true, blockerId: true, blockedId: true, createdAt: true },
    });
};

/* ================= UNBLOCK USER ================= */
export const unblockUser = async (blockerId: string, blockedId: string) => {
    const existing = await prisma.userBlock.findUnique({
        where: { blockerId_blockedId: { blockerId, blockedId } },
    });
    if (!existing) throw new Error('BLOCK_NOT_FOUND');

    await prisma.userBlock.delete({ where: { blockerId_blockedId: { blockerId, blockedId } } });
    return { unblocked: true };
};

/* ================= LIST BLOCKED USERS ================= */
export const listBlockedUsers = async (blockerId: string) => {
    return prisma.userBlock.findMany({
        where: { blockerId },
        select: {
            id: true,
            createdAt: true,
            blocked: { select: { id: true, name: true, avatarUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
};
