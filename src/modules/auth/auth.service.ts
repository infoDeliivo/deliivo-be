import { prisma } from '../../config/index.js';
import { generateTokens, verifyRefreshToken } from '../token/tokens.service.js';
import { createHash, timingSafeEqual } from 'crypto';
import { Role } from '../user/user.constants.js';
import { logError } from '../../utils/logger.js';
import { OAuth2Client } from 'google-auth-library';

const googleClient = new OAuth2Client();

export const normalizeAuthIdentifier = (method: string, identifier: string) =>
  method === 'email' ? identifier.trim().toLowerCase() : identifier.trim();

export const googleAuthService = async (idToken: string) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_AUTH_NOT_CONFIGURED');

  const ticket = await googleClient.verifyIdToken({ idToken, audience: clientId });
  const payload = ticket.getPayload();
  if (!payload?.email || payload.email_verified !== true) {
    throw new Error('GOOGLE_EMAIL_NOT_VERIFIED');
  }

  const email = normalizeAuthIdentifier('email', payload.email);
  let user = await prisma.user.findUnique({ where: { email } });
  if (user?.isBanned) throw new Error('USER_BANNED');

  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        // Google returns the two parts separately, so they map straight across
        // rather than being split back out of the display name.
        firstName: payload.given_name?.trim() || null,
        lastName: payload.family_name?.trim() || null,
        avatarUrl: payload.picture || null,
        emailVerified: true,
        isVerified: true,
        onboardingStatus: 'PENDING',
      },
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        isVerified: true,
        ...(!user.firstName && payload.given_name ? { firstName: payload.given_name.trim() } : {}),
        ...(!user.lastName && payload.family_name ? { lastName: payload.family_name.trim() } : {}),
        ...(!user.avatarUrl && payload.picture ? { avatarUrl: payload.picture } : {}),
      },
    });
  }

  const tokens = await generateTokens({ id: user.id, role: user.role ?? Role.USER });
  return {
    tokens,
    user,
    next: user.onboardingStatus === 'COMPLETED' ? 'home' as const : 'onboarding' as const,
  };
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
};

export const temporaryAdminLoginService = async (email: string, password: string) => {
  if (process.env.TEMP_ADMIN_LOGIN_ENABLED !== 'true') {
    throw new Error('TEMP_ADMIN_LOGIN_DISABLED');
  }

  const configuredEmail = process.env.TEMP_ADMIN_LOGIN_EMAIL;
  const configuredPassword = process.env.TEMP_ADMIN_LOGIN_PASSWORD;

  if (!configuredEmail || !configuredPassword) {
    throw new Error('TEMP_ADMIN_LOGIN_NOT_CONFIGURED');
  }

  const normalizedEmail = normalizeAuthIdentifier('email', email);
  if (
    !constantTimeEquals(normalizedEmail, normalizeAuthIdentifier('email', configuredEmail))
    || !constantTimeEquals(password, configuredPassword)
  ) {
    throw new Error('INVALID_TEMP_ADMIN_LOGIN');
  }

  const user = await prisma.user.findFirst({
    where: {
      email: { equals: normalizedEmail, mode: 'insensitive' },
      role: Role.ADMIN,
    },
  });

  if (!user || user.isBanned) {
    throw new Error('INVALID_TEMP_ADMIN_LOGIN');
  }

  const tokens = await generateTokens({ id: user.id, role: Role.ADMIN });
  return { tokens, user };
};

const identifierWhere = (method: string, identifier: string) => {
  const normalized = normalizeAuthIdentifier(method, identifier);
  return method === 'email'
    ? { email: { equals: normalized, mode: 'insensitive' as const } }
    : { phone: normalized };
};

/** 
 * Signup Service
 */
export const signupService = async (method: string, identifier: string) => {
  const normalized = normalizeAuthIdentifier(method, identifier);
  const user = await prisma.user.findFirst({
    where: identifierWhere(method, normalized),
  });

  // User exists & already verified → block signup
  if (user && user.isVerified) {
    return { success: false, reason: 'USER_EXISTS' };
  }

  // User does not exist → create new user
  if (!user) {
    const newUser = await prisma.user.create({
      data: {
        [method]: normalized,
        onboardingStatus: 'PENDING',
        isVerified: false,
      },
    });

    return {
      success: true,
      user: newUser,
      reason: 'USER_CREATED',
    };
  }

  // User exists but not verified → reuse OTP flow
  return {
    success: true,
    user,
    reason: 'USER_PENDING_VERIFICATION',
  };
};

