const mockPrisma = {
    dlVerification: {
        findUnique: jest.fn(),
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

import { handleWebhookDecision } from './dl-verification.service';

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

    it('verifies when name matches and DOB/gender are absent from the payload', async () => {
        const res = await handleWebhookDecision(buildBody('approved', { firstName: 'Jon', lastName: 'Smith' }));

        expect(res).toEqual({ success: true, status: 'APPROVED' });
        expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { dlVerified: true } });
        expect(mockPrisma.dlVerification.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ dobMatch: null, genderMatch: null }) }),
        );
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
