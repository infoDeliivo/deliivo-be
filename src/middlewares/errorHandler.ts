import { Request, Response, NextFunction } from 'express';
import { logError } from '../utils/logger.js';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  logError('Unhandled error', err);

  const status = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    message,
  });
};
