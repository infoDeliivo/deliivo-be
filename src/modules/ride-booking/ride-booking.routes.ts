import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './ride-booking.controller.js';
import {
    createBookingSchema,
    bookingIdParamSchema,
    listBookingsQuerySchema,
    pricePreviewSchema,
    withdrawReasonSchema,
} from './ride-booking.validator.js';

const router = Router();

// Price preview (before booking)
router.post(
    '/price-preview',
    validate({ body: pricePreviewSchema }),
    controller.getBookingPricePreview
);

// Create new booking
router.post(
    '/',
    validate({ body: createBookingSchema }),
    controller.createBooking
);

// List user's bookings
router.get(
    '/',
    validate({ query: listBookingsQuerySchema }),
    controller.listUserBookings
);

// Get booking by ID
router.get(
    '/:id',
    validate({ params: bookingIdParamSchema }),
    controller.getBookingById
);

// Check booking payment status after payment UI flow
router.post(
    '/:id/payment/confirm',
    validate({ params: bookingIdParamSchema }),
    controller.confirmBookingPaymentStatus
);

// Extend wait for driver response
router.post(
    '/:id/extend-wait',
    validate({ params: bookingIdParamSchema }),
    controller.extendWaitForDriver
);

// Withdraw booking request (rider cancels pending request before driver responds)
router.post(
    '/:id/withdraw',
    validate({ params: bookingIdParamSchema, body: withdrawReasonSchema }),
    controller.withdrawBooking
);

// Cancel booking
router.post(
    '/:id/cancel',
    validate({ params: bookingIdParamSchema }),
    controller.cancelBooking
);

// Driver response metrics
router.get(
    '/driver/response-metrics',
    controller.getDriverResponseMetrics
);

export default router;
