const mockPrisma = {
    dlVerification: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
    },
    user: {
        findUnique: jest.fn(),
        update: jest.fn(),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import {
    submitDlDocument,
    listDlReviewQueue,
    approveDlDocument,
    declineDlDocument,
    hasDlDocumentOnFile,
    manualSessionId,
} from './dl-review.service';

const USER = 'user-7';
const MANUAL_KEY = `manual:${USER}`;
const IMAGE_KEY = 'uploads/vehicle-documents/user-7/licence.jpg';

const profile = {
    id: USER,
    dlVerified: false,
    firstName: 'Grace',
    lastName: 'Hopper',
    dob: new Date('1985-03-09T00:00:00Z'),
    gender: 'FEMALE',
};

/** A manual row in the state loadPendingRow expects to be actionable. */
const actionableRow = { id: 'rec-1', documentImageKey: IMAGE_KEY, status: 'PENDING' };

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(profile);
    mockPrisma.user.update.mockResolvedValue({ id: USER });
    mockPrisma.dlVerification.upsert.mockResolvedValue({ id: 'rec-1' });
    mockPrisma.dlVerification.update.mockResolvedValue({ id: 'rec-1' });
    mockPrisma.dlVerification.findUnique.mockResolvedValue(actionableRow);
    // Default: no APPROVED row anywhere, so the verified-elsewhere guard stays shut.
    mockPrisma.dlVerification.findFirst.mockResolvedValue(null);
    mockPrisma.$transaction.mockImplementation((operations: unknown[]) => Promise.all(operations));
});

describe('manualSessionId', () => {
    it('is deterministic, so re-submissions update one row instead of piling up', () => {
        expect(manualSessionId(USER)).toBe(MANUAL_KEY);
        expect(manualSessionId(USER)).toBe(manualSessionId(USER));
    });
});

describe('hasDlDocumentOnFile', () => {
    it('is true when any row carries an uploaded image', async () => {
        mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'rec-1' });

        await expect(hasDlDocumentOnFile(USER)).resolves.toBe(true);
        expect(mockPrisma.dlVerification.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: USER, documentImageKey: { not: null } } }),
        );
    });

    it('is false when the driver has never uploaded one', async () => {
        mockPrisma.dlVerification.findFirst.mockResolvedValue(null);

        await expect(hasDlDocumentOnFile(USER)).resolves.toBe(false);
    });
});

describe('submitDlDocument', () => {
    it('writes a PENDING row keyed on the deterministic manual id', async () => {
        await submitDlDocument(USER, IMAGE_KEY);

        expect(mockPrisma.dlVerification.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { veriffSessionId: MANUAL_KEY },
                create: expect.objectContaining({
                    userId: USER,
                    veriffSessionId: MANUAL_KEY,
                    status: 'PENDING',
                    documentImageKey: IMAGE_KEY,
                }),
                update: expect.objectContaining({ status: 'PENDING', documentImageKey: IMAGE_KEY }),
            }),
        );
    });

    it('clears a prior decline so a re-upload does not show a stale rejection', async () => {
        await submitDlDocument(USER, IMAGE_KEY);

        const args = mockPrisma.dlVerification.upsert.mock.calls[0][0];
        expect(args.update).toMatchObject({
            declineReason: null,
            reviewedById: null,
            reviewedAt: null,
        });
    });

    it('refuses a driver who is already DL-verified', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...profile, dlVerified: true });

        await expect(submitDlDocument(USER, IMAGE_KEY)).rejects.toThrow('ALREADY_VERIFIED');
        expect(mockPrisma.dlVerification.upsert).not.toHaveBeenCalled();
    });

    it('refuses when a Veriff approval stands even though the flag was cleared', async () => {
        mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'veriff-row' });

        await expect(submitDlDocument(USER, IMAGE_KEY)).rejects.toThrow('ALREADY_VERIFIED');
        expect(mockPrisma.dlVerification.upsert).not.toHaveBeenCalled();
    });

    it('throws USER_NOT_FOUND for an unknown user', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);

        await expect(submitDlDocument(USER, IMAGE_KEY)).rejects.toThrow('USER_NOT_FOUND');
    });
});

