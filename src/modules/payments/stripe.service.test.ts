/**
 * The platform answers Stripe's business questions on the driver's behalf. If these break, drivers
 * are asked to pick a business type and describe the product before they can add a bank account.
 */
const mockV2AccountsCreate = jest.fn();
const mockAccountsRetrieve = jest.fn();
const mockAccountsUpdate = jest.fn();
const mockAccountsDel = jest.fn();
const mockAccountSessionsCreate = jest.fn();
const mockAccountLinksCreate = jest.fn();
const mockFilesCreate = jest.fn();

const mockCreateExternalAccount = jest.fn();
const mockUpdateExternalAccount = jest.fn();
const mockDeleteExternalAccount = jest.fn();

jest.mock('stripe', () => ({
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
        // Account creation is the only call on the v2 Core Accounts API; everything else below
        // still runs on v1, which accepts the v2 account id.
        v2: {
            core: {
                accounts: {
                    create: (...args: unknown[]) => mockV2AccountsCreate(...args),
                },
            },
        },
        accounts: {
            retrieve: (...args: unknown[]) => mockAccountsRetrieve(...args),
            update: (...args: unknown[]) => mockAccountsUpdate(...args),
            del: (...args: unknown[]) => mockAccountsDel(...args),
            createExternalAccount: (...args: unknown[]) => mockCreateExternalAccount(...args),
            updateExternalAccount: (...args: unknown[]) => mockUpdateExternalAccount(...args),
            deleteExternalAccount: (...args: unknown[]) => mockDeleteExternalAccount(...args),
        },
        accountSessions: {
            create: (...args: unknown[]) => mockAccountSessionsCreate(...args),
        },
        accountLinks: {
            create: (...args: unknown[]) => mockAccountLinksCreate(...args),
        },
        files: {
            create: (...args: unknown[]) => mockFilesCreate(...args),
        },
    })),
}));

