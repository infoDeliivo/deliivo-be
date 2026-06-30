import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/index.js';
import { verifyAccessToken } from '../modules/token/tokens.service.js';

export interface AuthRequest extends Request {
  user?: any;
}

const authUserSelect = {
  id: true,
  name: true,
  nickName: true,
  salutation: true,
  gender: true,
  dob: true,
  email: true,
  phone: true,
  onboardingStatus: true,
  isVerified: true,
  isBanned: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const resolveTokenUserId = (decoded: { id?: string; user?: { id?: string } }): string | null =>
  decoded.id || decoded.user?.id || null;

const authenticateBearerToken = async (req: AuthRequest) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return null;

  const decoded = verifyAccessToken(token) as { id?: string; user?: { id?: string } };
  const userId = resolveTokenUserId(decoded);
  if (!userId) return null;

  return prisma.user.findUnique({
    where: { id: userId },
    select: authUserSelect,
  });
};

const isDeletedAccount = (user: any) => Boolean(user?.isBanned && !user?.email);

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.headers.authorization?.startsWith('Bearer')) {
    try {
      req.user = await authenticateBearerToken(req);

      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      // GDPR-deleted accounts: isBanned=true with no email (anonymized)
      if (isDeletedAccount(req.user)) {
        return res.status(401).json({ message: 'Not authorized, account has been deleted' });
      }

      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  return res.status(401).json({ message: 'Not authorized, no token' });
};

export const optionalProtect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.headers.authorization) {
    return next();
  }

  if (!req.headers.authorization.startsWith('Bearer')) {
    return res.status(401).json({ message: 'Not authorized, invalid authorization header' });
  }

  try {
    req.user = await authenticateBearerToken(req);
    if (!req.user || isDeletedAccount(req.user)) {
      return res.status(401).json({ message: 'Not authorized, user unavailable' });
    }
    return next();
  } catch {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};
