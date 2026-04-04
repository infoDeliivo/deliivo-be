import dotenv from 'dotenv';
dotenv.config({ quiet: true });

// Support legacy JWT_SECRET while standardizing new deployments on ACCESS_TOKEN_SECRET.
export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || process.env.JWT_SECRET || 'access_secret';
export const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'refresh_secret';

export const ACCESS_TOKEN_EXPIRES_IN = '30d'; // short-lived
export const REFRESH_TOKEN_EXPIRES_IN = '1y'; // long-lived
