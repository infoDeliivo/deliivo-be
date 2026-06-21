import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { logHttp } from '../utils/logger.js';

export const requestContext = (req: Request, res: Response, next: NextFunction) => {
  const incomingRequestId = req.header('x-request-id')?.trim();
  const requestId = incomingRequestId || randomUUID();

  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);

  const startedAt = Date.now();
  let logged = false;

  const logRequest = (event: 'finish' | 'close') => {
    if (logged) return;
    logged = true;

    logHttp('HTTP request completed', {
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      event,
      userId: (req as Request & { user?: { id?: string } }).user?.id,
    });
  };

  res.on('finish', () => logRequest('finish'));
  res.on('close', () => {
    if (!res.writableEnded) {
      logRequest('close');
    }
  });

  next();
};
