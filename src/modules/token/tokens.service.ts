import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { Tokens, DecodedToken } from './tokens.types.js';
import { prisma } from '../../config/index.js';

import {
  ACCESS_TOKEN_SECRET,
  REFRESH_TOKEN_SECRET,
  ACCESS_TOKEN_EXPIRES_IN,
  REFRESH_TOKEN_EXPIRES_IN,
} from './tokens.constants.js';

/**
 * Generate JWT access and refresh tokens
 */
export const generateTokens = async (payload: DecodedToken): Promise<Tokens> => {
  const accessToken = jwt.sign({ ...payload, jti: randomUUID() }, ACCESS_TOKEN_SECRET, {
    expiresIn: ACCESS_TOKEN_EXPIRES_IN,
  });

  const refreshToken = jwt.sign({ ...payload, jti: randomUUID() }, REFRESH_TOKEN_SECRET, {
    expiresIn: REFRESH_TOKEN_EXPIRES_IN,
  });

  // Save refresh token to DB
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: payload.id,
      revoked: false,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  return { accessToken, refreshToken };
};

/**
 * Verify Access Token
 */
export const verifyAccessToken = (token: string): DecodedToken => {
  return jwt.verify(token, ACCESS_TOKEN_SECRET) as DecodedToken;
};

/**
 * Verify Refresh Token
 */
export const verifyRefreshToken = async (token: string): Promise<DecodedToken> => {
  const decoded = jwt.verify(token, REFRESH_TOKEN_SECRET) as DecodedToken;
  return decoded;
};

/**
 * Revoke Refresh Token
 */
export const revokeRefreshToken = async (token: string) => {
  await prisma.refreshToken.updateMany({
    where: { token },
    data: { revoked: true },
  });
};
