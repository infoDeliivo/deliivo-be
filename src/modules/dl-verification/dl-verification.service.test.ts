const mockPrisma = {
    dlVerification: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue(undefined),
        upsert: jest.fn(),
        // A Veriff approval closes any open manual submission.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import {
    getVerificationStatus,
    handleWebhookDecision,
    registerVeriffSession,
    setDlVerificationForTest,
} from './dl-verification.service';

type Person = { firstName: string; lastName: string; dateOfBirth?: string; gender?: string };

const buildBody = (status: string, person: Person) => ({
    verification: { id: 'veriff-session-1', status, code: 9001, person },
});

const profile = { firstName: 'Jon', lastName: 'Smith', dob: new Date('1990-05-15T00:00:00Z'), gender: 'MALE' };

describe('handleWebhookDecision — identity matching (name + DOB + gender)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.dlVerification.findUnique.mockResolvedValue({ id: 'rec-1', userId: 'user-1' });
        mockPrisma.dlVerification.update.mockResolvedValue(undefined);
        mockPrisma.user.update.mockResolvedValue(undefined);
        mockPrisma.user.findUnique.mockResolvedValue(profile);
    });

    it('verifies the user when approved and name + DOB + gender all match', async () => {
        const res = await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jón', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        expect(res).toEqual({ success: true, status: 'APPROVED' });
        expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { dlVerified: true } });
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'APPROVED',
                    verifiedName: 'Jón Smith',
                    verifiedDob: '1990-05-15',
                    verifiedGender: 'M',
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                }),
            }),
        );
    });

    // Without this, a manual submission left open after Veriff approves stays in the
    // admin queue, where declining it would revoke the verification just granted.
    it('closes an open manual submission when it verifies the driver', async () => {
        await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jón', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        expect(mockPrisma.dlVerification.updateMany).toHaveBeenCalledWith({
            where: { veriffSessionId: 'manual:user-1', status: 'PENDING' },
            data: { status: 'SUPERSEDED' },
        });
    });

    it('leaves a manual submission an admin already decided alone', async () => {
        await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jón', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        // Scoped to PENDING, so a DECLINED or APPROVED manual row stays as the record it is.
        expect(mockPrisma.dlVerification.updateMany.mock.calls[0][0].where.status).toBe('PENDING');
    });

    it('supersedes nothing when the identity does not match', async () => {
        await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1991-05-15', gender: 'M' }),
        );

        expect(mockPrisma.dlVerification.updateMany).not.toHaveBeenCalled();
    });

    it('blocks with IDENTITY_MISMATCH when the DOB differs', async () => {
        const res = await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1991-05-15', gender: 'M' }),
        );

        expect(res).toEqual({ success: true, status: 'IDENTITY_MISMATCH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'IDENTITY_MISMATCH', dobMatch: false }) }),
        );
    });

    it('blocks with IDENTITY_MISMATCH when the gender differs', async () => {
        const res = await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'F' }),
        );

        expect(res).toEqual({ success: true, status: 'IDENTITY_MISMATCH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ genderMatch: false }) }),
        );
    });

    it('blocks with IDENTITY_MISMATCH when the name differs', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ firstName: 'Jane', lastName: 'Doe', dob: profile.dob, gender: 'FEMALE' });
        const res = await handleWebhookDecision(
            buildBody('approved', { firstName: 'John', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        expect(res).toEqual({ success: true, status: 'IDENTITY_MISMATCH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('blocks with IDENTITY_MISMATCH when the profile has no last name', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ firstName: 'Jon', lastName: null, dob: profile.dob, gender: 'MALE' });
        const res = await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        expect(res).toEqual({ success: true, status: 'IDENTITY_MISMATCH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ nameMatch: false }) }),
        );
    });

    it('joins the profile first and last name before comparing to the document', async () => {
        const res = await handleWebhookDecision(
            buildBody('approved', { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        expect(res).toEqual({ success: true, status: 'APPROVED' });
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ select: { firstName: true, lastName: true, dob: true, gender: true } }),
        );
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ nameMatch: true }) }),
        );
    });

    // KYC-grade matching: a field the document does not assert is a mismatch, not a
    // field to be skipped. An approved decision with nothing to compare verifies nobody.
    it('withholds verification when DOB/gender are absent from the payload', async () => {
        const res = await handleWebhookDecision(buildBody('approved', { firstName: 'Jon', lastName: 'Smith' }));

        expect(res).toEqual({ success: true, status: 'IDENTITY_MISMATCH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ dobMatch: false, genderMatch: false }) }),
        );
    });

    it('withholds verification when the document carries an extra middle name', async () => {
        const res = await handleWebhookDecision(
            buildBody('approved', {
                firstName: 'Jon Michael',
                lastName: 'Smith',
                dateOfBirth: '1990-05-15',
                gender: 'M',
            }),
        );

        expect(res).toEqual({ success: true, status: 'IDENTITY_MISMATCH' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('does not verify or match-check a declined decision', async () => {
        const res = await handleWebhookDecision(
            buildBody('declined', { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' }),
        );

        expect(res).toEqual({ success: true, status: 'DECLINED' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'DECLINED', nameMatch: null }) }),
        );
    });
});

// Sessions the browser SDK creates are unknown to us until the client registers them,
// and a decision can still arrive for one that never was. vendorData is set by Veriff
// at session creation, so it is the authority on who the session belongs to.
describe('handleWebhookDecision — resolving the driver by vendorData', () => {
    const buildVendorBody = (vendorData: string, person: Person) => ({
        verification: { id: 'veriff-session-1', status: 'approved', code: 9001, person, vendorData },
    });
    const matchingPerson: Person = { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' };

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.dlVerification.update.mockResolvedValue(undefined);
        mockPrisma.dlVerification.create.mockResolvedValue({ id: 'rec-new' });
        mockPrisma.user.update.mockResolvedValue(undefined);
    });

    it('creates the record and approves when no session was registered but vendorData is a real user', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue(null);
        mockPrisma.user.findUnique
            .mockResolvedValueOnce({ id: 'user-1' }) // vendorData lookup
            .mockResolvedValueOnce(profile); // identity comparison

        const res = await handleWebhookDecision(buildVendorBody('user-1', matchingPerson));

        expect(res).toEqual({ success: true, status: 'APPROVED' });
        expect(mockPrisma.dlVerification.create).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                veriffSessionId: 'veriff-session-1',
                veriffSessionUrl: '',
                status: 'PENDING',
            },
        });
        expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { dlVerified: true } });
    });

    it('trusts vendorData over the registered record when the two disagree', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue({ id: 'rec-1', userId: 'imposter' });
        mockPrisma.user.findUnique
            .mockResolvedValueOnce({ id: 'user-1' })
            .mockResolvedValueOnce(profile);

        const res = await handleWebhookDecision(buildVendorBody('user-1', matchingPerson));

        expect(res).toEqual({ success: true, status: 'APPROVED' });
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
        // Ownership is corrected on the row itself, not only on the user flag.
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ userId: 'user-1' }) }),
        );
        expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { dlVerified: true } });
    });

    it('returns SESSION_NOT_FOUND when there is no record and vendorData names nobody', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue(null);
        mockPrisma.user.findUnique.mockResolvedValue(null);

        const res = await handleWebhookDecision(buildVendorBody('ghost-user', matchingPerson));

        expect(res).toEqual({ success: false, reason: 'SESSION_NOT_FOUND' });
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('returns SESSION_NOT_FOUND when there is no record and no vendorData at all', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue(null);

        const res = await handleWebhookDecision(buildBody('approved', matchingPerson));

        expect(res).toEqual({ success: false, reason: 'SESSION_NOT_FOUND' });
        // No vendorData means no reason to hit the user table at all.
        expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
});

