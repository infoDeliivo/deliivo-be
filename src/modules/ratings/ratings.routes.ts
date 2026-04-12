import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './ratings.controller.js';
import { submitRatingBodySchema, submitRatingParamsSchema } from './ratings.validator.js';

const router = Router();

router.post(
  '/bookings/:bookingId',
  validate({ params: submitRatingParamsSchema, body: submitRatingBodySchema }),
  controller.submitRating
);

export default router;
