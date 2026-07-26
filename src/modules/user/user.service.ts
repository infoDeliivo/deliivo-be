import { prisma } from '../../config/index.js';
import * as enums from './user.constants.js';
import { logError } from '../../utils/logger.js';
import { parseDateOnlyAsUtc } from '../../utils/age.js';
import type {
  FullProfileResponse,
  UserBasicInfo,
  TravelPreferenceData,
  VehicleSummary,
  UserStats,
  UpdateProfileInput,
  ServiceResult,
  PublicProfileResponse,
  PublicUserInfo,
} from './user.types.js';

// ====================== GET ME SERVICE (Basic) ======================
export const getMeService = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          salutation: true,
          gender: true,
          dob: true,
          tosAcceptedAt: true,
          privacyAcceptedAt: true,
          email: true,
          phone: true,
          avatarUrl: true,
          onboardingStatus: true,
        isVerified: true,
        isBanned: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return { success: false, user: null, reason: 'User not found' };
    }
    // GDPR-deleted accounts are anonymized: isBanned=true and email=null
    if (user.isBanned && !user.email) {
      return { success: false, user: null, reason: 'Account has been deleted' };
    }
    return { success: true, user };
  } catch (error) {
    logError('getMeService error', error);
    return { success: false, user: null, reason: 'Internal server error' };
  }
};

// ====================== GET FULL PROFILE SERVICE (Optimized) ======================
/**
 * Fetches complete user profile with:
 * - User basic info (with email/phone as objects)
 * - Travel preferences
 * - Vehicles list
 * - User stats (rides as driver, bookings as passenger)
 * 
 * Uses single optimized query with includes + parallel stats aggregation
 */
export const getFullProfileService = async (
  userId: string
): Promise<ServiceResult<FullProfileResponse>> => {
  try {
    // Single query with includes - no N+1 problem
    // Plus parallel stats aggregation
    const [userWithRelations, totalRides, totalBookings, successfulPublishedRides, successfulCompletedRides, ratingStats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        include: {
          travelPreference: true,
          vehicles: {
            where: { deletedAt: null },
          },
        },
      }),
      prisma.ride.count({ where: { driverId: userId } }),
      prisma.rideBooking.count({ where: { passengerId: userId } }),
      prisma.ride.count({ where: { driverId: userId, status: 'COMPLETED' } }),
      prisma.rideBooking.count({ where: { passengerId: userId, status: 'COMPLETED' } }),
      prisma.userRatingStats.findUnique({ where: { userId } }),
    ]);

    if (!userWithRelations) {
      return { success: false, reason: 'USER_NOT_FOUND' };
    }

    // Transform user to include email/phone as objects
    const userBasicInfo: UserBasicInfo = {
      id: userWithRelations.id,
      role: userWithRelations.role,
      firstName: userWithRelations.firstName,
      lastName: userWithRelations.lastName,
      salutation: userWithRelations.salutation,
      gender: userWithRelations.gender,
      dob: userWithRelations.dob,
      tosAcceptedAt: userWithRelations.tosAcceptedAt,
      privacyAcceptedAt: userWithRelations.privacyAcceptedAt,
      email: {
        value: userWithRelations.email,
        isVerified: userWithRelations.emailVerified,
      },
      phone: {
        value: userWithRelations.phone,
        isVerified: userWithRelations.phoneVerified,
      },
      avatarUrl: userWithRelations.avatarUrl,
      onboardingStatus: userWithRelations.onboardingStatus,
      isVerified: userWithRelations.isVerified,
      createdAt: userWithRelations.createdAt,
    };

    // Transform travel preference
    const travelPreference: TravelPreferenceData | null = userWithRelations.travelPreference
      ? {
        id: userWithRelations.travelPreference.id,
        chattiness: userWithRelations.travelPreference.chattiness,
        pets: userWithRelations.travelPreference.pets,
      }
      : null;

    // Get single vehicle (users can only have one)
    const vehicle: VehicleSummary | null = userWithRelations.vehicles.length > 0
      ? {
        id: userWithRelations.vehicles[0].id,
        brand: userWithRelations.vehicles[0].brand,
        model_num: userWithRelations.vehicles[0].model_num,
        type: userWithRelations.vehicles[0].type,
        color: userWithRelations.vehicles[0].color,
        imageUrl: userWithRelations.vehicles[0].imageUrl,
        isVerified: userWithRelations.vehicles[0].isVerified,
      }
      : null;

    // Build stats
    const stats: UserStats = {
      totalRides,
      totalBookings,
      successfulPublishedRides,
      successfulCompletedRides,
      memberSince: userWithRelations.createdAt,
    };

    // Build rating summary
    const rating = !ratingStats || ratingStats.totalRatings === 0
      ? {
        average: null,
        total: 0,
        label: 'No ratings yet',
      }
      : {
        average: Number(ratingStats.averageRating.toFixed(2)),
        total: ratingStats.totalRatings,
        label: null,
      };

    const profileData: FullProfileResponse = {
      user: userBasicInfo,
      travelPreference,
      vehicle,
      stats,
      rating,
    };

    return { success: true, data: profileData };
  } catch (error) {
    logError('getFullProfileService error', error);
    return { success: false, reason: 'INTERNAL_SERVER_ERROR' };
  }
};

