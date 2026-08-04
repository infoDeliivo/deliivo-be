const mockPrisma = {
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
};

const mockGetConnectAccountStatus = jest.fn();
const mockEnsureConnectedAccount = jest.fn();
const mockGetConnectRequirements = jest.fn();
const mockUpdatePersonalDetails = jest.fn();
const mockAttachBankAccount = jest.fn();
const mockDeleteBankAccount = jest.fn();
const mockUploadConnectIdentityDocument = jest.fn();
const mockAcceptTerms = jest.fn();
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
    ensureConnectedAccount: (...args: unknown[]) => mockEnsureConnectedAccount(...args),
    getConnectRequirements: (...args: unknown[]) => mockGetConnectRequirements(...args),
    updateConnectPersonalDetails: (...args: unknown[]) => mockUpdatePersonalDetails(...args),
    attachConnectBankAccount: (...args: unknown[]) => mockAttachBankAccount(...args),
    deleteConnectBankAccount: (...args: unknown[]) => mockDeleteBankAccount(...args),
    uploadConnectIdentityDocument: (...args: unknown[]) => mockUploadConnectIdentityDocument(...args),
    acceptConnectTerms: (...args: unknown[]) => mockAcceptTerms(...args),
}));

jest.mock('../../utils/index.js', () => ({
    __esModule: true,
    HttpStatus: { INTERNAL_ERROR: 'INTERNAL_ERROR', BAD_REQUEST: 'BAD_REQUEST', CONFLICT: 'CONFLICT' },
    sendError: (...args: unknown[]) => mockSendError(...args),
    sendSuccess: (...args: unknown[]) => mockSendSuccess(...args),
}));

import {
    connectAcceptTerms,
    connectAccountSession,
    connectBankAccount,
    connectDeleteBankAccount,
    connectIdentityDocument,
    connectRequirements,
    connectStatus,
    connectUpdateDetails,
} from './stripe.connect.controller.js';

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

    it('echoes which field Stripe rejected instead of a bare 500', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: null,
            firstName: 'John',
            lastName: 'Smith',
            email: 'john@example.com',
            phone: null,
            dob: new Date('2018-07-11T00:00:00.000Z'),
        });
        const stripeError = Object.assign(new Error('Must be at least 13 years of age to use Stripe'), {
            type: 'StripeInvalidRequestError',
            param: 'individual[dob][year]',
        });
        mockCreateConnectAccountSession.mockRejectedValue(stripeError);

        const { req, res } = makeReqRes();
        await connectAccountSession(req, res);

        expect(mockSendError.mock.calls[0][1].error).toEqual({
            type: 'StripeInvalidRequestError',
            code: undefined,
            param: 'individual[dob][year]',
            message: 'Must be at least 13 years of age to use Stripe',
        });
    });
});

/**
 * These endpoints are the whole onboarding flow — the driver never reaches a Stripe-hosted page.
 * Each one has to resolve the account from the token alone, persist a newly created account id,
 * and hand the client back the outstanding requirements so it knows what to ask next.
 */
