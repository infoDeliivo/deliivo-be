// @ts-ignore — stripe v21 types bundled via package exports; not resolved by "Node" moduleResolution
import Stripe from 'stripe';
import { STRIPE_CURRENCY_DEFAULT, STRIPE_METADATA_KEYS } from './stripe.constants.js';
import {
    ConnectAccountPrefill,
    ConnectAccountSessionResult,
    ConnectAccountStatus,
    ConnectExternalAccount,
    ConnectIdentityDocumentUpload,
    ConnectPersonalDetails,
    ConnectRequirementCollection,
    ConnectRequirements,
    CreatePaymentIntentInput,
    CreatePaymentIntentResult,
} from './stripe.types.js';

let stripeClient: Stripe | null = null;

const toMinorUnits = (amountMajor: number): number => {
    if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
        throw new Error('INVALID_PAYMENT_AMOUNT');
    }

    return Math.round(amountMajor * 100);
};

const getStripeSecretKey = (): string => {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error('STRIPE_SECRET_KEY_MISSING');
    }

    return secretKey;
};

const getStripeWebhookSecret = (): string => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) {
        throw new Error('STRIPE_WEBHOOK_SECRET_MISSING');
    }

    return webhookSecret;
};

export const getStripeClient = (): Stripe => {
    if (!stripeClient) {
        stripeClient = new Stripe(getStripeSecretKey());
    }

    return stripeClient;
};

/**
 * Stripe collects an industry + product description for every connected account, individuals
 * included — that is the "Professional details / Business information" step drivers otherwise see.
 * The platform knows the answer (drivers all sell the same thing), so we send it up front and the
 * driver is left with identity details and a bank account. MCC 4121 = Taxicabs and Limousines, the
 * closest code for ridesharing.
 */
const buildBusinessProfile = (): Stripe.AccountCreateParams.BusinessProfile => ({
    mcc: process.env.STRIPE_CONNECT_MCC || '4121',
    product_description:
        process.env.STRIPE_CONNECT_PRODUCT_DESCRIPTION ||
        'Shared car journeys — the driver carries passengers on a route they are already taking and receives a share of the trip cost.',
    url: process.env.APP_BASE_URL || undefined,
});

/** Stripe rejects an account holder younger than this outright. */
const STRIPE_MINIMUM_AGE_YEARS = 13;

const cleanText = (value: string | null | undefined): string | undefined => {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
};

/** Stripe validates the address shape; a malformed one fails account creation. */
const cleanEmail = (value: string | null | undefined): string | undefined => {
    const email = cleanText(value);
    return email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined;
};

/** Stripe requires E.164. Profiles hold whatever the signup form accepted, so verify, don't assume. */
const cleanPhone = (value: string | null | undefined): string | undefined => {
    const phone = cleanText(value)?.replace(/[\s()-]/g, '');
    return phone && /^\+[1-9]\d{6,14}$/.test(phone) ? phone : undefined;
};

/**
 * Prefill is a convenience — Stripe collects during onboarding whatever we leave out. So a profile
 * value Stripe would reject has to be dropped, not forwarded: forwarding it fails accounts.create
 * and the driver cannot open payout setup at all. A dob under Stripe's minimum age (a mistyped
 * birth year, say) used to do exactly that.
 */
const cleanDob = (
    value: Date | null | undefined
): { day: number; month: number; year: number } | undefined => {
    if (!value) return undefined;

    const dob = new Date(value);
    if (Number.isNaN(dob.getTime())) return undefined;

    const minimumAgeCutoff = new Date();
    minimumAgeCutoff.setUTCFullYear(minimumAgeCutoff.getUTCFullYear() - STRIPE_MINIMUM_AGE_YEARS);
    // Compare on the date alone: a dob stored at midnight UTC is otherwise "younger" than a cutoff
    // carrying the current time of day, which would drop a driver who turns 13 today.
    if (dob.setUTCHours(0, 0, 0, 0) > minimumAgeCutoff.setUTCHours(0, 0, 0, 0)) return undefined;

    return { day: dob.getUTCDate(), month: dob.getUTCMonth() + 1, year: dob.getUTCFullYear() };
};

