import { Request, Response, NextFunction } from 'express';
import { logError } from '../utils/logger.js';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  logError('Unhandled error', err);
  res.status(500).json({
    success: false,
    message: err.message || 'Internal Server Error',
  });
};
