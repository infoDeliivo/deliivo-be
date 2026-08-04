export interface CreatePaymentIntentInput {
    bookingId: string;
    rideId: string;
    passengerId: string;
    amountMajor: number;
    currency: string;
    customerId?: string | null;
    driverStripeAccountId?: string | null;
    captureMethod?: 'automatic' | 'manual';
}

export interface CreatePaymentIntentResult {
    paymentIntentId: string;
    clientSecret: string;
    currency: string;
}

/** Which side collects the account's outstanding requirements. */
export type ConnectRequirementCollection = 'application' | 'stripe';

/** Profile data used to prefill a newly created connected account. */
export interface ConnectAccountPrefill {
    email?: string | null;
    phone?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    dob?: Date | null;
}

export interface ConnectAccountSessionResult {
    accountId: string;
    clientSecret: string;
    expiresAt: number;
    requirementCollection: ConnectRequirementCollection;
}

/** Personal details the platform collects in its own UI and files on the driver's behalf. */
export interface ConnectPersonalDetails {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    dob: { day: number; month: number; year: number };
    address: {
        line1: string;
        line2?: string | null;
        city: string;
        postalCode: string;
        state?: string | null;
        /**
         * Optional and advisory. Stripe fixes a connected account's country when the account is
         * created, so the service files the address against the account's own country and
         * ignores whatever arrives here.
         */
        country?: string;
    };
}

/** A bank account already attached to the connected account, as Stripe reports it back. */
export interface ConnectExternalAccount {
    id: string;
    bankName: string | null;
    last4: string | null;
    currency: string | null;
    country: string | null;
    defaultForCurrency: boolean;
}

export type ConnectIdentityDocumentSide = 'front' | 'back';

export interface ConnectIdentityDocumentUpload {
    file: Buffer;
    fileName: string;
    contentType: string;
    side: ConnectIdentityDocumentSide;
}

/**
 * What Stripe still needs before payouts can run. `currentlyDue` drives the custom onboarding UI:
 * the platform collects requirements itself on controller-based accounts, so this is the only
 * signal telling it which step to render next.
 */
export interface ConnectRequirements {
    accountId: string;
    requirementCollection: ConnectRequirementCollection;
    /**
     * The connected account's own country and payout currency. Stripe fixes both when the account
     * is created — a platform cannot choose a country it is not enabled for, so a configured
     * preference may be silently overridden — and then rejects an address or bank account from
     * anywhere else. The client must collect against these, never against a platform-wide setting.
     */
    country: string | null;
    defaultCurrency: string | null;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    disabledReason: string | null;
    currentDeadline: number | null;
    currentlyDue: string[];
    pastDue: string[];
    eventuallyDue: string[];
    pendingVerification: string[];
    errors: { requirement: string; code: string; reason: string }[];
    termsAccepted: boolean;
    externalAccount: ConnectExternalAccount | null;
}

export interface ConnectAccountStatus {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    accountName: string | null;
    accountDob: { day?: number | null; month?: number | null; year?: number | null } | null;
    requirementCollection: ConnectRequirementCollection;
}