// ====================== UPDATE FULL PROFILE SERVICE (Transaction) ======================
/**
 * Updates user profile and travel preferences atomically
 * - Uses Prisma transaction for multi-table updates
 * - Upserts travel preferences
 */
export const updateFullProfileService = async (
  userId: string,
  payload: UpdateProfileInput
): Promise<ServiceResult<FullProfileResponse>> => {
  try {
    const { travelPreference, ...basicData } = payload;
    const parsedDob = basicData.dob !== undefined ? parseDateOnlyAsUtc(basicData.dob) : undefined;
    if (basicData.dob !== undefined && !parsedDob) {
      return { success: false, reason: 'INVALID_DATE_OF_BIRTH' };
    }

    // Use transaction for multi-table updates
    await prisma.$transaction(async (tx) => {
      // Build update data for user (only include provided fields)
      const userUpdateData: Record<string, unknown> = {};
      if (basicData.firstName !== undefined) userUpdateData.firstName = basicData.firstName;
      if (basicData.lastName !== undefined) userUpdateData.lastName = basicData.lastName;
      if (basicData.salutation !== undefined) userUpdateData.salutation = basicData.salutation;
      if (basicData.gender !== undefined) userUpdateData.gender = basicData.gender;
      if (parsedDob !== undefined) userUpdateData.dob = parsedDob;

      // Update user if there are fields to update
      if (Object.keys(userUpdateData).length > 0) {
        await tx.user.update({
          where: { id: userId },
          data: userUpdateData,
        });
      }

      // Upsert travel preferences if provided
      if (travelPreference && Object.keys(travelPreference).length > 0) {
        // Check if travel preference exists
        const existingPref = await tx.travelPreference.findUnique({
          where: { userId },
        });

        if (existingPref) {
          // Update existing
          await tx.travelPreference.update({
            where: { userId },
            data: travelPreference,
          });
        } else {
          // Create new - need both chattiness and pets for creation
          // If missing required fields, skip creation
          if (travelPreference.chattiness && travelPreference.pets) {
            await tx.travelPreference.create({
              data: {
                userId,
                chattiness: travelPreference.chattiness,
                pets: travelPreference.pets,
              },
            });
          }
        }
      }
    });

    // Return updated profile
    return getFullProfileService(userId);
  } catch (error) {
    logError('updateFullProfileService error', error);
    return { success: false, reason: 'INTERNAL_SERVER_ERROR' };
  }
};

// ====================== ONBOARDING SERVICE ======================
export const completeOnBoardingStep1Service = async (
  userId: string,
  data: {
    firstName: string;
    lastName: string;
    salutation: 'MS' | 'MR' | 'MRS' | 'MX' | 'OTHER';
    gender: 'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER' | 'PREFER_NOT_TO_SAY';
    dob: string;
  },
) => {
  try {
    const existingUser = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!existingUser) {
      return { success: false, user: null, reason: 'User not found' };
    }

    if (existingUser.onboardingStatus === enums.OnboardingStatus.COMPLETED) {
      return { success: false, reason: 'Onboarding already completed' };
    }

    const dob = parseDateOnlyAsUtc(data.dob);
    if (!dob) {
      return { success: false, user: null, reason: 'Invalid date of birth' };
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        salutation: data.salutation,
        gender: data.gender,
        dob,
        onboardingStatus: 'COMPLETED',
      },
    });

    return { success: true, user };
  } catch (error) {
    logError('completeOnBoardingStep1Service error', error);
    return { success: false, user: null, reason: 'Internal server error' };
  }
};

// ====================== LEGACY UPDATE PROFILE SERVICE ======================
export const updateProfileService = async (userId: string, payload: Record<string, unknown>) => {
  try {
    // `username` used to map onto the lastName handle, which no longer exists.
    const { username: _username, ...userData } = payload;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: userData,
    });

    if (!updatedUser) {
      return { success: false, reason: 'User not found' };
    }

    return { success: true, user: updatedUser };
  } catch (error) {
    logError('updateProfileService error', error);
    return { success: false, reason: 'Internal server error' };
  }
};

