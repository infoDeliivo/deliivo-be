import { Request } from 'express';
import { Salutation, Gender, OnboardingStatus, Chattiness, PetsPreference, VehicleType } from '@prisma/client';

// Auth request interface
export interface AuthRequest extends Request {
  user: {
    id: string;
    role: string;
  };
}

// ====================== PROFILE RESPONSE TYPES ======================

// Email/Phone with verification status
export interface ContactInfo {
  value: string | null;
  isVerified: boolean;
}

// User basic info (core profile data)
export interface UserBasicInfo {
  id: string;
  role: string;
  name: string | null;
  nickName: string | null;
  salutation: Salutation | null;
  gender: Gender | null;
  dob: Date | null;
  tosAcceptedAt: Date | null;
  privacyAcceptedAt: Date | null;
  email: ContactInfo;
  phone: ContactInfo;
  avatarUrl: string | null;
  onboardingStatus: OnboardingStatus;
  isVerified: boolean;
  createdAt: Date;
}

// Travel preference data
export interface TravelPreferenceData {
  id: string;
  chattiness: Chattiness | null;
  pets: PetsPreference | null;
}

// Vehicle summary for profile
export interface VehicleSummary {
  id: string;
  brand: string | null;
  model_num: string | null;
  type: VehicleType | null;
  color: string | null;
  imageUrl: string | null;
  isVerified: boolean;
}

// User statistics
export interface UserStats {
  totalRides: number;       // Rides as driver
  totalBookings: number;    // Bookings as passenger
  successfulPublishedRides: number;
  successfulCompletedRides: number;
  memberSince: Date;
}

// User rating summary
export interface UserRatingSummary {
  average: number | null;  // Null if no ratings
  total: number;           // Count of ratings received
  label: string | null;    // "No ratings yet" if total = 0, else null
}

// Complete profile response
export interface FullProfileResponse {
  user: UserBasicInfo;
  travelPreference: TravelPreferenceData | null;
  vehicle: VehicleSummary | null;  // Single vehicle (users can only have one)
  stats: UserStats;
  rating: UserRatingSummary;
}

// Public user info (for viewing other users' profiles)
export interface PublicUserInfo {
  id: string;
  role: string;
  name: string | null;
  nickName: string | null;
  avatarUrl: string | null;
  isVerified: boolean;
  memberSince: Date;
}

// Public profile response (excludes sensitive data)
export interface PublicProfileResponse {
  user: PublicUserInfo;
  travelPreference: TravelPreferenceData | null;
  vehicle: VehicleSummary | null;
  stats: UserStats;
  rating: UserRatingSummary;
}

// ====================== UPDATE PROFILE INPUT TYPES ======================

// Travel preference update input
export interface TravelPreferenceInput {
  chattiness?: Chattiness;
  pets?: PetsPreference;
}

// Profile update input
export interface UpdateProfileInput {
  name?: string;
  nickName?: string;
  salutation?: Salutation;
  gender?: Gender;
  dob?: string;
  travelPreference?: TravelPreferenceInput;
}

// Service response types
export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  reason?: string;
}
