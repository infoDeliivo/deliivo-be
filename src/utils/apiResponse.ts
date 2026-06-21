import { Response } from 'express';
import { HttpStatus } from './httpStatus.js';
import { statusMap } from './statusMap.js';

interface SuccessPayload {
  status?: HttpStatus;
  message?: string;
  data?: any;
}

interface ErrorPayload {
  status?: HttpStatus;
  message?: string;
  error?: any;
}

export const sendSuccess = (
  res: Response,
  { status = HttpStatus.OK, message = 'Success', data = null }: SuccessPayload,
) => {
  const requestId = (res.locals as { requestId?: string }).requestId;
  return res.status(statusMap[status]).json({
    success: true,
    status,
    message,
    data,
    ...(requestId ? { requestId } : {}),
  });
};

export const sendError = (
  res: Response,
  {
    status = HttpStatus.INTERNAL_ERROR,
    message = 'Something went wrong',
    error = undefined,
  }: ErrorPayload,
) => {
  const requestId = (res.locals as { requestId?: string }).requestId;
  return res.status(statusMap[status]).json({
    success: false,
    status,
    message,
    error,
    ...(requestId ? { requestId } : {}),
  });
};
