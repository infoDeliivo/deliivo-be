import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { protect } from '../../middlewares/auth.js';
import * as controller from './dl-verification.controller.js';
import * as reviewController from './dl-review.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AuthRequest } from '../../types/auth.js';
import {
  createSessionSchema,
  registerSessionSchema,
  submitDlDocumentSchema,
} from './dl-verification.validator.js';

const router = Router();

// Protected routes — require JWT auth
router.post(
  '/',
  protect,
  validate({ body: createSessionSchema }),
  controller.createSession,
);

// The browser SDK creates the session itself; this attaches it to the caller so the
// decision webhook has a row to land on.
router.post(
  '/register',
  protect,
  validate({ body: registerSessionSchema }),
  controller.registerSession,
);

router.get('/status', protect, controller.status);

// Manual review fallback: a driver who does not complete Veriff uploads a photo of
// their licence for an admin to read. The key must already be a private upload —
// see submitDlDocumentSchema.
router.post(
  '/document',
  protect,
  validate({ body: submitDlDocumentSchema }),
  asyncHandler<AuthRequest>(reviewController.submitDocument),
);

// The public Veriff webhook lives in dl-verification.webhook.routes.ts — it needs the
// raw body, so it is mounted before express.json().

export default router;
