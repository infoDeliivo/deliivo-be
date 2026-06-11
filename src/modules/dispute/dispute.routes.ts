import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import {
    createDisputeHandler,
    getDisputeHandler,
    myDisputesHandler,
    adminListDisputesHandler,
    adminCollectEvidenceHandler,
    adminEvaluateHandler,
    adminResolveHandler,
} from './dispute.controller.js';
import { createDisputeSchema, resolveDisputeSchema } from './dispute.validator.js';

// User-facing routes (mounted at /api/v1/disputes)
export const disputeRouter = Router();
disputeRouter.post('/', validate({ body: createDisputeSchema }), createDisputeHandler);
disputeRouter.get('/me', myDisputesHandler);
disputeRouter.get('/:id', getDisputeHandler);

// Admin routes (mounted at /api/v1/admin/disputes)
export const adminDisputeRouter = Router();
adminDisputeRouter.get('/', adminListDisputesHandler);
adminDisputeRouter.get('/:id', getDisputeHandler);
adminDisputeRouter.post('/:id/collect-evidence', adminCollectEvidenceHandler);
adminDisputeRouter.post('/:id/evaluate', adminEvaluateHandler);
adminDisputeRouter.post('/:id/resolve', validate({ body: resolveDisputeSchema }), adminResolveHandler);