import {
    acceptConnectTerms,
    attachConnectBankAccount,
    createConnectAccountSession,
    createConnectOnboardingLink,
    deleteConnectBankAccount,
    ensureConnectedAccount,
    getConnectRequirements,
    resetUnfinishedConnectAccount,
    updateConnectPersonalDetails,
    uploadConnectIdentityDocument,
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

        mockV2AccountsCreate.mockResolvedValue({ id: 'acct_new' });
        mockAccountsRetrieve.mockResolvedValue(controllerAccount);
        mockAccountsUpdate.mockResolvedValue(controllerAccount);
        mockAccountsDel.mockResolvedValue({ id: 'acct_1', deleted: true });
        mockFilesCreate.mockResolvedValue({ id: 'file_identity_front' });
        mockAccountSessionsCreate.mockResolvedValue({
            client_secret: 'accsess_secret',
            expires_at: 1893456000,
        });
        mockAccountLinksCreate.mockResolvedValue({ url: 'https://connect.stripe.com/setup/e/x' });
    });

    it('creates a recipient-configuration account the platform collects requirements for', async () => {
        await createConnectAccountSession('user-1', null, prefill);

        const params = mockV2AccountsCreate.mock.calls[0][0];
        expect(params.identity.entity_type).toBe('individual');
        expect(params.identity.country).toBe('EE');
        expect(params.dashboard).toBe('none');
        expect(params.configuration.recipient.capabilities.stripe_balance.stripe_transfers).toEqual({
            requested: true,
        });
        expect(params.defaults.responsibilities).toEqual({
            fees_collector: 'application',
            losses_collector: 'application',
        });
    });

    /**
     * v2 create has no `business_profile`, so it is patched straight after through v1 — Stripe
     * wants the URL and product description before it will enable payouts.
     */
    it('answers the business questions so onboarding only asks for identity and a bank account', async () => {
        await createConnectAccountSession('user-1', null, prefill);

        const [accountId, params] = mockAccountsUpdate.mock.calls[0];
        expect(accountId).toBe('acct_new');
        expect(params.business_profile.mcc).toBe('4121');
        expect(typeof params.business_profile.product_description).toBe('string');
        expect(params.business_profile.product_description.length).toBeGreaterThan(0);
    });

    it('uses the selected payout country when creating a connected account', async () => {
        await createConnectAccountSession('user-1', null, { ...prefill, country: 'DE' });

        expect(mockV2AccountsCreate.mock.calls[0][0].identity.country).toBe('DE');
    });

    it('rejects unsupported selected payout countries before calling Stripe', async () => {
        await expect(
            createConnectAccountSession('user-1', null, { ...prefill, country: 'US' })
        ).rejects.toThrow('CONNECT_COUNTRY_UNSUPPORTED');

        expect(mockV2AccountsCreate).not.toHaveBeenCalled();
    });

    it('prefills the individual from the profile', async () => {
        await createConnectAccountSession('user-1', null, prefill);

        const params = mockV2AccountsCreate.mock.calls[0][0];
        expect(params.identity.individual).toMatchObject({
            given_name: 'John',
            surname: 'Smith',
            email: 'john@example.com',
            phone: '+441234567890',
            date_of_birth: { day: 15, month: 5, year: 1990 },
        });
        expect(params.metadata).toEqual({ userId: 'user-1' });
    });

    it('omits dob when the profile has none', async () => {
        await createConnectAccountSession('user-1', null, { ...prefill, dob: null });

        expect(
            mockV2AccountsCreate.mock.calls[0][0].identity.individual.date_of_birth
        ).toBeUndefined();
    });

    /**
     * Prefill is a convenience: Stripe collects anything we leave out during onboarding. A profile
     * value Stripe rejects must therefore be dropped, never forwarded — forwarding it fails
     * accounts.create and the driver cannot reach payout setup at all.
     */
    describe('prefill sanitising', () => {
        const individualOf = () => mockV2AccountsCreate.mock.calls[0][0].identity.individual;

        it('drops a dob below Stripe’s minimum age instead of failing the call', async () => {
            await createConnectAccountSession('user-1', null, {
                ...prefill,
                dob: new Date('2018-07-11T00:00:00.000Z'),
            });

            expect(mockV2AccountsCreate).toHaveBeenCalledTimes(1);
            expect(individualOf().date_of_birth).toBeUndefined();
            expect(individualOf().given_name).toBe('John');
        });

        it('drops a dob in the future', async () => {
            const future = new Date(Date.now() + 86_400_000);

            await createConnectAccountSession('user-1', null, { ...prefill, dob: future });

            expect(individualOf().date_of_birth).toBeUndefined();
        });

        it('keeps a dob exactly on the minimum age boundary', async () => {
            const thirteenToday = new Date();
            thirteenToday.setUTCFullYear(thirteenToday.getUTCFullYear() - 13);

            await createConnectAccountSession('user-1', null, { ...prefill, dob: thirteenToday });

            expect(individualOf().date_of_birth).toEqual({
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

            const params = mockV2AccountsCreate.mock.calls[0][0];
            expect(params.identity.individual.given_name).toBeUndefined();
            expect(params.identity.individual.surname).toBe('Smith');
            expect(params.identity.individual.email).toBeUndefined();
            expect(params.contact_email).toBeUndefined();
        });
    });

    it('lets env override the industry and product description', async () => {
        process.env.STRIPE_CONNECT_MCC = '4789';
        process.env.STRIPE_CONNECT_PRODUCT_DESCRIPTION = 'Carpooling';

        await createConnectAccountSession('user-1', null, prefill);

        expect(mockAccountsUpdate.mock.calls[0][1].business_profile).toMatchObject({
            mcc: '4789',
            product_description: 'Carpooling',
        });
    });

    it('reuses an existing account and never mutates it', async () => {
        const result = await createConnectAccountSession('user-1', 'acct_existing', prefill);

        expect(mockV2AccountsCreate).not.toHaveBeenCalled();
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

        expect(mockV2AccountsCreate.mock.calls[0][0].identity.entity_type).toBe('individual');
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
        country: 'DE',
        default_currency: 'eur',
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
        mockV2AccountsCreate.mockResolvedValue({ id: 'acct_new' });
        mockAccountsRetrieve.mockResolvedValue(accountWithRequirements);
        mockAccountsUpdate.mockResolvedValue(accountWithRequirements);
        mockCreateExternalAccount.mockResolvedValue({ id: 'ba_1' });
    });

    it('reuses an existing account and only creates one when there is none', async () => {
        expect(await ensureConnectedAccount('user-1', 'acct_existing')).toEqual({
            accountId: 'acct_existing',
            created: false,
        });
        expect(mockV2AccountsCreate).not.toHaveBeenCalled();

        expect(await ensureConnectedAccount('user-1', null)).toEqual({
            accountId: 'acct_new',
            created: true,
        });
        expect(mockV2AccountsCreate).toHaveBeenCalledTimes(1);
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

    it('reports the account country and payout currency the client must collect against', async () => {
        const requirements = await getConnectRequirements('acct_1');

        expect(requirements.country).toBe('DE');
        expect(requirements.defaultCurrency).toBe('eur');
    });

    it('deletes an unfinished platform-managed account so the country can be chosen again', async () => {
        await resetUnfinishedConnectAccount('acct_1');

        expect(mockAccountsDel).toHaveBeenCalledWith('acct_1');
    });

    it('refuses to reset an account that already has a bank account', async () => {
        mockAccountsRetrieve.mockResolvedValue({
            ...accountWithRequirements,
            external_accounts: { data: [{ object: 'bank_account', id: 'ba_1' }] },
        });

        await expect(resetUnfinishedConnectAccount('acct_1')).rejects.toThrow('CONNECT_ACCOUNT_RESET_BLOCKED');
        expect(mockAccountsDel).not.toHaveBeenCalled();
    });

    it('refuses to reset an account after terms are accepted', async () => {
        mockAccountsRetrieve.mockResolvedValue({
            ...accountWithRequirements,
            tos_acceptance: { date: 1893456000 },
        });

        await expect(resetUnfinishedConnectAccount('acct_1')).rejects.toThrow('CONNECT_ACCOUNT_RESET_BLOCKED');
        expect(mockAccountsDel).not.toHaveBeenCalled();
    });

    /**
     * Stripe fixes an account's country at creation — a platform enabled for one country gets
     * that country whatever it configured — and then rejects an address from anywhere else with
     * `account_country_invalid_address`.
     */
    it('files the address against the account country, not the submitted one', async () => {
        await updateConnectPersonalDetails('acct_1', {
            ...details,
            address: { ...details.address, country: 'EE' },
        });

        expect(mockAccountsUpdate.mock.calls[0][1].individual.address.country).toBe('DE');
    });

    it('falls back to the submitted country when Stripe reports none', async () => {
        mockAccountsRetrieve.mockResolvedValue({ ...accountWithRequirements, country: undefined });

        await updateConnectPersonalDetails('acct_1', details);

        expect(mockAccountsUpdate.mock.calls[0][1].individual.address.country).toBe('EE');
    });

    /**
     * Accounts opened before the platform took over requirement collection are Stripe's to own.
     * Writing to one comes back as an opaque StripePermissionError, so they are refused up front
     * with a code the client can act on.
     */
    describe('accounts Stripe collects requirements for', () => {
        beforeEach(() => {
            mockAccountsRetrieve.mockResolvedValue({
                ...accountWithRequirements,
                controller: { requirement_collection: 'stripe' },
            });
        });

        it('refuses to file details', async () => {
            await expect(updateConnectPersonalDetails('acct_1', details)).rejects.toThrow(
                'CONNECT_ACCOUNT_NOT_EDITABLE'
            );
            expect(mockAccountsUpdate).not.toHaveBeenCalled();
        });

        it('refuses to attach a bank account', async () => {
            await expect(attachConnectBankAccount('acct_1', 'btok_1abc')).rejects.toThrow(
                'CONNECT_ACCOUNT_NOT_EDITABLE'
            );
            expect(mockCreateExternalAccount).not.toHaveBeenCalled();
        });

        it('refuses to remove a bank account', async () => {
            await expect(deleteConnectBankAccount('acct_1', 'ba_1')).rejects.toThrow(
                'CONNECT_ACCOUNT_NOT_EDITABLE'
            );
            expect(mockDeleteExternalAccount).not.toHaveBeenCalled();
        });

        it('refuses to record terms acceptance', async () => {
            await expect(acceptConnectTerms('acct_1', { ip: '81.90.1.2' })).rejects.toThrow(
                'CONNECT_ACCOUNT_NOT_EDITABLE'
            );
            expect(mockAccountsUpdate).not.toHaveBeenCalled();
        });

        it('still reports their requirements, so the client can offer the Stripe flow', async () => {
            const requirements = await getConnectRequirements('acct_1');

            expect(requirements.requirementCollection).toBe('stripe');
        });
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
                // The account's country, not the one submitted with the form.
                country: 'DE',
            },
        });
        expect(params.individual.address.line2).toBeUndefined();
        expect(params.individual.address.country).toBe('DE');
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

    describe('removing a bank payout account', () => {
        const withBankAccounts = (
            data: Array<Record<string, unknown>>
        ) => mockAccountsRetrieve.mockResolvedValue({
            ...accountWithRequirements,
            external_accounts: { data },
        });

        it('promotes the remaining account to default before removing the current one', async () => {
            withBankAccounts([
                { object: 'bank_account', id: 'ba_1', default_for_currency: true },
                { object: 'bank_account', id: 'ba_2', default_for_currency: false },
            ]);

            await deleteConnectBankAccount('acct_1', 'ba_1');

            expect(mockUpdateExternalAccount).toHaveBeenCalledWith('acct_1', 'ba_2', {
                default_for_currency: true,
            });
            expect(mockDeleteExternalAccount).toHaveBeenCalledWith('acct_1', 'ba_1');
        });

        /** Stripe refuses the delete itself; failing early gives the driver a message to act on. */
        it('refuses to remove the only bank account', async () => {
            withBankAccounts([{ object: 'bank_account', id: 'ba_1', default_for_currency: true }]);

            await expect(deleteConnectBankAccount('acct_1', 'ba_1')).rejects.toThrow(
                'CONNECT_CANNOT_DELETE_ONLY_BANK_ACCOUNT'
            );
            expect(mockDeleteExternalAccount).not.toHaveBeenCalled();
        });

        it('is a no-op when the bank account is already gone', async () => {
            withBankAccounts([]);

            await deleteConnectBankAccount('acct_1', 'ba_missing');

            expect(mockDeleteExternalAccount).not.toHaveBeenCalled();
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

    it('uploads an identity document to Stripe Files and attaches it to the account', async () => {
        await uploadConnectIdentityDocument('acct_1', {
            file: Buffer.from('fake-image'),
            fileName: 'passport-front.jpg',
            contentType: 'image/jpeg',
            side: 'front',
        });

        expect(mockFilesCreate).toHaveBeenCalledWith({
            purpose: 'identity_document',
            file: {
                data: Buffer.from('fake-image'),
                name: 'passport-front.jpg',
                type: 'image/jpeg',
            },
        });
        expect(mockAccountsUpdate).toHaveBeenCalledWith('acct_1', {
            individual: {
                verification: {
                    document: {
                        front: 'file_identity_front',
                    },
                },
            },
        });
    });
});
