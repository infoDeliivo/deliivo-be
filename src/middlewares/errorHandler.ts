import { Request, Response, NextFunction } from 'express';
import { logError } from '../utils/logger.js';

export const errorHandler = (err: any, _req: Request, res: Response, _next: NextFunction) => {
  const requestId = (res.locals as { requestId?: string }).requestId;
  logError('Unhandled error', err, {
    requestId,
    method: _req.method,
    path: _req.originalUrl,
  });

  const status = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal Server Error'
    : err.message || 'Internal Server Error';

  res.status(status).json({
    success: false,
    message,
    ...(requestId ? { requestId } : {}),
  });
};
