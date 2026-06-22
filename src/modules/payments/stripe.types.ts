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

export interface ConnectAccountStatus {
    accountId: string;
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
}
