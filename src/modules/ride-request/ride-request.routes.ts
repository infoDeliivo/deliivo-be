import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../../types/auth.js';
import { sendSuccess, sendError } from '../../utils/apiResponse.js';
import { HttpStatus } from '../../utils/httpStatus.js';
import * as service from './ride-request.service.js';

const router = Router();
router.use((_req, res, next) => {
  if (process.env.RIDE_REQUESTS_ENABLED !== 'true')
    return sendError(res, {
      status: HttpStatus.NOT_FOUND,
      message: 'Ride requests are not available yet.',
    });
  next();
});
const uuid = z.string().uuid();
const listSchema = z.object({
  view: z.enum(['browse', 'mine', 'offers', 'admin']).default('browse'),
  page: z.coerce.number().int().min(1).max(10000).default(1),
  from: z.string().max(100).optional(),
  to: z.string().max(100).optional(),
  date: z.string().date().optional(),
  seats: z.coerce.number().int().min(1).max(8).optional(),
});
function route(action: (req: AuthRequest) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      return sendSuccess(res, {
        message: 'Ride request updated',
        data: await action(req as AuthRequest),
      });
    } catch (error) {
      if (error instanceof z.ZodError)
        return sendError(res, {
          status: HttpStatus.BAD_REQUEST,
          message: error.issues[0]?.message || 'Invalid request',
        });
      const message = error instanceof Error ? error.message : 'Unable to process request';
      // Never return database/Stripe internals to the browser.
      if (error && typeof error === 'object' && ('code' in error || 'type' in error)) {
        console.error('Ride request operation failed', error);
        return sendError(res, {
          status: HttpStatus.CONFLICT,
          message: 'This request changed or could not be processed. Refresh and try again.',
        });
      }
      return sendError(res, {
        status:
          message === 'NOT_FOUND'
            ? HttpStatus.NOT_FOUND
            : message === 'FORBIDDEN'
              ? HttpStatus.FORBIDDEN
              : HttpStatus.BAD_REQUEST,
        message,
      });
    }
  };
}
router.get(
  '/',
  route((req) =>
    service.listRequests(req.user.id, listSchema.parse(req.query), req.user.role === 'ADMIN'),
  ),
);
router.post(
  '/',
  route((req) => service.createRequest(req.user.id, service.requestSchema.parse(req.body))),
);
router.get(
  '/:id',
  route((req) =>
    service.requestDetails(uuid.parse(req.params.id), req.user.id, req.user.role === 'ADMIN'),
  ),
);
router.post(
  '/:id/cancel',
  route((req) =>
    service.closeRequest(uuid.parse(req.params.id), req.user.id, req.user.role === 'ADMIN'),
  ),
);
router.post(
  '/:id/offers',
  route((req) =>
    service.createOffer(
      uuid.parse(req.params.id),
      req.user.id,
      service.offerSchema.parse(req.body),
    ),
  ),
);
router.post(
  '/offers/:id/checkout',
  route((req) => service.checkoutOffer(uuid.parse(req.params.id), req.user.id)),
);
router.post(
  '/offers/:id/withdraw',
  route((req) => service.withdrawOffer(uuid.parse(req.params.id), req.user.id)),
);
export default router;
