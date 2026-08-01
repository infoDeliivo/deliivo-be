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

export interface ConnectAccountStatus {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    accountName: string | null;
    accountDob: { day?: number | null; month?: number | null; year?: number | null } | null;
    requirementCollection: ConnectRequirementCollection;
}
