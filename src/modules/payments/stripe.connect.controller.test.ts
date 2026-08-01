const mockPrisma = {
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
};

const mockGetConnectAccountStatus = jest.fn();
const mockCreateConnectAccountSession = jest.fn();
const mockSendSuccess = jest.fn();
const mockSendError = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('./stripe.service.js', () => ({
    __esModule: true,
    createConnectOnboardingLink: jest.fn(),
    createConnectAccountSession: (...args: unknown[]) => mockCreateConnectAccountSession(...args),
    getConnectAccountStatus: (...args: unknown[]) => mockGetConnectAccountStatus(...args),
}));

jest.mock('../../utils/index.js', () => ({
    __esModule: true,
    HttpStatus: { INTERNAL_ERROR: 'INTERNAL_ERROR' },
    sendError: (...args: unknown[]) => mockSendError(...args),
    sendSuccess: (...args: unknown[]) => mockSendSuccess(...args),
}));

import { connectAccountSession, connectStatus } from './stripe.connect.controller.js';

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
    requirementCollection: 'application',
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

    it('reports which side collects requirements', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            stripeOnboardingComplete: true,
        });
        mockGetConnectAccountStatus.mockResolvedValue({
            ...stripeReady,
            requirementCollection: 'stripe',
        });

        const { req, res } = makeReqRes();
        await connectStatus(req, res);

        expect(mockSendSuccess.mock.calls[0][1].data.requirementCollection).toBe('stripe');
    });
});

describe('connectAccountSession — embedded onboarding', () => {
    const session = {
        accountId: 'acct_1',
        clientSecret: 'accsess_secret_1',
        expiresAt: 1893456000,
        requirementCollection: 'application' as const,
    };

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.STRIPE_CONNECT_MOCK_MODE;
        mockCreateConnectAccountSession.mockResolvedValue(session);
        mockPrisma.user.update.mockResolvedValue(undefined);
    });

    it('returns a fresh client secret for an existing account', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            firstName: 'John',
            lastName: 'Smith',
            email: 'john@example.com',
            phone: '+441234567890',
            dob: new Date('1990-05-15T00:00:00.000Z'),
        });

        const { req, res } = makeReqRes();
        await connectAccountSession(req, res);

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockSendSuccess.mock.calls[0][1].data).toEqual({
            clientSecret: 'accsess_secret_1',
            expiresAt: 1893456000,
            accountId: 'acct_1',
            requirementCollection: 'application',
        });
    });

    it('persists the account id when the account is created on first call', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: null,
            firstName: 'John',
            lastName: 'Smith',
            email: 'john@example.com',
            phone: null,
            dob: null,
        });

        const { req, res } = makeReqRes();
        await connectAccountSession(req, res);

        expect(mockCreateConnectAccountSession).toHaveBeenCalledWith('user-1', null, {
            firstName: 'John',
            lastName: 'Smith',
            email: 'john@example.com',
            phone: null,
            dob: null,
        });
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { stripeAccountId: 'acct_1' },
        });
    });

    it('ignores a caller-supplied account id', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            firstName: null,
            lastName: null,
            email: null,
            phone: null,
            dob: null,
        });

        const { req, res } = makeReqRes();
        req.body = { account: 'acct_notMine', accountId: 'acct_notMine' };
        await connectAccountSession(req, res);

        expect(mockCreateConnectAccountSession).toHaveBeenCalledWith(
            'user-1',
            'acct_1',
            expect.anything()
        );
        expect(mockSendSuccess.mock.calls[0][1].data.accountId).toBe('acct_1');
    });

    it('returns a mock stub without calling Stripe when Connect is mocked', async () => {
        process.env.STRIPE_CONNECT_MOCK_MODE = 'true';

        const { req, res } = makeReqRes();
        await connectAccountSession(req, res);

        expect(mockCreateConnectAccountSession).not.toHaveBeenCalled();
        const data = mockSendSuccess.mock.calls[0][1].data;
        expect(data.mock).toBe(true);
        expect(data.clientSecret).toBeNull();
    });

    it('returns a 500 envelope when Stripe fails', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            firstName: null,
            lastName: null,
            email: null,
            phone: null,
            dob: null,
        });
        mockCreateConnectAccountSession.mockRejectedValue(new Error('stripe down'));

        const { req, res } = makeReqRes();
        await connectAccountSession(req, res);

        expect(mockSendSuccess).not.toHaveBeenCalled();
        expect(mockSendError).toHaveBeenCalledWith(res, {
            status: 'INTERNAL_ERROR',
            message: 'Failed to create Stripe Connect account session',
        });
    });
});
