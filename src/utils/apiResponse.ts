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
  // Fix HTTP/2 RST_STREAM CANCEL on mobile devices
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Type': 'application/json; charset=utf-8',
    'Connection': 'close', // Forces HTTP/1.1 fallback
  });
  
  // Remove ETag to prevent caching issues
  res.removeHeader('ETag');
  
  const responseBody = {
    success: true,
    status,
    message,
    data,
  };
  
  // Calculate exact Content-Length
  const jsonString = JSON.stringify(responseBody);
  res.set('Content-Length', Buffer.byteLength(jsonString, 'utf8').toString());
  
  return res.status(statusMap[status]).send(jsonString);
};

export const sendError = (
  res: Response,
  {
    status = HttpStatus.INTERNAL_ERROR,
    message = 'Something went wrong',
    error = undefined,
  }: ErrorPayload,
) => {
  // Fix HTTP/2 RST_STREAM CANCEL on mobile devices
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Content-Type': 'application/json; charset=utf-8',
    'Connection': 'close', // Forces HTTP/1.1 fallback
  });
  
  // Remove ETag to prevent caching issues
  res.removeHeader('ETag');
  
  const responseBody = {
    success: false,
    status,
    message,
    error,
  };
  
  // Calculate exact Content-Length
  const jsonString = JSON.stringify(responseBody);
  res.set('Content-Length', Buffer.byteLength(jsonString, 'utf8').toString());
  
  return res.status(statusMap[status]).send(jsonString);
};
