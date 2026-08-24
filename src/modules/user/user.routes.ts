import express from 'express';
import * as userController from './user.controller.js';
import { validate } from '../../middlewares/index.js';
import * as schemas from './user.validators.js';
import { z } from 'zod';

const reportSchema = z.object({ reason: z.string().min(1).max(500), details: z.string().max(2000).optional() });

const router = express.Router();

// Get basic user info
router.get('/me', userController.getMe as unknown as express.RequestHandler);

// Record a language change the moment the switcher fires
router.patch(
  '/me/locale',
  validate({ body: schemas.updateLocaleSchema }),
  userController.updateLocale as unknown as express.RequestHandler,
);

// Update basic profile (firstName, lastName, salutation, etc.)
router.put('/me', userController.updateProfile as unknown as express.RequestHandler);

// Get full profile with travel preferences, vehicles, and stats
router.get('/me/profile', userController.getFullProfile as unknown as express.RequestHandler);

// Update full profile (with travel preferences)
router.put(
  '/me/profile',
  validate({ body: schemas.fullProfileUpdateSchema }),
  userController.updateFullProfile as unknown as express.RequestHandler,
);

// Complete onboarding step 1
router.post(
  '/me/onboarding/complete',
  validate({ body: schemas.updateProfileSchemaOnBoarding }),
  userController.completeOnBoardingStep1 as unknown as express.RequestHandler,
);

// Avatar upload now uses the presigned flow: POST /api/v1/uploads/presign then
// POST /api/v1/uploads/confirm with target=avatar.

// GDPR: data export and account deletion (must be before /:userId routes)
router.get('/me/data-export', userController.dataExport as unknown as express.RequestHandler);
router.delete('/me', userController.deleteAccount as unknown as express.RequestHandler);

// Get public profile of another user
router.get('/:userId/profile', userController.getPublicProfile as unknown as express.RequestHandler);

// Safety: report / block / unblock
router.post('/:userId/report', validate({ body: reportSchema }), userController.reportUserHandler as unknown as express.RequestHandler);
router.post('/:userId/block', userController.blockUserHandler as unknown as express.RequestHandler);
router.delete('/:userId/block', userController.unblockUserHandler as unknown as express.RequestHandler);
router.get('/me/blocked', userController.listBlockedUsersHandler as unknown as express.RequestHandler);

export default router;
