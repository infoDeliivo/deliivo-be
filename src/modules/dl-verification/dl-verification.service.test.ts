const mockPrisma = {
    dlVerification: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { handleWebhookDecision, registerVeriffSession } from './dl-verification.service';

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