describe('approveDlDocument', () => {
    it('verifies the driver and stamps who reviewed it', async () => {
        const result = await approveDlDocument(USER, 'admin-1');

        expect(result.dlVerified).toBe(true);
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { veriffSessionId: MANUAL_KEY },
                data: expect.objectContaining({
                    status: 'APPROVED',
                    declineReason: null,
                    reviewedById: 'admin-1',
                    nameMatch: true,
                    dobMatch: true,
                    genderMatch: true,
                }),
            }),
        );
        expect(mockPrisma.dlVerification.update.mock.calls[0][0].data.reviewedAt).toBeInstanceOf(Date);
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: USER },
            data: { dlVerified: true },
        });
    });

    it('copies the identity from the profile — a human read the document against it', async () => {
        await approveDlDocument(USER, 'admin-1');

        expect(mockPrisma.dlVerification.update.mock.calls[0][0].data).toMatchObject({
            verifiedName: 'Grace Hopper',
            verifiedDob: '1985-03-09',
            verifiedGender: 'FEMALE',
        });
    });

    it('does both writes in one transaction', async () => {
        await approveDlDocument(USER, 'admin-1');

        expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
        expect(mockPrisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });
});

describe('declineDlDocument', () => {
    it('records the reason and clears the flag', async () => {
        const result = await declineDlDocument(USER, 'Photo is blurred', 'admin-1');

        expect(result.dlVerified).toBe(false);
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'DECLINED',
                    declineReason: 'Photo is blurred',
                    reviewedById: 'admin-1',
                }),
            }),
        );
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: USER },
            data: { dlVerified: false },
        });
    });
});

// The defect that prompted this work: a manual submission left open after Veriff
// approved the same driver could be declined, revoking a real verification.
describe.each([
    ['approveDlDocument', approveDlDocument as (u: string, a: string | null) => Promise<unknown>],
    [
        'declineDlDocument',
        ((u: string, a: string | null) => declineDlDocument(u, 'because', a)) as (
            u: string,
            a: string | null,
        ) => Promise<unknown>,
    ],
])('%s — guards against acting on a settled submission', (_label, act) => {
    it('refuses a submission Veriff already superseded', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue({
            ...actionableRow,
            status: 'SUPERSEDED',
        });

        await expect(act(USER, 'admin-1')).rejects.toThrow('DL_SUBMISSION_SUPERSEDED');
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses when the driver is verified through another row', async () => {
        mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'veriff-row' });

        await expect(act(USER, 'admin-1')).rejects.toThrow('DL_VERIFIED_ELSEWHERE');
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses when there is no submission at all', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue(null);

        await expect(act(USER, 'admin-1')).rejects.toThrow('DL_SUBMISSION_NOT_FOUND');
    });

    it('refuses a row with no image to look at', async () => {
        mockPrisma.dlVerification.findUnique.mockResolvedValue({
            ...actionableRow,
            documentImageKey: null,
        });

        await expect(act(USER, 'admin-1')).rejects.toThrow('DL_DOCUMENT_MISSING');
    });
});

describe('listDlReviewQueue', () => {
    beforeEach(() => {
        mockPrisma.dlVerification.findMany.mockResolvedValue([]);
        mockPrisma.dlVerification.count.mockResolvedValue(0);
    });

    it('lists only rows with an image — a Veriff row has nothing to look at', async () => {
        await listDlReviewQueue();

        const args = mockPrisma.dlVerification.findMany.mock.calls[0][0];
        expect(args.where).toMatchObject({ documentImageKey: { not: null } });
    });

    it('hides superseded submissions by default', async () => {
        await listDlReviewQueue();

        const args = mockPrisma.dlVerification.findMany.mock.calls[0][0];
        expect(args.where.status).toEqual({ not: 'SUPERSEDED' });
    });

    it('returns superseded submissions when asked for them by name', async () => {
        await listDlReviewQueue({ status: 'SUPERSEDED' });

        const args = mockPrisma.dlVerification.findMany.mock.calls[0][0];
        expect(args.where.status).toBe('SUPERSEDED');
    });

    it('works the queue oldest first', async () => {
        await listDlReviewQueue();

        expect(mockPrisma.dlVerification.findMany.mock.calls[0][0].orderBy).toEqual({
            updatedAt: 'asc',
        });
    });

    it('exposes the private key as previewKey rather than the raw column', async () => {
        mockPrisma.dlVerification.findMany.mockResolvedValue([
            { id: 'rec-1', userId: USER, status: 'PENDING', documentImageKey: IMAGE_KEY },
        ]);
        mockPrisma.dlVerification.count.mockResolvedValue(1);

        const result = await listDlReviewQueue();

        expect(result.submissions[0]).toMatchObject({ previewKey: IMAGE_KEY });
        expect(result.submissions[0]).not.toHaveProperty('documentImageKey');
    });

    it('clamps paging so a caller cannot ask for the whole table', async () => {
        await listDlReviewQueue({ page: 0, limit: 5000 });

        const args = mockPrisma.dlVerification.findMany.mock.calls[0][0];
        expect(args.take).toBe(100);
        expect(args.skip).toBe(0);
    });
});
