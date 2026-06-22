import {
    getBookingPaymentMode,
    isBypassBookingPaymentMode,
} from './booking-payment-mode.js';

describe('booking payment mode helper', () => {
    const originalEnv = process.env.BOOKING_PAYMENT_MODE;

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.BOOKING_PAYMENT_MODE;
        } else {
            process.env.BOOKING_PAYMENT_MODE = originalEnv;
        }
    });

    it('throws when env is missing', () => {
        delete process.env.BOOKING_PAYMENT_MODE;

        expect(() => getBookingPaymentMode()).toThrow('BOOKING_PAYMENT_MODE env var is not set');
    });

    it('returns stripe when env is stripe', () => {
        process.env.BOOKING_PAYMENT_MODE = 'stripe';

        expect(getBookingPaymentMode()).toBe('stripe');
        expect(isBypassBookingPaymentMode()).toBe(false);
    });

    it('normalizes whitespace and case when env is stripe', () => {
        process.env.BOOKING_PAYMENT_MODE = '  STRIPE  ';

        expect(getBookingPaymentMode()).toBe('stripe');
        expect(isBypassBookingPaymentMode()).toBe(false);
    });

    it('throws when env is blank or whitespace only', () => {
        process.env.BOOKING_PAYMENT_MODE = '   ';

        expect(() => getBookingPaymentMode()).toThrow('BOOKING_PAYMENT_MODE env var is not set');
    });

    it('throws BOOKING_PAYMENT_MODE_INVALID for invalid values', () => {
        process.env.BOOKING_PAYMENT_MODE = 'cash';

        expect(() => getBookingPaymentMode()).toThrow('BOOKING_PAYMENT_MODE_INVALID');
    });
});