/**
 * Accounts we create are controller-based (`requirement_collection: 'application'`) so onboarding
 * can render fully white-label inside our own UI. Accounts created before that switch are Express
 * (`'stripe'`) and are not convertible — Stripe still authenticates those users inside the frame.
 */
const createConnectedAccount = async (
    userId: string,
    prefill: ConnectAccountPrefill
): Promise<string> => {
    const stripe = getStripeClient();
    const email = cleanEmail(prefill.email);

    const account = await stripe.accounts.create({
        country: process.env.STRIPE_CONNECT_COUNTRY || undefined,
        controller: {
            stripe_dashboard: { type: 'none' },
            fees: { payer: 'application' },
            losses: { payments: 'application' },
            requirement_collection: 'application',
        },
        business_type: 'individual',
        business_profile: buildBusinessProfile(),
        capabilities: {
            transfers: { requested: true },
        },
        email,
        individual: {
            first_name: cleanText(prefill.firstName),
            last_name: cleanText(prefill.lastName),
            email,
            phone: cleanPhone(prefill.phone),
            dob: cleanDob(prefill.dob),
        },
        metadata: { userId },
    });

    return account.id;
};

/**
 * Returns the driver's connected account, creating it on first use. The custom onboarding flow
 * needs an account before it can file any detail, so every entry point resolves through here
 * rather than each one duplicating the create-then-persist dance.
 */
export const ensureConnectedAccount = async (
    userId: string,
    stripeAccountId: string | null,
    prefill: ConnectAccountPrefill = {}
): Promise<{ accountId: string; created: boolean }> => {
    if (stripeAccountId) return { accountId: stripeAccountId, created: false };

    return { accountId: await createConnectedAccount(userId, prefill), created: true };
};

const readRequirementCollection = (account: Stripe.Account): ConnectRequirementCollection =>
    account.controller?.requirement_collection === 'application' ? 'application' : 'stripe';

/**
 * Mints a short-lived AccountSession for the embedded onboarding component. Connect refetches the
 * secret whenever it expires, so this must always create a fresh session — never cache one.
 */
export const createConnectAccountSession = async (
    userId: string,
    stripeAccountId: string | null,
    prefill: ConnectAccountPrefill = {}
): Promise<ConnectAccountSessionResult> => {
    const stripe = getStripeClient();

    const accountId = stripeAccountId ?? (await createConnectedAccount(userId, prefill));
    const account = await stripe.accounts.retrieve(accountId);
    const requirementCollection = readRequirementCollection(account);

    const session = await stripe.accountSessions.create({
        account: accountId,
        components: {
            account_onboarding: {
                enabled: true,
                features: {
                    external_account_collection: true,
                    // Only permitted on controller-based accounts; Express accounts keep the
                    // Stripe-hosted authentication step inside the embedded frame.
                    ...(requirementCollection === 'application'
                        ? { disable_stripe_user_authentication: true }
                        : {}),
                },
            },
        },
    });

    return {
        accountId,
        clientSecret: session.client_secret,
        expiresAt: session.expires_at,
        requirementCollection,
    };
};

const toExternalAccount = (account: Stripe.Account): ConnectExternalAccount | null => {
    const bank = account.external_accounts?.data?.find(
        (entry): entry is Stripe.BankAccount => entry.object === 'bank_account'
    );
    if (!bank) return null;

    return {
        id: bank.id,
        bankName: bank.bank_name ?? null,
        last4: bank.last4 ?? null,
        currency: bank.currency ?? null,
        country: bank.country ?? null,
        defaultForCurrency: bank.default_for_currency ?? false,
    };
};

const toRequirements = (account: Stripe.Account): ConnectRequirements => {
    const requirements = account.requirements;

    return {
        accountId: account.id,
        requirementCollection: readRequirementCollection(account),
        country: account.country ?? null,
        defaultCurrency: account.default_currency ?? null,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        disabledReason: requirements?.disabled_reason ?? null,
        currentDeadline: requirements?.current_deadline ?? null,
        currentlyDue: requirements?.currently_due ?? [],
        pastDue: requirements?.past_due ?? [],
        eventuallyDue: requirements?.eventually_due ?? [],
        pendingVerification: requirements?.pending_verification ?? [],
        errors: (requirements?.errors ?? []).map((issue) => ({
            requirement: issue.requirement,
            code: issue.code,
            reason: issue.reason,
        })),
        termsAccepted: Boolean(account.tos_acceptance?.date),
        externalAccount: toExternalAccount(account),
    };
};

