export type BookingPaymentMode = 'bypass' | 'stripe';

export const getBookingPaymentMode = (): BookingPaymentMode => {
    const rawValue = process.env.BOOKING_PAYMENT_MODE?.trim().toLowerCase();

    if (!rawValue) return 'bypass';
    if (rawValue === 'bypass' || rawValue === 'stripe') return rawValue;

    throw new Error('BOOKING_PAYMENT_MODE_INVALID');
};

export const isBypassBookingPaymentMode = (): boolean => getBookingPaymentMode() === 'bypass';