// ====================== UPDATE AVATAR SERVICE ======================
export const updateAvatarService = async (userId: string, avatarUrl: string, avatarKey?: string) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return { success: false, reason: 'User not found' };
    }

    const previousKey = user.avatarKey ?? undefined;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl, avatarKey },
      select: {
        id: true,
        firstName: true,
        email: true,
        avatarUrl: true,
        avatarKey: true,
      },
    });

    return { success: true, user: updatedUser, previousKey };
  } catch (error) {
    logError('updateAvatarService error', error);
    return { success: false, reason: 'Internal server error' };
  }
};

// ====================== CLEAR AVATAR SERVICE ======================
/** Remove the user's avatar: clears avatarUrl/avatarKey. Returns the previous key to reap. */
export const clearAvatarService = async (userId: string) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      return { success: false, reason: 'User not found' };
    }

    const previousKey = user.avatarKey ?? undefined;

    await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null, avatarKey: null },
    });

    return { success: true, previousKey };
  } catch (error) {
    logError('clearAvatarService error', error);
    return { success: false, reason: 'Internal server error' };
  }
};

// ====================== GET PUBLIC PROFILE SERVICE ======================
/**
 * Fetches public profile of another user with:
 * - Public user info (excludes email, phone, dob, salutation)
 * - Travel preferences
 * - Vehicle details
 * - User stats (rides as driver, bookings as passenger)
 * - Rating summary
 * 
 * Uses single optimized query with includes + parallel stats aggregation
 */
export const getPublicProfileService = async (
  userId: string
): Promise<ServiceResult<PublicProfileResponse>> => {
  try {
    // Single query with includes - no N+1 problem
    // Plus parallel stats aggregation
    const [userWithRelations, totalRides, totalBookings, successfulPublishedRides, successfulCompletedRides, ratingStats] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          avatarUrl: true,
          isVerified: true,
          createdAt: true,
          travelPreference: true,
          vehicles: {
            where: { deletedAt: null },
          },
        },
      }),
      prisma.ride.count({ where: { driverId: userId } }),
      prisma.rideBooking.count({ where: { passengerId: userId } }),
      prisma.ride.count({ where: { driverId: userId, status: 'COMPLETED' } }),
      prisma.rideBooking.count({ where: { passengerId: userId, status: 'COMPLETED' } }),
      prisma.userRatingStats.findUnique({ where: { userId } }),
    ]);

    if (!userWithRelations) {
      return { success: false, reason: 'USER_NOT_FOUND' };
    }

    // Transform user to public info (exclude sensitive data)
    const publicUserInfo: PublicUserInfo = {
      id: userWithRelations.id,
      role: userWithRelations.role,
      firstName: userWithRelations.firstName,
      lastName: userWithRelations.lastName,
      avatarUrl: userWithRelations.avatarUrl,
      isVerified: userWithRelations.isVerified,
      memberSince: userWithRelations.createdAt,
    };

    // Transform travel preference
    const travelPreference: TravelPreferenceData | null = userWithRelations.travelPreference &&
      userWithRelations.travelPreference.chattiness !== null &&
      userWithRelations.travelPreference.pets !== null
      ? {
        id: userWithRelations.travelPreference.id,
        chattiness: userWithRelations.travelPreference.chattiness,
        pets: userWithRelations.travelPreference.pets,
      }
      : null;

    // Get single vehicle (users can only have one)
    const vehicle: VehicleSummary | null = userWithRelations.vehicles.length > 0
      ? {
        id: userWithRelations.vehicles[0].id,
        brand: userWithRelations.vehicles[0].brand,
        model_num: userWithRelations.vehicles[0].model_num,
        type: userWithRelations.vehicles[0].type,
        color: userWithRelations.vehicles[0].color,
        imageUrl: userWithRelations.vehicles[0].imageUrl,
        isVerified: userWithRelations.vehicles[0].isVerified,
      }
      : null;

    // Build stats
    const stats: UserStats = {
      totalRides,
      totalBookings,
      successfulPublishedRides,
      successfulCompletedRides,
      memberSince: userWithRelations.createdAt,
    };

    // Build rating summary
    const rating = !ratingStats || ratingStats.totalRatings === 0
      ? {
        average: null,
        total: 0,
        label: 'No ratings yet',
      }
      : {
        average: Number(ratingStats.averageRating.toFixed(2)),
        total: ratingStats.totalRatings,
        label: null,
      };

    const profileData: PublicProfileResponse = {
      user: publicUserInfo,
      travelPreference,
      vehicle,
      stats,
      rating,
    };

    return { success: true, data: profileData };
  } catch (error) {
    logError('getPublicProfileService error', error);
    return { success: false, reason: 'INTERNAL_SERVER_ERROR' };
  }
};