/**
 * Accounts created before the platform took over requirement collection are Stripe's to own, and
 * are not convertible. Refusing them up front turns an opaque `StripePermissionError` into a code
 * the client can act on by falling back to Stripe's own onboarding.
 */
const assertAccountIsPlatformCollected = async (accountId: string): Promise<void> => {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(accountId);

    if (readRequirementCollection(account) !== 'application') {
        throw new Error('CONNECT_ACCOUNT_NOT_EDITABLE');
    }
};

/**
 * What Stripe still wants before payouts run. On controller-based accounts nothing is collected by
 * Stripe, so this list is what the custom onboarding UI renders — there is no hosted screen to fall
 * back on if we guess the fields ourselves.
 */
export const getConnectRequirements = async (accountId: string): Promise<ConnectRequirements> => {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(accountId);

    return toRequirements(account);
};

/**
 * Files the identity details the platform collected in its own form.
 *
 * Two things are taken from the account rather than from the request:
 *
 * - The address country. Stripe fixes an account's country at creation — and a platform enabled
 *   for only one country gets that country whatever it asked for — then rejects an address from
 *   anywhere else with `account_country_invalid_address`. Trusting a configured country broke
 *   every driver whose account was opened somewhere else.
 * - Whether the platform may write these fields at all. On an account Stripe collects
 *   requirements for, `individual`, `email` and `business_type` are Stripe's to own, and writing
 *   them fails with a permission error that says nothing useful to the driver.
 */
export const updateConnectPersonalDetails = async (
    accountId: string,
    details: ConnectPersonalDetails
): Promise<ConnectRequirements> => {
    const stripe = getStripeClient();

    const existing = await stripe.accounts.retrieve(accountId);
    if (readRequirementCollection(existing) !== 'application') {
        throw new Error('CONNECT_ACCOUNT_NOT_EDITABLE');
    }

    const country = existing.country ?? details.address.country;

    const account = await stripe.accounts.update(accountId, {
        business_type: 'individual',
        email: details.email,
        individual: {
            first_name: details.firstName,
            last_name: details.lastName,
            email: details.email,
            phone: cleanPhone(details.phone),
            dob: details.dob,
            address: {
                line1: details.address.line1,
                line2: cleanText(details.address.line2),
                city: details.address.city,
                postal_code: details.address.postalCode,
                state: cleanText(details.address.state),
                country,
            },
        },
    });

    return toRequirements(account);
};

/**
 * Attaches a bank account from a Stripe.js token. Only the token reaches this server — raw IBANs
 * are tokenised in the browser and never land in our request logs or database.
 */
export const attachConnectBankAccount = async (
    accountId: string,
    bankAccountToken: string
): Promise<ConnectRequirements> => {
    const stripe = getStripeClient();
    await assertAccountIsPlatformCollected(accountId);

    await stripe.accounts.createExternalAccount(accountId, {
        external_account: bankAccountToken,
        default_for_currency: true,
    });

    return getConnectRequirements(accountId);
};

export const deleteConnectBankAccount = async (
    accountId: string,
    externalAccountId: string
): Promise<ConnectRequirements> => {
    const stripe = getStripeClient();
    await assertAccountIsPlatformCollected(accountId);

    await stripe.accounts.deleteExternalAccount(accountId, externalAccountId);

    return getConnectRequirements(accountId);
};

export const uploadConnectIdentityDocument = async (
    accountId: string,
    upload: ConnectIdentityDocumentUpload
): Promise<ConnectRequirements> => {
    const stripe = getStripeClient();
    await assertAccountIsPlatformCollected(accountId);

    const file = await stripe.files.create({
        purpose: 'identity_document',
        file: {
            data: upload.file,
            name: upload.fileName,
            type: upload.contentType,
        },
    });

    const document = upload.side === 'back'
        ? { back: file.id }
        : { front: file.id };

    const account = await stripe.accounts.update(accountId, {
        individual: {
            verification: {
                document,
            },
        },
    });

    return toRequirements(account);
};

