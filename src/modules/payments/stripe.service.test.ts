/**
 * The platform answers Stripe's business questions on the driver's behalf. If these break, drivers
 * are asked to pick a business type and describe the product before they can add a bank account.
 */
const mockAccountsCreate = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockAccountsUpdate = jest.fn();
const mockAccountSessionsCreate = jest.fn();
const mockAccountLinksCreate = jest.fn();

const mockCreateExternalAccount = jest.fn();

jest.mock('stripe', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        accounts: {
            create: (...args: unknown[]) => mockAccountsCreate(...args),
            retrieve: (...args: unknown[]) => mockAccountsRetrieve(...args),
            update: (...args: unknown[]) => mockAccountsUpdate(...args),
            createExternalAccount: (...args: unknown[]) => mockCreateExternalAccount(...args),
        },
        accountSessions: {
            create: (...args: unknown[]) => mockAccountSessionsCreate(...args),
        },
        accountLinks: {
            create: (...args: unknown[]) => mockAccountLinksCreate(...args),
        },
    })),
}));

import {
    acceptConnectTerms,
    attachConnectBankAccount,
    createConnectAccountSession,
    createConnectOnboardingLink,
    ensureConnectedAccount,
    getConnectRequirements,
    updateConnectPersonalDetails,
} from './stripe.service.js';

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

    /**
     * Prefill is a convenience: Stripe collects anything we leave out during onboarding. A profile
     * value Stripe rejects must therefore be dropped, never forwarded — forwarding it fails
     * accounts.create and the driver cannot reach payout setup at all.
     */
    describe('prefill sanitising', () => {
        const individualOf = () => mockAccountsCreate.mock.calls[0][0].individual;

        it('drops a dob below Stripe’s minimum age instead of failing the call', async () => {
            await createConnectAccountSession('user-1', null, {
                ...prefill,
                dob: new Date('2018-07-11T00:00:00.000Z'),
            });

            expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
            expect(individualOf().dob).toBeUndefined();
            expect(individualOf().first_name).toBe('John');
        });

        it('drops a dob in the future', async () => {
            const future = new Date(Date.now() + 86_400_000);

            await createConnectAccountSession('user-1', null, { ...prefill, dob: future });

            expect(individualOf().dob).toBeUndefined();
        });

        it('keeps a dob exactly on the minimum age boundary', async () => {
            const thirteenToday = new Date();
            thirteenToday.setUTCFullYear(thirteenToday.getUTCFullYear() - 13);

            await createConnectAccountSession('user-1', null, { ...prefill, dob: thirteenToday });

            expect(individualOf().dob).toEqual({
                day: thirteenToday.getUTCDate(),
                month: thirteenToday.getUTCMonth() + 1,
                year: thirteenToday.getUTCFullYear(),
            });
        });

        it('drops a phone that is not in E.164 form', async () => {
            await createConnectAccountSession('user-1', null, { ...prefill, phone: '9675123456' });

            expect(individualOf().phone).toBeUndefined();
        });

        it('normalises spacing in an otherwise valid phone', async () => {
            await createConnectAccountSession('user-1', null, {
                ...prefill,
                phone: '+44 1234 567 890',
            });

            expect(individualOf().phone).toBe('+441234567890');
        });

        it('drops blank names and a malformed email', async () => {
            await createConnectAccountSession('user-1', null, {
                firstName: '   ',
                lastName: 'Smith',
                email: 'not-an-email',
                phone: null,
                dob: null,
            });

            const params = mockAccountsCreate.mock.calls[0][0];
            expect(params.individual.first_name).toBeUndefined();
            expect(params.individual.last_name).toBe('Smith');
            expect(params.individual.email).toBeUndefined();
            expect(params.email).toBeUndefined();
        });
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

/**
 * The driver never sees a Stripe-hosted screen: the platform collects every requirement in its own
 * form and files it through these calls. If they regress, onboarding has no fallback UI to land on.
 */
describe('custom onboarding', () => {
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

    const accountWithRequirements = {
        id: 'acct_1',
        controller: { requirement_collection: 'application' },
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        tos_acceptance: { date: null },
        requirements: {
            disabled_reason: 'requirements.past_due',
            current_deadline: 1893456000,
            currently_due: ['individual.address.city', 'external_account'],
            past_due: ['individual.address.city'],
            eventually_due: ['individual.verification.document'],
            pending_verification: [],
            errors: [
                {
                    requirement: 'individual.address.city',
                    code: 'invalid_value_other',
                    reason: 'City is not recognised',
                },
            ],
        },
        external_accounts: { data: [] },
    };

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
        process.env.STRIPE_CONNECT_COUNTRY = 'EE';
        mockAccountsCreate.mockResolvedValue({ id: 'acct_new' });
        mockAccountsRetrieve.mockResolvedValue(accountWithRequirements);
        mockAccountsUpdate.mockResolvedValue(accountWithRequirements);
        mockCreateExternalAccount.mockResolvedValue({ id: 'ba_1' });
    });

    it('reuses an existing account and only creates one when there is none', async () => {
        expect(await ensureConnectedAccount('user-1', 'acct_existing')).toEqual({
            accountId: 'acct_existing',
            created: false,
        });
        expect(mockAccountsCreate).not.toHaveBeenCalled();

        expect(await ensureConnectedAccount('user-1', null)).toEqual({
            accountId: 'acct_new',
            created: true,
        });
        expect(mockAccountsCreate).toHaveBeenCalledTimes(1);
    });

    it('reports what Stripe still needs so the UI knows which step to render', async () => {
        const requirements = await getConnectRequirements('acct_1');

        expect(requirements).toMatchObject({
            accountId: 'acct_1',
            requirementCollection: 'application',
            disabledReason: 'requirements.past_due',
            currentlyDue: ['individual.address.city', 'external_account'],
            pastDue: ['individual.address.city'],
            eventuallyDue: ['individual.verification.document'],
            termsAccepted: false,
            externalAccount: null,
        });
        expect(requirements.errors).toEqual([
            {
                requirement: 'individual.address.city',
                code: 'invalid_value_other',
                reason: 'City is not recognised',
            },
        ]);
    });

    it('files the personal details collected in our own form', async () => {
        await updateConnectPersonalDetails('acct_1', details);

        const [accountId, params] = mockAccountsUpdate.mock.calls[0];
        expect(accountId).toBe('acct_1');
        expect(params.individual).toMatchObject({
            first_name: 'John',
            last_name: 'Smith',
            phone: '+37255512345',
            dob: { day: 4, month: 3, year: 2000 },
            address: {
                line1: '12 Pikk',
                city: 'Tallinn',
                postal_code: '10123',
                country: 'EE',
            },
        });
        expect(params.individual.address.line2).toBeUndefined();
    });

    it('drops a phone the profile stored in a local format rather than failing the update', async () => {
        await updateConnectPersonalDetails('acct_1', { ...details, phone: '55512345' });

        expect(mockAccountsUpdate.mock.calls[0][1].individual.phone).toBeUndefined();
    });

    it('attaches a bank account from a Stripe.js token and makes it the payout default', async () => {
        await attachConnectBankAccount('acct_1', 'btok_1abc');

        expect(mockCreateExternalAccount).toHaveBeenCalledWith('acct_1', {
            external_account: 'btok_1abc',
            default_for_currency: true,
        });
    });

    it('surfaces an attached bank account without exposing full account numbers', async () => {
        mockAccountsRetrieve.mockResolvedValue({
            ...accountWithRequirements,
            external_accounts: {
                data: [
                    {
                        object: 'bank_account',
                        id: 'ba_1',
                        bank_name: 'LHV Pank',
                        last4: '3456',
                        currency: 'eur',
                        country: 'EE',
                        default_for_currency: true,
                    },
                ],
            },
        });

        const requirements = await getConnectRequirements('acct_1');

        expect(requirements.externalAccount).toEqual({
            id: 'ba_1',
            bankName: 'LHV Pank',
            last4: '3456',
            currency: 'eur',
            country: 'EE',
            defaultForCurrency: true,
        });
    });

    it('records terms acceptance with the date and the accepting IP', async () => {
        const before = Math.floor(Date.now() / 1000);

        await acceptConnectTerms('acct_1', { ip: '81.90.1.2', userAgent: 'Mozilla/5.0' });

        const params = mockAccountsUpdate.mock.calls[0][1];
        expect(params.tos_acceptance.ip).toBe('81.90.1.2');
        expect(params.tos_acceptance.user_agent).toBe('Mozilla/5.0');
        expect(params.tos_acceptance.date).toBeGreaterThanOrEqual(before);
    });
});
