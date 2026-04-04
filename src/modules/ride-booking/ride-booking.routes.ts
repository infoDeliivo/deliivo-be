import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './ride-booking.controller.js';
import {
    createBookingSchema,
    bookingIdParamSchema,
    listBookingsQuerySchema,
} from './ride-booking.validator.js';

const router = Router();

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

// Cancel booking
router.post(
    '/:id/cancel',
    validate({ params: bookingIdParamSchema }),
    controller.cancelBooking
);

export default router;
