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

/**
 * Identity is matched against the driving licence only. The bank account holder is never
 * compared to the profile, so a Connect account in a different name still completes
 * onboarding — see the Veriff webhook for the identity gate that does apply.
 */
describe('connectStatus — onboarding completion', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.STRIPE_CONNECT_MOCK_MODE;
        mockGetConnectAccountStatus.mockResolvedValue(stripeReady);
        mockPrisma.user.update.mockResolvedValue(undefined);
    });

    it('completes onboarding when Stripe reports the account ready', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: {
                stripeOnboardingComplete: true,
                stripeAccountName: 'John Smith',
            },
        });
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(true);
        expect(data.identityMismatch).toBeUndefined();
    });

    it('completes onboarding even when the account holder name differs from the profile', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
        });
        mockGetConnectAccountStatus.mockResolvedValue({
            ...stripeReady,
            accountName: 'Jane Doe',
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(true);
    });

    it('leaves onboarding incomplete while Stripe still wants details', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: false,
        });
        mockGetConnectAccountStatus.mockResolvedValue({
            ...stripeReady,
            detailsSubmitted: false,
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(false);
    });

    it('does not re-write onboarding once already complete', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: true,
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.onboardingComplete).toBe(true);
    });

    it('reports not connected when no Stripe account exists', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: null,
            stripeOnboardingComplete: false,
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockGetConnectAccountStatus).not.toHaveBeenCalled();
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data).toEqual({ connected: false, onboardingComplete: false });
    });
});
