import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import { protect } from '../../middlewares/auth.js';
import * as controller from './dl-verification.controller.js';
import { createSessionSchema, registerSessionSchema } from './dl-verification.validator.js';

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

// The public Veriff webhook lives in dl-verification.webhook.routes.ts — it needs the
// raw body, so it is mounted before express.json().

export default router;
