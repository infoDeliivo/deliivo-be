import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { HttpStatus, sendSuccess, sendError } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import { uploadToS3 } from '../../services/s3.service.js';
import { getCache, setCache, deleteCache, cacheKeys } from '../../services/cache.service.js';
import type { FullProfileResponse, PublicProfileResponse } from './user.types.js';

import {
  getMeService,
  getFullProfileService,
  getPublicProfileService,
  updateFullProfileService,
  completeOnBoardingStep1Service,
  updateProfileService,
  updateAvatarService,
} from './user.service.js';
import { reportUser, blockUser, unblockUser, listBlockedUsers } from './user-safety.service.js';
import { exportUserData, deleteUserAccount } from './user-gdpr.service.js';

// Cache TTL constants
const PROFILE_CACHE_TTL = 300; // 5 minutes
const PUBLIC_PROFILE_CACHE_TTL = 300; // 5 minutes

// ====================== GET ME (Basic) ======================
export const getMe = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const cacheKey = cacheKeys.user(userId);

    // Try cache first
    const cachedUser = await getCache(cacheKey);
    if (cachedUser) {
      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'User fetched successfully',
        data: cachedUser,
      });
    }

    // Cache miss - fetch from DB
    const { success, user, reason } = await getMeService(userId);

    if (!success) {
      return sendError(res, {
        status: HttpStatus.NOT_FOUND,
        message: reason || 'User not found',
      });
    }

    // Cache the result
    await setCache(cacheKey, user);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'User fetched successfully',
      data: user,
    });
  } catch (error) {
    logError('getMe controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== GET FULL PROFILE (Optimized) ======================
/**
 * GET /api/users/me/profile
 * Returns complete profile with:
 * - User basic info (email/phone as objects with verification status)
 * - Travel preferences
 * - Vehicles list
 * - User stats
 * 
 * Features:
 * - Redis caching with 5-min TTL
 * - Single optimized DB query
 * - Parallel stats aggregation
 */
export const getFullProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const cacheKey = cacheKeys.userProfile(userId);

    // Try cache first
    const cachedProfile = await getCache<FullProfileResponse>(cacheKey);
    if (cachedProfile) {
      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'Profile fetched successfully (cached)',
        data: cachedProfile,
      });
    }

    // Cache miss - fetch from DB
    const { success, data, reason } = await getFullProfileService(userId);

    if (!success || !data) {
      const status = reason === 'USER_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR;
      return sendError(res, {
        status,
        message: reason || 'Failed to fetch profile',
      });
    }

    // Cache the result
    await setCache(cacheKey, data, PROFILE_CACHE_TTL);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'Profile fetched successfully',
      data,
    });
  } catch (error) {
    logError('getFullProfile controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== UPDATE FULL PROFILE (Transaction) ======================
/**
 * PUT /api/users/me/profile
 * Updates profile and travel preferences atomically
 * 
 * Features:
 * - Transaction for multi-table updates
 * - Duplicate nickname check
 * - Multi-key cache invalidation
 */
export const updateFullProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { success, data, reason } = await updateFullProfileService(userId, req.body);

    if (!success || !data) {
      const status = reason === 'USERNAME_EXISTS' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
      return sendError(res, {
        status,
        message: reason === 'USERNAME_EXISTS' ? 'Username already taken' : reason || 'Unable to update profile',
      });
    }

    // Invalidate all related caches (including public profile)
    await Promise.all([
      deleteCache(cacheKeys.user(userId)),
      deleteCache(cacheKeys.userProfile(userId)),
      deleteCache(cacheKeys.publicProfile(userId)),
    ]);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'Profile updated successfully',
      data,
    });
  } catch (error) {
    logError('updateFullProfile controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== ONBOARDING ======================
export const completeOnBoardingStep1 = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { success, user, reason } = await completeOnBoardingStep1Service(userId, req.body);

    if (!success) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: reason || 'Unable to complete onboarding',
      });
    }

    // Invalidate user cache after update
    await Promise.all([
      deleteCache(cacheKeys.user(userId)),
      deleteCache(cacheKeys.userProfile(userId)),
      deleteCache(cacheKeys.publicProfile(userId)),
    ]);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'Onboarding completed successfully',
      data: {
        id: user!.id,
        name: user!.name,
        email: user!.email,
        gender: user!.gender,
        role: user!.role,
      },
    });
  } catch (error) {
    logError('completeOnBoardingStep1 controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== LEGACY UPDATE PROFILE ======================
export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user.id;
    const { success, user, reason } = await updateProfileService(userId, req.body);

    if (!success) {
      const status = reason === 'USERNAME_EXISTS' ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;

      return sendError(res, {
        status,
        message: reason || 'Unable to update profile',
      });
    }

    // Invalidate user cache after update
    await Promise.all([
      deleteCache(cacheKeys.user(userId)),
      deleteCache(cacheKeys.userProfile(userId)),
      deleteCache(cacheKeys.publicProfile(userId)),
    ]);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'Profile updated successfully',
      data: user,
    });
  } catch (error) {
    logError('updateProfile controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== UPLOAD AVATAR ======================
export const uploadAvatar = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'Avatar image file required',
      });
    }

    // Upload to S3 using the reusable service
    const uploadResult = await uploadToS3({
      folder: 'avatar',
      file: req.file,
      ownerId: req.user.id,
    });

    if (!uploadResult.success) {
      return sendError(res, {
        status: HttpStatus.INTERNAL_ERROR,
        message: uploadResult.error || 'Failed to upload avatar to S3',
      });
    }

    // Update user avatar URL in database
    const userId = req.user.id;
    const { success, user, reason } = await updateAvatarService(userId, uploadResult.url!, uploadResult.key);

    if (!success) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: reason || 'Unable to update avatar',
      });
    }

    // Invalidate user cache after update
    await Promise.all([
      deleteCache(cacheKeys.user(userId)),
      deleteCache(cacheKeys.userProfile(userId)),
      deleteCache(cacheKeys.publicProfile(userId)),
    ]);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'Avatar uploaded successfully',
      data: { avatarUrl: user?.avatarUrl },
    });
  } catch (error) {
    logError('uploadAvatar controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== REPORT USER ======================
export const reportUserHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await reportUser(req.user.id, req.params.userId as string, req.body.reason, req.body.details);
    return sendSuccess(res, { message: 'Report submitted', data: result });
  } catch (error: any) {
    if (error.message === 'CANNOT_REPORT_SELF')
      return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'You cannot report yourself' });
    if (error.message === 'ALREADY_REPORTED')
      return sendError(res, { status: HttpStatus.CONFLICT, message: 'You have already reported this user' });
    if (error.message === 'USER_NOT_FOUND')
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to submit report' });
  }
};

