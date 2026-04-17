import express from 'express';
import * as userController from './user.controller.js';
import { validate } from '../../middlewares/index.js';
import { uploadSingleImage } from '../../middlewares/upload.middleware.js';
import * as schemas from './user.validators.js';

const router = express.Router();

// Get basic user info
router.get('/me', userController.getMe as unknown as express.RequestHandler);

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

// Get public profile of another user
router.get('/:userId/profile', userController.getPublicProfile as unknown as express.RequestHandler);

export default router;
