import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/index.js';
import { ACCESS_TOKEN_SECRET } from '../modules/token/tokens.constants.js';

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      const token = req.headers.authorization.split(' ')[1];

      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET) as any;

      req.user = await prisma.user.findUnique({
        where: { id: decoded.user.id },
        select: {
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
        },
      });

      if (!req.user) {
        return res.status(401).json({ message: 'Not authorized, user not found' });
      }

      // GDPR-deleted accounts: isBanned=true with no email (anonymized)
      if (req.user.isBanned && !req.user.email) {
        return res.status(401).json({ message: 'Not authorized, account has been deleted' });
      }

      return next();
    } catch (error) {
      return res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  return res.status(401).json({ message: 'Not authorized, no token' });
};
