// @ts-ignore — stripe v21 types bundled via package exports; not resolved by "Node" moduleResolution
import Stripe from 'stripe';
import { STRIPE_CURRENCY_DEFAULT, STRIPE_METADATA_KEYS } from './stripe.constants.js';
import { ConnectAccountStatus, CreatePaymentIntentInput, CreatePaymentIntentResult } from './stripe.types.js';

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

export const createConnectOnboardingLink = async (
    userId: string,
    stripeAccountId: string | null,
    returnUrl: string,
    refreshUrl: string
): Promise<{ accountId: string; onboardingUrl: string }> => {
    const stripe = getStripeClient();

    let accountId = stripeAccountId;
    if (!accountId) {
        const account = await stripe.accounts.create({
            type: 'express',
            metadata: { userId },
        });
        accountId = account.id;
    }

    const accountLink = await stripe.accountLinks.create({
        account: accountId,
        return_url: returnUrl,
        refresh_url: refreshUrl,
        type: 'account_onboarding',
    });

    return { accountId: accountId as string, onboardingUrl: accountLink.url ?? '' };
};

export const getConnectAccountStatus = async (
    stripeAccountId: string
): Promise<ConnectAccountStatus> => {
    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(stripeAccountId);
    return {
        accountId: account.id,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        detailsSubmitted: account.details_submitted,
    };
};

export const createBookingPaymentIntent = async (
    input: CreatePaymentIntentInput
): Promise<CreatePaymentIntentResult> => {
    const stripe = getStripeClient();

    const platformFeePct = parseFloat(process.env.PLATFORM_FEE_PERCENT ?? '0');
    const applicationFeeAmount =
        input.driverStripeAccountId && platformFeePct > 0
            ? Math.round(toMinorUnits(input.amountMajor) * (platformFeePct / 100))
            : undefined;

    const paymentIntent = await stripe.paymentIntents.create(
        {
            amount: toMinorUnits(input.amountMajor),
            currency: (input.currency || STRIPE_CURRENCY_DEFAULT).toLowerCase(),
            metadata: {
                [STRIPE_METADATA_KEYS.bookingId]: input.bookingId,
                [STRIPE_METADATA_KEYS.rideId]: input.rideId,
                [STRIPE_METADATA_KEYS.passengerId]: input.passengerId,
            },
            automatic_payment_methods: { enabled: true },
            ...(input.driverStripeAccountId
                ? {
                      transfer_data: { destination: input.driverStripeAccountId },
                      application_fee_amount: applicationFeeAmount,
                  }
                : {}),
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

export const constructStripeEvent = (
    payload: Buffer | string,
    signature: string
): Stripe.Event => {
    const stripe = getStripeClient();
    const webhookSecret = getStripeWebhookSecret();
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
};
