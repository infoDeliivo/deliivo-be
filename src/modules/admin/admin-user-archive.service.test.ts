const mockPrisma = {
    user: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    adminUserAuditLog: { create: jest.fn() },
};
const mockRedis = { set: jest.fn(), del: jest.fn() };
const mockCancelUserActivity = jest.fn();
const mockHardDeleteUserAccount = jest.fn();

jest.mock('../../config/index.js', () => ({ __esModule: true, prisma: mockPrisma }));
jest.mock('../../cache/redis.js', () => ({ __esModule: true, default: mockRedis }));
jest.mock('../user/user-gdpr.service.js', () => ({
    __esModule: true,
    cancelUserActivity: (userId: string) => mockCancelUserActivity(userId),
    hardDeleteUserAccount: (userId: string) => mockHardDeleteUserAccount(userId),
}));

import {
    AdminUserArchiveError,
    archiveUser,
    purgeUser,
    restoreUser,
} from './admin-user-archive.service.js';

const ADMIN_ID = 'admin-1';
const USER_ID = 'user-1';

const liveUser = {
    id: USER_ID,
    role: 'USER',
    firstName: 'Test',
    lastName: 'User',
    email: 'test@test.local',
    phone: '+37255551234',
    isBanned: false,
    archivedAt: null,
    archiveReason: null,
};
const archivedUser = { ...liveUser, archivedAt: new Date('2026-10-01T10:00:00Z'), archiveReason: 'test account' };

const expectArchiveError = async (promise: Promise<unknown>, code: string) => {
    await expect(promise).rejects.toBeInstanceOf(AdminUserArchiveError);
    await expect(promise).rejects.toMatchObject({ code });
};

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: USER_ID, ...data }));
    mockPrisma.adminUserAuditLog.create.mockResolvedValue({});
});

describe('archiveUser', () => {
    it('locks the account, cancels activity, records who archived it and writes an audit row', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(liveUser);

        await archiveUser(ADMIN_ID, USER_ID, 'test account');

        expect(mockRedis.set).toHaveBeenCalledWith(`banned:${USER_ID}`, '1');
        expect(mockCancelUserActivity).toHaveBeenCalledWith(USER_ID);
        expect(mockPrisma.user.update.mock.calls[0][0].data).toMatchObject({
            archivedById: ADMIN_ID,
            archiveReason: 'test account',
            archivedAt: expect.any(Date),
        });
        // PII is left alone so the account can be restored.
        expect(mockPrisma.user.update.mock.calls[0][0].data).not.toHaveProperty('email');
        expect(mockPrisma.adminUserAuditLog.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                action: 'ARCHIVE',
                actorId: ADMIN_ID,
                targetUserId: USER_ID,
                reason: 'test account',
                targetSnapshot: expect.objectContaining({ email: liveUser.email, phone: liveUser.phone }),
            }),
        });
    });

    it('refuses an admin target', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...liveUser, role: 'ADMIN' });

        await expectArchiveError(archiveUser(ADMIN_ID, USER_ID, null), 'CANNOT_ARCHIVE_ADMIN');
        expect(mockCancelUserActivity).not.toHaveBeenCalled();
    });

    it('refuses an account that is already archived', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(archivedUser);

        await expectArchiveError(archiveUser(ADMIN_ID, USER_ID, null), 'ALREADY_ARCHIVED');
    });

    it('returns USER_NOT_FOUND for an unknown id', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expectArchiveError(archiveUser(ADMIN_ID, USER_ID, null), 'USER_NOT_FOUND');
    });

    it('unlocks the account again when cancelling its activity fails', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(liveUser);
        mockCancelUserActivity.mockRejectedValueOnce(new Error('A ride request payment is still being processed.'));

        await expect(archiveUser(ADMIN_ID, USER_ID, null)).rejects.toThrow('still being processed');
        expect(mockRedis.del).toHaveBeenCalledWith(`banned:${USER_ID}`);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('keeps a pre-existing ban in force when cancelling fails', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...liveUser, isBanned: true });
        mockCancelUserActivity.mockRejectedValueOnce(new Error('boom'));

        await expect(archiveUser(ADMIN_ID, USER_ID, null)).rejects.toThrow('boom');
        expect(mockRedis.del).not.toHaveBeenCalled();
    });
});

describe('restoreUser', () => {
    it('clears the archive fields, unlocks the account and writes an audit row', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(archivedUser);

        await restoreUser(ADMIN_ID, USER_ID);

        expect(mockPrisma.user.update.mock.calls[0][0].data).toEqual({
            archivedAt: null,
            archivedById: null,
            archiveReason: null,
        });
        expect(mockRedis.del).toHaveBeenCalledWith(`banned:${USER_ID}`);
        expect(mockPrisma.adminUserAuditLog.create.mock.calls[0][0].data).toMatchObject({ action: 'RESTORE' });
    });

    it('keeps the Redis lock when the user was banned before being archived', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...archivedUser, isBanned: true });

        await restoreUser(ADMIN_ID, USER_ID);

        expect(mockRedis.del).not.toHaveBeenCalled();
    });

    it('refuses a user who is not archived', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(liveUser);

        await expectArchiveError(restoreUser(ADMIN_ID, USER_ID), 'NOT_ARCHIVED');
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
});

describe('purgeUser', () => {
    const purge = (adminId: string, confirmIdentifier: string) => purgeUser(adminId, USER_ID, { confirmIdentifier });

    it('refuses a user who is not archived', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(liveUser);

        await expectArchiveError(purge(ADMIN_ID, liveUser.phone), 'NOT_ARCHIVED');
        expect(mockHardDeleteUserAccount).not.toHaveBeenCalled();
    });

    it('refuses when the typed phone does not match', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(archivedUser);

        await expectArchiveError(purge(ADMIN_ID, '+37299999999'), 'PURGE_CONFIRMATION_MISMATCH');
        expect(mockPrisma.adminUserAuditLog.create).not.toHaveBeenCalled();
        expect(mockHardDeleteUserAccount).not.toHaveBeenCalled();
    });

    it('accepts the phone typed with spaces, audits, then hard-deletes', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(archivedUser);
        mockHardDeleteUserAccount.mockResolvedValue({ deleted: true, hardDeleted: true });

        const result = await purge(ADMIN_ID, '+372 5555 1234');

        expect(mockPrisma.adminUserAuditLog.create.mock.calls[0][0].data).toMatchObject({
            action: 'PURGE',
            actorId: ADMIN_ID,
            targetSnapshot: expect.objectContaining({ phone: liveUser.phone }),
        });
        expect(mockHardDeleteUserAccount).toHaveBeenCalledWith(USER_ID);
        expect(result).toEqual({ id: USER_ID, purged: true });
    });

    it('confirms an email-only account by its email, case-insensitively', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...archivedUser, phone: null });
        mockHardDeleteUserAccount.mockResolvedValue({ deleted: true, hardDeleted: true });

        await purge(ADMIN_ID, 'TEST@test.local');

        expect(mockHardDeleteUserAccount).toHaveBeenCalledWith(USER_ID);
    });

    it('does not accept the email for an account that has a phone', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(archivedUser);

        await expectArchiveError(purge(ADMIN_ID, liveUser.email), 'PURGE_CONFIRMATION_MISMATCH');
    });

    it('reports an incomplete purge instead of claiming success', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(archivedUser);
        mockHardDeleteUserAccount.mockResolvedValue({ deleted: true, hardDeleted: false });

        await expectArchiveError(purge(ADMIN_ID, liveUser.phone), 'PURGE_INCOMPLETE');
    });
});