describe('registerVeriffSession', () => {
    const options = {
        userId: 'user-1',
        sessionId: 'veriff-session-1',
        sessionUrl: 'https://alchemy.veriff.com/v/token',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.dlVerification.findFirst.mockResolvedValue(null);
        mockPrisma.dlVerification.findUnique.mockResolvedValue(null);
    });

    it('creates a PENDING row for a session the browser just made', async () => {
        mockPrisma.dlVerification.create.mockResolvedValue({
            id: 'rec-1',
            veriffSessionId: options.sessionId,
            veriffSessionUrl: options.sessionUrl,
        });

        const res = await registerVeriffSession(options);

        expect(res).toEqual({
            success: true,
            data: { verificationId: 'rec-1', sessionId: options.sessionId, sessionUrl: options.sessionUrl },
        });
        expect(mockPrisma.dlVerification.create).toHaveBeenCalledWith({
            data: {
                userId: 'user-1',
                veriffSessionId: options.sessionId,
                veriffSessionUrl: options.sessionUrl,
                status: 'PENDING',
            },
        });
    });

    it('is idempotent — re-registering the same session for the same user writes nothing', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue({
            id: 'rec-1',
            userId: 'user-1',
            veriffSessionId: options.sessionId,
            veriffSessionUrl: options.sessionUrl,
        });

        const res = await registerVeriffSession(options);

        expect(res).toEqual({
            success: true,
            data: { verificationId: 'rec-1', sessionId: options.sessionId, sessionUrl: options.sessionUrl },
        });
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
    });

    it('refuses a session that already belongs to someone else', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue({
            id: 'rec-1',
            userId: 'other-user',
            veriffSessionId: options.sessionId,
            veriffSessionUrl: options.sessionUrl,
        });

        const res = await registerVeriffSession(options);

        expect(res).toEqual({ success: false, reason: 'SESSION_OWNED_BY_ANOTHER_USER' });
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
    });

    it('refuses an already-approved driver', async () => {
        mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'rec-approved' });

        const res = await registerVeriffSession(options);

        expect(res).toEqual({ success: false, reason: 'ALREADY_VERIFIED' });
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
    });

    it('recovers from a concurrent double-submit instead of throwing', async () => {
        mockPrisma.dlVerification.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        mockPrisma.dlVerification.findUnique
            .mockResolvedValueOnce(null) // lost the race
            .mockResolvedValueOnce({
                id: 'rec-1',
                userId: 'user-1',
                veriffSessionId: options.sessionId,
                veriffSessionUrl: options.sessionUrl,
            });

        const res = await registerVeriffSession(options);

        expect(res).toEqual({
            success: true,
            data: { verificationId: 'rec-1', sessionId: options.sessionId, sessionUrl: options.sessionUrl },
        });
    });
});

