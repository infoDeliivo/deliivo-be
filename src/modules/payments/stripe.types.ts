export interface CreatePaymentIntentInput {
    bookingId: string;
    rideId: string;
    passengerId: string;
    amountMajor: number;
    currency: string;
}

export interface CreatePaymentIntentResult {
    paymentIntentId: string;
    clientSecret: string;
    currency: string;
}
