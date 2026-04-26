import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { protect } from '../../middlewares/auth.js';
import * as controller from './dl-verification.controller.js';
import { createSessionSchema } from './dl-verification.validator.js';

const router = Router();

// Protected routes — require JWT auth
router.post(
  '/',
  protect,
  validate({ body: createSessionSchema }),
  controller.createSession,
);

router.get('/status', protect, controller.status);

// Public route — Veriff webhook (HMAC-validated in controller)
router.post('/webhook', controller.webhook);

export default router;
