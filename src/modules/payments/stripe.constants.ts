export const STRIPE_CURRENCY_DEFAULT = 'inr';

export const STRIPE_METADATA_KEYS = {
    bookingId: 'bookingId',
    rideId: 'rideId',
    passengerId: 'passengerId',
} as const;

export const DRIVER_DECISION_WINDOW_MINUTES = 30;
export const DRIVER_DECISION_WINDOW_MS = DRIVER_DECISION_WINDOW_MINUTES * 60 * 1000;

export const DRIVER_DECISION_NOTIFICATION_TYPE = 'booking.request.driver_decision';