describe('custom onboarding endpoints', () => {
    const requirements = {
        accountId: 'acct_1',
        requirementCollection: 'application' as const,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        disabledReason: 'requirements.currently_due',
        currentDeadline: null,
        currentlyDue: ['external_account'],
        pastDue: [],
        eventuallyDue: [],
        pendingVerification: [],
        errors: [],
        termsAccepted: false,
        externalAccount: null,
    };

    const details = {
        firstName: 'John',
        lastName: 'Smith',
        email: 'john@example.com',
        phone: '+37255512345',
        dob: { day: 4, month: 3, year: 2000 },
        address: {
            line1: '12 Pikk',
            line2: null,
            city: 'Tallinn',
            postalCode: '10123',
            state: null,
            country: 'EE',
        },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.STRIPE_CONNECT_MOCK_MODE;
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: 'acct_1',
            firstName: 'John',
            lastName: 'Smith',
            email: 'john@example.com',
            phone: null,
            dob: null,
        });
        mockPrisma.user.update.mockResolvedValue(undefined);
        mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
        mockEnsureConnectedAccount.mockResolvedValue({ accountId: 'acct_1', created: false });
        mockGetConnectRequirements.mockResolvedValue(requirements);
        mockUpdatePersonalDetails.mockResolvedValue(requirements);
        mockAttachBankAccount.mockResolvedValue(requirements);
        mockDeleteBankAccount.mockResolvedValue(requirements);
        mockUploadConnectIdentityDocument.mockResolvedValue(requirements);
        mockAcceptTerms.mockResolvedValue(requirements);
    });

    it('returns the outstanding requirements for the caller’s account', async () => {
        const { req, res } = makeReqRes();
        await connectRequirements(req, res);

        expect(mockGetConnectRequirements).toHaveBeenCalledWith('acct_1');
        expect(mockSendSuccess.mock.calls[0][1].data).toEqual(requirements);
    });

    it('returns an actionable platform profile error when live Connect responsibilities are not reviewed', async () => {
        mockEnsureConnectedAccount.mockRejectedValue(
            Object.assign(
                new Error('Please review the responsibilities of collecting requirements for connected accounts at https://dashboard.stripe.com/settings/connect/platform-profile.'),
                { type: 'StripeInvalidRequestError' }
            )
        );

        const { req, res } = makeReqRes();
        await connectRequirements(req, res);

        expect(mockSendError.mock.calls[0][1]).toMatchObject({
            status: 'CONFLICT',
            error: {
                code: 'STRIPE_CONNECT_PLATFORM_PROFILE_REQUIRED',
                dashboardUrl: 'https://dashboard.stripe.com/settings/connect/platform-profile',
            },
        });
    });

    it('persists an account created on the first requirements call', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            stripeAccountId: null,
            firstName: 'John',
            lastName: 'Smith',
            email: 'john@example.com',
            phone: null,
            dob: null,
        });
        mockEnsureConnectedAccount.mockResolvedValue({ accountId: 'acct_new', created: true });

        const { req, res } = makeReqRes();
        await connectRequirements(req, res);

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { stripeAccountId: 'acct_new' },
        });
    });

    it('files the submitted details against the caller’s account', async () => {
        const { req, res } = makeReqRes();
        req.body = details;
        await connectUpdateDetails(req, res);

        expect(mockUpdatePersonalDetails).toHaveBeenCalledWith('acct_1', details);
        expect(mockSendSuccess.mock.calls[0][1].data).toEqual(requirements);
    });

    it('attaches the bank token to the caller’s account, ignoring any account id in the body', async () => {
        const { req, res } = makeReqRes();
        req.body = { token: 'btok_1abc', account: 'acct_notMine' };
        await connectBankAccount(req, res);

        expect(mockAttachBankAccount).toHaveBeenCalledWith('acct_1', 'btok_1abc');
    });

    it('removes the saved bank account from the caller account', async () => {
        mockDeleteBankAccount.mockResolvedValue({
            ...requirements,
            payoutsEnabled: false,
            currentlyDue: ['external_account'],
            externalAccount: null,
        });

        const { req, res } = makeReqRes();
        req.params = { externalAccountId: 'ba_1' };
        await connectDeleteBankAccount(req, res);

        expect(mockDeleteBankAccount).toHaveBeenCalledWith('acct_1', 'ba_1');
        expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
            where: { id: 'user-1', stripeOnboardingComplete: true },
            data: { stripeOnboardingComplete: false },
        });
        expect(mockSendSuccess.mock.calls[0][1].message).toBe('Bank account removed');
    });

    it('uploads an identity document for a platform-managed Connect account', async () => {
        const { req, res } = makeReqRes();
        req.body = Buffer.from('fake-document');
        req.query = { side: 'front' };
        req.get = (header: string) => {
            if (header === 'content-type') return 'image/jpeg';
            if (header === 'x-file-name') return 'passport-front.jpg';
            return undefined;
        };

        await connectIdentityDocument(req, res);

        expect(mockUploadConnectIdentityDocument).toHaveBeenCalledWith('acct_1', {
            file: Buffer.from('fake-document'),
            fileName: 'passport-front.jpg',
            contentType: 'image/jpeg',
            side: 'front',
        });
        expect(mockSendSuccess.mock.calls[0][1].message).toBe('Identity document uploaded');
    });

    it('records terms acceptance with the request IP and user agent', async () => {
        const { req, res } = makeReqRes();
        req.body = { accepted: true };
        req.ip = '81.90.1.2';
        req.get = (header: string) => (header === 'user-agent' ? 'Mozilla/5.0' : undefined);
        await connectAcceptTerms(req, res);

        expect(mockAcceptTerms).toHaveBeenCalledWith('acct_1', {
            ip: '81.90.1.2',
            userAgent: 'Mozilla/5.0',
        });
    });

    it('refuses to record acceptance when the IP is unknown', async () => {
        const { req, res } = makeReqRes();
        req.body = { accepted: true };
        req.ip = undefined;
        req.get = () => undefined;
        await connectAcceptTerms(req, res);

        expect(mockAcceptTerms).not.toHaveBeenCalled();
        expect(mockSendError.mock.calls[0][1].status).toBe('BAD_REQUEST');
    });

    it('marks onboarding complete once Stripe reports payouts are ready', async () => {
        mockAttachBankAccount.mockResolvedValue({
            ...requirements,
            detailsSubmitted: true,
            chargesEnabled: true,
            payoutsEnabled: true,
            currentlyDue: [],
        });

        const { req, res } = makeReqRes();
        req.body = { token: 'btok_1abc' };
        await connectBankAccount(req, res);

        expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
            where: { id: 'user-1', stripeOnboardingComplete: false },
            data: { stripeOnboardingComplete: true },
        });
    });

    it('leaves onboarding incomplete while requirements are outstanding', async () => {
        const { req, res } = makeReqRes();
        req.body = { token: 'btok_1abc' };
        await connectBankAccount(req, res);

        expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    });

    it('echoes the Stripe field error when filing details fails', async () => {
        mockUpdatePersonalDetails.mockRejectedValue(
            Object.assign(new Error('Invalid postal code'), {
                type: 'StripeInvalidRequestError',
                param: 'individual[address][postal_code]',
            })
        );

        const { req, res } = makeReqRes();
        req.body = details;
        await connectUpdateDetails(req, res);

        expect(mockSendError.mock.calls[0][1].error).toMatchObject({
            param: 'individual[address][postal_code]',
            message: 'Invalid postal code',
        });
    });
});
