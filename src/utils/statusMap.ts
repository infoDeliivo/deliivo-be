import { HttpStatus } from './httpStatus.js';

export const statusMap: Record<HttpStatus, number> = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  TOO_MANY_REQUESTS: 429,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};
