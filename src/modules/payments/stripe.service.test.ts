/**
 * The platform answers Stripe's business questions on the driver's behalf. If these break, drivers
 * are asked to pick a business type and describe the product before they can add a bank account.
 */
const mockAccountsCreate = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockAccountsUpdate = jest.fn();
const mockAccountSessionsCreate = jest.fn();
const mockAccountLinksCreate = jest.fn();

jest.mock('stripe', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        accounts: {
            create: (...args: unknown[]) => mockAccountsCreate(...args),
            retrieve: (...args: unknown[]) => mockAccountsRetrieve(...args),
            update: (...args: unknown[]) => mockAccountsUpdate(...args),
        },
        accountSessions: {
            create: (...args: unknown[]) => mockAccountSessionsCreate(...args),
        },
        accountLinks: {
            create: (...args: unknown[]) => mockAccountLinksCreate(...args),
        },
    })),
}));

import { createConnectAccountSession, createConnectOnboardingLink } from './stripe.service.js';

const prefill = {
    firstName: 'John',
    lastName: 'Smith',
    email: 'john@example.com',
    phone: '+441234567890',
    dob: new Date('1990-05-15T00:00:00.000Z'),
};

const controllerAccount = {
    id: 'acct_new',
    controller: { requirement_collection: 'application' },
    business_type: 'individual',
    business_profile: { mcc: '4121', product_description: 'Shared car journeys' },
};

describe('connected account creation', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        process.env.STRIPE_CONNECT_COUNTRY = 'EE';
        delete process.env.STRIPE_CONNECT_MCC;
        delete process.env.STRIPE_CONNECT_PRODUCT_DESCRIPTION;

        mockAccountsCreate.mockResolvedValue({ id: 'acct_new' });
        mockAccountsRetrieve.mockResolvedValue(controllerAccount);
        mockAccountSessionsCreate.mockResolvedValue({
            client_secret: 'accsess_secret',
            expires_at: 1893456000,
        });
        mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/x' });
    });

    it('answers the business questions so onboarding only asks for identity and a bank account', async () => {
        await createConnectAccountSession('user-1', null, prefill);

        const params = mockAccountsCreate.mock.calls[0][0];
        expect(params.business_type).toBe('individual');
        expect(params.business_profile.mcc).toBe('4121');
        expect(typeof params.business_profile.product_description).toBe('string');
        expect(params.business_profile.product_description.length).toBeGreaterThan(0);
        expect(params.controller.requirement_collection).toBe('application');
        expect(params.country).toBe('EE');
    });

    it('prefills the individual from the profile', async () => {
        await createConnectAccountSession('user-1', null, prefill);

        const params = mockAccountsCreate.mock.calls[0][0];
        expect(params.individual).toMatchObject({
            first_name: 'John',
            last_name: 'Smith',
            email: 'john@example.com',
            phone: '+441234567890',
            dob: { day: 15, month: 5, year: 1990 },
        });
        expect(params.metadata).toEqual({ userId: 'user-1' });
    });

    it('omits dob when the profile has none', async () => {
        await createConnectAccountSession('user-1', null, { ...prefill, dob: null });

        expect(mockAccountsCreate.mock.calls[0][0].individual.dob).toBeUndefined();
    });

    it('lets env override the industry and product description', async () => {
        process.env.STRIPE_CONNECT_MCC = '4789';
        process.env.STRIPE_CONNECT_PRODUCT_DESCRIPTION = 'Carpooling';

        await createConnectAccountSession('user-1', null, prefill);

        expect(mockAccountsCreate.mock.calls[0][0].business_profile).toMatchObject({
            mcc: '4789',
            product_description: 'Carpooling',
        });
    });

    it('reuses an existing account and never mutates it', async () => {
        const result = await createConnectAccountSession('user-1', 'acct_existing', prefill);

        expect(mockAccountsCreate).not.toHaveBeenCalled();
        expect(mockAccountsUpdate).not.toHaveBeenCalled();
        expect(mockAccountsRetrieve).toHaveBeenCalledWith('acct_existing');
        expect(result).toEqual({
            accountId: 'acct_existing',
            clientSecret: 'accsess_secret',
            expiresAt: 1893456000,
            requirementCollection: 'application',
        });
    });

    it('collects the bank account in the embedded component', async () => {
        await createConnectAccountSession('user-1', 'acct_existing', prefill);

        const features =
            mockAccountSessionsCreate.mock.calls[0][0].components.account_onboarding.features;
        expect(features.external_account_collection).toBe(true);
        expect(features.disable_stripe_user_authentication).toBe(true);
    });

    it('keeps Stripe authentication on legacy Express accounts', async () => {
        mockAccountsRetrieve.mockResolvedValue({ id: 'acct_legacy', controller: undefined });

        const result = await createConnectAccountSession('user-1', 'acct_legacy', prefill);

        expect(result.requirementCollection).toBe('stripe');
        const features =
            mockAccountSessionsCreate.mock.calls[0][0].components.account_onboarding.features;
        expect(features.disable_stripe_user_authentication).toBeUndefined();
    });

    it('creates the same prefilled account from the hosted onboarding path', async () => {
        await createConnectOnboardingLink(
            'user-1',
            null,
            'https://app.example.com/return',
            'https://app.example.com/refresh',
            prefill
        );

        expect(mockAccountsCreate.mock.calls[0][0].business_type).toBe('individual');
        expect(mockAccountLinksCreate).toHaveBeenCalledWith({
            account: 'acct_new',
            return_url: 'https://app.example.com/return',
            refresh_url: 'https://app.example.com/refresh',
            type: 'account_onboarding',
        });
    });
});