describe('setDlVerificationForTest — admin test override', () => {
    const testProfile = {
        firstName: 'Ada',
        lastName: 'Lovelace',
        dob: new Date('1988-12-10T00:00:00Z'),
        gender: 'FEMALE',
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.findUnique.mockResolvedValue(testProfile);
        mockPrisma.dlVerification.upsert.mockResolvedValue({ id: 'rec-test-1' });
        mockPrisma.user.update.mockResolvedValue({ id: 'user-9', dlVerified: true });
        mockPrisma.$transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));
    });

    it('marks the user DL-verified and writes an APPROVED row with every match flag true', async () => {
        const result = await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(result.dlVerified).toBe(true);
        expect(result.record).toEqual({ id: 'rec-test-1' });

        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { veriffSessionId: 'admin-test:user-9' },
                create: expect.objectContaining({
                    userId: 'user-9',
                    veriffSessionId: 'admin-test:user-9',
                    veriffSessionUrl: 'https://admin-test.local/dl/user-9',
                    status: 'APPROVED',
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                }),
                update: expect.objectContaining({
                    status: 'APPROVED',
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                }),
            }),
        );

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-9' },
            data: { dlVerified: true },
        });
    });

    it('copies the identity fields from the user profile so the row self-matches', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.create).toMatchObject({
            verifiedName: 'Ada Lovelace',
            verifiedDob: '1988-12-10',
            verifiedGender: 'FEMALE',
        });
    });

    it('tags the row as synthetic so it is greppable in the database', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.create.decisionPayload).toMatchObject({
            source: 'ADMIN_TEST',
            adminId: 'admin-1',
        });
        expect(typeof args.create.decisionPayload.at).toBe('string');
    });

    it('unverifies: DECLINED row, all match flags false, flag cleared', async () => {
        mockPrisma.user.update.mockResolvedValue({ id: 'user-9', dlVerified: false });

        const result = await setDlVerificationForTest('user-9', false, 'admin-1');

        expect(result.dlVerified).toBe(false);
        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: expect.objectContaining({
                    status: 'DECLINED',
                    nameMatch: false,
                    dobMatch: false,
                    genderMatch: false,
                }),
            }),
        );
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-9' },
            data: { dlVerified: false },
        });
    });

    it('is idempotent — a second verify upserts the same key instead of creating a row', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');
        await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledTimes(2);
        const [first, second] = mockPrisma.dlVerification.upsert.mock.calls;
        expect(first[0].where).toEqual(second[0].where);
    });

    it('never touches a real Veriff row', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.create).not.toHaveBeenCalled();
    });

    it('does both writes in one transaction', async () => {
        await setDlVerificationForTest('user-9', true, 'admin-1');

        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('throws USER_NOT_FOUND for an unknown user and writes nothing', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(setDlVerificationForTest('nope', true, 'admin-1')).rejects.toThrow(
            'USER_NOT_FOUND',
        );
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.upsert).not.toHaveBeenCalled();
    });

    it('handles a profile with no name, DOB or gender', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            firstName: null,
            lastName: null,
            dob: null,
            gender: null,
        });

        await setDlVerificationForTest('user-9', true, 'admin-1');

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.create).toMatchObject({
            verifiedName: null,
            verifiedDob: null,
            verifiedGender: null,
        });
    });
});

describe('getVerificationStatus', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // The manual row is an upsert, so its createdAt never moves off the first
    // submission. Ordering by createdAt would let an older-but-newer-created Veriff
    // row win, and a driver re-declined today would never see why.
    it('reads the most recently updated row, not the most recently created', async () => {
        mockPrisma.dlVerification.findMany.mockResolvedValue([]);

        await getVerificationStatus('user-1');

        expect(mockPrisma.dlVerification.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { updatedAt: 'desc' }, take: 1 }),
        );
    });

    it('reports NOT_STARTED when the driver has no rows', async () => {
        mockPrisma.dlVerification.findMany.mockResolvedValue([]);

        const res = await getVerificationStatus('user-1');

        expect(res.data).toEqual({ status: 'NOT_STARTED', record: null });
    });

    it('surfaces the decline reason and whether an image is on file', async () => {
        mockPrisma.dlVerification.findMany.mockResolvedValue([
            {
                id: 'rec-1',
                status: 'DECLINED',
                veriffSessionId: 'manual:user-1',
                veriffSessionUrl: '',
                declineReason: 'Photo is blurred',
                documentImageKey: 'uploads/vehicle-documents/user-1/dl.jpg',
                createdAt: new Date('2026-01-01T00:00:00Z'),
                updatedAt: new Date('2026-08-01T00:00:00Z'),
            },
        ]);

        const res = await getVerificationStatus('user-1');

        expect(res.data).toMatchObject({
            status: 'DECLINED',
            declineReason: 'Photo is blurred',
            hasDocument: true,
        });
    });
});
