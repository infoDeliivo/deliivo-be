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
        country: string;
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

/**
 * What Stripe still needs before payouts can run. `currentlyDue` drives the custom onboarding UI:
 * the platform collects requirements itself on controller-based accounts, so this is the only
 * signal telling it which step to render next.
 */
export interface ConnectRequirements {
    accountId: string;
    requirementCollection: ConnectRequirementCollection;
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
