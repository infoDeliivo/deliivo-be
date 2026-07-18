const mockPrisma = {
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
};

const mockGetConnectAccountStatus = jest.fn();
const mockSendSuccess = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('./stripe.service.js', () => ({
    __esModule: true,
    createConnectOnboardingLink: jest.fn(),
    getConnectAccountStatus: (...args: unknown[]) => mockGetConnectAccountStatus(...args),
}));

jest.mock('../../utils/index.js', () => ({
    __esModule: true,
    HttpStatus: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
    sendError: jest.fn(),
    sendSuccess: (...args: unknown[]) => mockSendSuccess(...args),
}));

import { connectStatus } from './stripe.connect.controller.js';

const makeReqRes = () => {
    const req: any = { user: { id: 'user-1' } };
    const res: any = {};
    return { req, res };
};

const stripeReady = {
    accountId: 'acct_1',
    chargesEnabled: true,
    payoutsEnabled: true,
    detailsSubmitted: true,
    accountName: 'John Smith',
    accountDob: { day: 15, month: 5, year: 1990 },
};

const profileDob = new Date('1990-05-15T00:00:00Z');

describe('connectStatus — identity matching (name + DOB)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.STRIPE_CONNECT_MOCK_MODE;
        mockGetConnectAccountStatus.mockResolvedValue(stripeReady);
        mockPrisma.user.update.mockResolvedValue(undefined);
    });

    it('completes onboarding when Stripe is ready and name + DOB match', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
            name: 'John Smith',
            dob: profileDob,
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: {
                stripeOnboardingComplete: true,
                stripeAccountName: 'John Smith',
                stripeNameMatch: true,
                stripeDobMatch: true,
            },
        });
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(true);
        expect(data.identityMismatch).toBe(false);
    });

    it('blocks onboarding when the DOB differs even though the name matches', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
            name: 'John Smith',
            dob: new Date('1985-01-01T00:00:00Z'),
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { stripeAccountName: 'John Smith', stripeNameMatch: true, stripeDobMatch: false },
        });
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(false);
        expect(data.identityMismatch).toBe(true);
    });

    it('blocks onboarding and flags mismatch when the name differs', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
            name: 'Jane Doe',
            dob: profileDob,
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(false);
        expect(data.identityMismatch).toBe(true);
    });
});
