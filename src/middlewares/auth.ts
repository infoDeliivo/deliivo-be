import { Request, Response, NextFunction, RequestHandler } from 'express';
import { AuthRequest } from '../types/auth.js';
import { verifyAccessToken } from '../modules/token/tokens.service.js';
import { sendError } from '../utils/apiResponse.js';
import { HttpStatus } from '../utils/httpStatus.js';
import redis from '../cache/redis.js';

export const protect: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthRequest;
  let token;

  if (authReq.headers.authorization?.startsWith('Bearer')) {
    token = authReq.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return sendError(res, {
      message: 'Not authorized, no token',
      status: HttpStatus.UNAUTHORIZED,
    });
  }

  try {
    const decoded = verifyAccessToken(token);

    // Check if user is banned (Redis key set on ban action)
    const isBanned = await redis.get(`banned:${decoded.id}`);
    if (isBanned === '1') {
      return sendError(res, {
        message: 'Account suspended',
        status: HttpStatus.FORBIDDEN,
      });
    }

    authReq.user = decoded;
    next();
  } catch (error) {
    return sendError(res, {
      message: 'Not authorized, token failed',
      status: HttpStatus.UNAUTHORIZED,
    });
  }
};

export const authorize =
  (...roles: string[]) =>
    (req: AuthRequest, res: Response, next: NextFunction): void => {
      if (!req.user || !roles.includes(req.user.role)) {
        sendError(res, { message: 'Forbidden', status: HttpStatus.FORBIDDEN });
        return;
      }
      next();
    };