/**
 * Verify OTP Service
 */
export const verifyOtpService = async (
  identifier: string,
  code: string,
  purpose: 'signup' | 'login' | 'reset_password',
  method: string,
) => {
  try {
    const normalized = normalizeAuthIdentifier(method, identifier);
    const user = await prisma.user.findFirst({
      where: identifierWhere(method, normalized),
    });

    if (!user) {
      return { success: false, reason: 'USER_NOT_FOUND' };
    }

    // Signup flow → mark user verified
    if (purpose === 'signup') {
      await prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      });

      user.isVerified = true;
    }

    // Login flow → ensure verified user
    if (purpose === 'login' && !user.isVerified) {
      return { success: false, reason: 'USER_NOT_VERIFIED' };
    }

    const tokens = await generateTokens({
      id: user.id,
      role: (user as any).role ?? Role.USER,
    });

    const nextStep = user.onboardingStatus === 'COMPLETED' ? 'home' : 'onboarding';

    return {
      success: true,
      user,
      tokens,
      next: nextStep,
    };
  } catch (error: any) {
    logError('verifyOtpService error', error);
    return {
      success: false,
      reason: error?.message || 'UNKNOWN_ERROR',
    };
  }
};

/**
 * Refresh Token Service
 */
export const refreshTokenService = async (refreshToken: string) => {
  try {
    const decoded = await verifyRefreshToken(refreshToken);

    if (!decoded) {
      return { success: false, reason: 'INVALID_REFRESH' };
    }

    const tokenDoc = await prisma.refreshToken.findFirst({
      where: {
        token: refreshToken,
        userId: decoded.id,
        revoked: false,
      },
    });

    if (!tokenDoc) {
      return { success: false, reason: 'INVALID_REFRESH' };
    }

    // Revoke existing refresh token
    await prisma.refreshToken.update({
      where: { id: tokenDoc.id },
      data: { revoked: true },
    });

    const user = await prisma.user.findFirst({
      where: { id: decoded.id },
    });

    if (!user) {
      return { success: false, reason: 'USER_NOT_FOUND' };
    }

    const tokens = await generateTokens({
      id: user.id,
      role: (user as any).role ?? Role.USER,
    });

    return { success: true, tokens };
  } catch (error) {
    logError('refreshTokenService error', error);
    return {
      success: false,
      reason: 'INTERNAL_ERROR',
    };
  }
};

/**
 * Request OTP Service
 */
export const requestOtpService = async (
  identifier: string,
  purpose: 'signup' | 'login' | 'reset_password',
  method: string,
) => {
  const normalized = normalizeAuthIdentifier(method, identifier);
  const user = await prisma.user.findFirst({
    where: identifierWhere(method, normalized),
  });

  // Signup → block if verified user already exists
  if (purpose === 'signup' && user && user.isVerified) {
    return { success: false, reason: 'USER_EXISTS' };
  }

  // Login → do not expose user existence
  if (purpose === 'login' && !user) {
    return {
      success: true,
      message: 'OTP sent if account exists',
    };
  }

  return { success: true, user };
};

/**
 * Logout Service
 */
export const logoutService = async (refreshToken: string) => {
  try {
    const data = await prisma.refreshToken.updateMany({
      where: { token: refreshToken },
      data: { revoked: true },
    });

    if (data.count == 0) {
      return { success: false, reason: 'Token not found' };
    }

    return { success: true, message: 'Logged out successfully' };
  } catch (error) {
    logError('logoutService error', error);
    return { success: false, reason: 'LOGOUT_FAILED' };
  }
};

/**
 * Login Service
 */
export const loginService = async (method: string, identifier: string) => {
  const normalized = normalizeAuthIdentifier(method, identifier);
  const user = await prisma.user.findFirst({
    where: identifierWhere(method, normalized),
  });

  if (!user || !user.isVerified) {
    return {
      success: false,
      reason: 'USER_NOT_FOUND_OR_VERIFIED',
    };
  }

  return { success: true, user };
};
