export type BookingPaymentMode = 'bypass' | 'stripe';

export const getBookingPaymentMode = (): BookingPaymentMode => {
    const rawValue = process.env.BOOKING_PAYMENT_MODE?.trim().toLowerCase();

    if (!rawValue) throw new Error('BOOKING_PAYMENT_MODE env var is not set. Set it to "stripe" or "bypass".');
    if (rawValue === 'bypass' || rawValue === 'stripe') return rawValue;

    throw new Error('BOOKING_PAYMENT_MODE_INVALID');
};

export const isBypassBookingPaymentMode = (): boolean => getBookingPaymentMode() === 'bypass';
