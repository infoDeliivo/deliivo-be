import express from 'express';
import * as userController from './user.controller.js';
import { validate } from '../../middlewares/index.js';
import { uploadSingleImage } from '../../middlewares/upload.middleware.js';
import * as schemas from './user.validators.js';
import { z } from 'zod';

const reportSchema = z.object({ reason: z.string().min(1).max(500), details: z.string().max(2000).optional() });

const router = express.Router();

// Get basic user info
router.get('/me', userController.getMe as unknown as express.RequestHandler);

// Update basic profile (name, nickName, salutation, etc.)
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

// Upload avatar
router.post(
  '/me/avatar',
  uploadSingleImage,
  validate({ file: schemas.avatarUploadSchema }),
  userController.uploadAvatar as unknown as express.RequestHandler,
);

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
