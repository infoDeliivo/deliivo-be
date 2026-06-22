import express from 'express';
import * as authController from './auth.controller.js';
import { validate } from '../../middlewares/validate.js';
import { protect } from '../../middlewares/index.js';
import * as schemas from './auth.validator.js';
import { asyncHandler } from '../../utils/index.js';
const router = express.Router();

router.post('/signup', validate({ body: schemas.signupSchema }), authController.signup);
router.post(
  '/otp/request',
  validate({ body: schemas.otpRequestSchema }),
  authController.requestOtp,
);
router.post(
  '/otp/resend',
  validate({ body: schemas.otpRequestSchema }),
  authController.resendOtpCont,
);
router.post(
  '/otp/verify',
  validate({ body: schemas.otpVerifySchema }),
  authController.verifyOtpCont,
);
router.post('/login', validate({ body: schemas.loginSchema }), authController.login);
router.post(
  '/access-token',
  validate({ body: schemas.refreshTokenSchema }),
  authController.refreshToken,
);
router.post('/logout', validate({ body: schemas.refreshTokenSchema }), authController.logout);
router.post('/accept-tos', protect, validate({ body: schemas.acceptTosSchema }), authController.acceptTos);

export default router;