// ====================== BLOCK USER ======================
export const blockUserHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await blockUser(req.user.id, req.params.userId as string);
    return sendSuccess(res, { message: 'User blocked', data: result });
  } catch (error: any) {
    if (error.message === 'CANNOT_BLOCK_SELF')
      return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'You cannot block yourself' });
    if (error.message === 'USER_NOT_FOUND')
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'User not found' });
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to block user' });
  }
};

// ====================== UNBLOCK USER ======================
export const unblockUserHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await unblockUser(req.user.id, req.params.userId as string);
    return sendSuccess(res, { message: 'User unblocked', data: result });
  } catch (error: any) {
    if (error.message === 'BLOCK_NOT_FOUND')
      return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Block not found' });
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to unblock user' });
  }
};

// ====================== LIST BLOCKED USERS ======================
export const listBlockedUsersHandler = async (req: AuthRequest, res: Response) => {
  try {
    const result = await listBlockedUsers(req.user.id);
    return sendSuccess(res, { message: 'Blocked users fetched', data: result });
  } catch {
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to fetch blocked users' });
  }
};

// ====================== GET PUBLIC PROFILE ======================
/**
 * GET /api/v1/users/:userId/profile
 * Returns public profile of another user with:
 * - Public user info (excludes email, phone, dob, salutation)
 * - Travel preferences
 * - Vehicle details
 * - User stats
 * - Rating summary
 * 
 * Features:
 * - Redis caching with 5-min TTL
 * - Single optimized DB query
 * - Parallel stats aggregation
 */
export const getPublicProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;

    if (!userId || Array.isArray(userId)) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'User ID is required',
      });
    }

    const cacheKey = cacheKeys.publicProfile(userId);

    // Try cache first
    const cachedProfile = await getCache<PublicProfileResponse>(cacheKey);
    if (cachedProfile) {
      return sendSuccess(res, {
        status: HttpStatus.OK,
        message: 'User profile fetched successfully (cached)',
        data: cachedProfile,
      });
    }

    // Cache miss - fetch from DB
    const { success, data, reason } = await getPublicProfileService(userId);

    if (!success || !data) {
      const status = reason === 'USER_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR;
      return sendError(res, {
        status,
        message: reason === 'USER_NOT_FOUND' ? 'User not found' : 'Failed to fetch profile',
      });
    }

    // Cache the result
    await setCache(cacheKey, data, PUBLIC_PROFILE_CACHE_TTL);

    return sendSuccess(res, {
      status: HttpStatus.OK,
      message: 'User profile fetched successfully',
      data,
    });
  } catch (error) {
    logError('getPublicProfile controller error', error);
    return sendError(res, {
      status: HttpStatus.INTERNAL_ERROR,
      message: 'Server error',
      error,
    });
  }
};

// ====================== GDPR: DATA EXPORT ======================
export const dataExport = async (req: AuthRequest, res: Response) => {
  try {
    const data = await exportUserData(req.user.id);
    return sendSuccess(res, { message: 'Data export ready', data });
  } catch {
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to export data' });
  }
};

// ====================== GDPR: DELETE ACCOUNT ======================
export const deleteAccount = async (req: AuthRequest, res: Response) => {
  try {
    if (req.body?.confirm !== true) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'Send { "confirm": true } to confirm account deletion',
      });
    }
    const result = await deleteUserAccount(req.user.id);
    return sendSuccess(res, { message: 'Account deleted. Your personal data has been removed.', data: result });
  } catch {
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to delete account' });
  }
};
