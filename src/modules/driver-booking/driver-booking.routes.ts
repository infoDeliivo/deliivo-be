import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './driver-booking.controller.js';
import { 
    bookingIdParamSchema, 
    otpSchema, 
    rejectReasonSchema, 
    cancelReasonSchema 
} from './driver-booking.validator.js';

const router = Router();

router.post(
    '/:id/accept',
    validate({ params: bookingIdParamSchema }),
    controller.acceptBooking
);

router.post(
    '/:id/reject',
    validate({ params: bookingIdParamSchema, body: rejectReasonSchema }),
    controller.rejectBooking
);

router.post(
    '/:id/cancel',
    validate({ params: bookingIdParamSchema, body: cancelReasonSchema }),
    controller.cancelAfterAccept
);

router.post(
    '/:id/pickup-otp/verify',
    validate({ params: bookingIdParamSchema, body: otpSchema }),
    controller.verifyPickupOtp
);

router.post(
    '/:id/drop-otp/verify',
    validate({ params: bookingIdParamSchema, body: otpSchema }),
    controller.verifyDropOtp
);

export default router;
