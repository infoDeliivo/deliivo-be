import { RequestHandler, Router } from 'express';
import { saveTravelPreference, getTravelPreference } from './travelPreference.controller.js';
import { validate } from '../../middlewares/validate.js';
import { travelPreferenceSchema } from './travelPreference.validator.js';
import { asyncHandler } from '../../utils/index.js';
import { AuthRequest } from '../../types/auth.js';

const router = Router();

router.post('/', validate({ body: travelPreferenceSchema }), saveTravelPreference as RequestHandler);
router.put('/', validate({ body: travelPreferenceSchema }), saveTravelPreference as RequestHandler);

router.get('/', asyncHandler<AuthRequest>(getTravelPreference));

export default router;