/**
 * Records the driver's acceptance of Stripe's agreement. The platform owns this step on
 * controller-based accounts, and Stripe requires the date and the IP it was accepted from —
 * without it the account stays disabled however complete the rest of the details are.
 */
export const acceptConnectTerms = async (
    accountId: string,
    acceptance: { ip: string; userAgent?: string | null }
): Promise<ConnectRequirements> => {
    const stripe = getStripeClient();
    await assertAccountIsPlatformCollected(accountId);

    const account = await stripe.accounts.update(accountId, {
        tos_acceptance: {
            date: Math.floor(Date.now() / 1000),
            ip: acceptance.ip,
            user_agent: cleanText(acceptance.userAgent),
        },
    });

    return toRequirements(account);
};

export const createConnectOnboardingLink = async (
    userId: string,
    stripeAccountId: string | null,
    returnUrl: string,
    refreshUrl: string,
    prefill: ConnectAccountPrefill = {}
): Promise<{ accountId: string; onboardingUrl: string }> => {
    const stripe = getStripeClient();

    const accountId = stripeAccountId ?? (await createConnectedAccount(userId, prefill));

    const accountLink = await stripe.accountLinks.create({
        account: accountId,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        type: 'account_onboarding',
    });

    return { accountId, onboardingUrl: accountLink.url ?? '' };
};

export const getConnectAccountStatus = async (
    stripeAccountId: string
): Promise<ConnectAccountStatus> => {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const individual = account.individual;
    const accountName = individual
        ? [individual.first_name, individual.last_name].filter(Boolean).join(' ').trim() || null
        : null;
    const accountDob = individual?.dob?.year
        ? { day: individual.dob.day, month: individual.dob.month, year: individual.dob.year }
        : null;
    return {
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
        accountName,
        accountDob,
        requirementCollection: readRequirementCollection(account),
    };
};

export const createBookingPaymentIntent = async (
    input: CreatePaymentIntentInput
): Promise<CreatePaymentIntentResult> => {
    const stripe = getStripeClient();

    const paymentIntent = await stripe.paymentIntents.create(
        {
            amount: toMinorUnits(input.amountMajor),
            currency: (input.currency || STRIPE_CURRENCY_DEFAULT).toLowerCase(),
            capture_method: input.captureMethod ?? 'automatic',
            ...(input.customerId ? { customer: input.customerId } : {}),
            metadata: {
                [STRIPE_METADATA_KEYS.bookingId]: input.bookingId,
                [STRIPE_METADATA_KEYS.rideId]: input.rideId,
                [STRIPE_METADATA_KEYS.passengerId]: input.passengerId,
            },
            automatic_payment_methods: { enabled: true },
        },
        { idempotencyKey: `booking-payment-intent:${input.bookingId}` }
    );

    if (!paymentIntent.client_secret) {
        throw new Error('STRIPE_CLIENT_SECRET_MISSING');
    }

    return {
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        currency: paymentIntent.currency.toUpperCase(),
    };
};

export const refundPaymentIntent = async (
    paymentIntentId: string,
    amountMinor?: number
) => {
    const stripe = getStripeClient();
    return stripe.refunds.create({
        payment_intent: paymentIntentId,
        ...(typeof amountMinor === 'number' ? { amount: amountMinor } : {}),
    });
};

export const capturePaymentIntent = async (
    paymentIntentId: string,
    amountMinor?: number
) => {
    const stripe = getStripeClient();
    return stripe.paymentIntents.capture(
        paymentIntentId,
        amountMinor ? { amount_to_capture: amountMinor } : undefined
    );
};

export const cancelPaymentIntent = async (paymentIntentId: string) => {
    const stripe = getStripeClient();
    return stripe.paymentIntents.cancel(paymentIntentId);
};

export const constructStripeEvent = (
    payload: Buffer | string,
    signature: string
): Stripe.Event => {
    const stripe = getStripeClient();
    const webhookSecret = getStripeWebhookSecret();
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
};
