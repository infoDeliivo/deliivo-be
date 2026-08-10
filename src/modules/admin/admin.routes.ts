import { Router } from 'express';
import { authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import * as adminController from './admin.controller.js';
import { pricingConfigCreateSchema, pricingConfigIdSchema, pricingConfigUpdateSchema } from '../pricing/pricing.validator.js';
import {
    adminForceCompleteBookingSchema,
    adminOpenBookingDisputeSchema,
    bookingIdParamSchema,
    rejectVehicleSchema,
    vehicleIdParamSchema,
} from './admin.validator.js';
import * as dlReviewController from '../dl-verification/dl-review.controller.js';
import { declineDlSchema, dlUserIdParamSchema } from '../dl-verification/dl-verification.validator.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { AuthRequest } from '../../types/auth.js';

const router = Router();

// All routes in this file are already protected by `protect` in app.ts
// authorize('ADMIN') enforces admin-only access
router.use(authorize('ADMIN') as any);

router.get('/users', adminController.listUsers as any);
router.get('/users/:id', adminController.getUserDetails as any);
router.get('/rides', adminController.listRides as any);
router.get('/revenue/ledger', adminController.getRevenueLedger as any);
router.get('/sos', adminController.listEmergencyAlerts as any);
router.post('/sos/:id/status', adminController.updateEmergencyAlertStatus as any);
router.post('/users/:id/ban', adminController.banUser as any);
router.post('/users/:id/unban', adminController.unbanUser as any);
router.post(
    '/users/:id/require-veriff',
    validate({ params: dlUserIdParamSchema }),
    asyncHandler<AuthRequest>(adminController.requireVeriffForUser),
);
router.get('/stats', adminController.getStats as any);
router.get('/stats/trends', adminController.getMonitoringTrends as any);
router.get('/ops/summary', adminController.getOperationsSummary as any);
// Vehicle review queue. Private documents come back as `previewKey` — exchange them for
// a signed URL via GET /uploads/read (admins may read any owner's key).
router.get('/vehicles', asyncHandler<AuthRequest>(adminController.listVehicles));
router.post(
    '/vehicles/:id/verify',
    validate({ params: vehicleIdParamSchema }),
    asyncHandler<AuthRequest>(adminController.verifyVehicle),
);
router.post(
    '/vehicles/:id/reject',
    validate({ params: vehicleIdParamSchema, body: rejectVehicleSchema }),
    asyncHandler<AuthRequest>(adminController.rejectVehicle),
);
// Driving-licence review queue. The licence image comes back as `previewKey` —
// exchange it for a signed URL via GET /uploads/read, same as the vehicle registry doc.
router.get('/dl-verifications', asyncHandler<AuthRequest>(dlReviewController.listQueue));
router.post(
    '/dl-verifications/:userId/approve',
    validate({ params: dlUserIdParamSchema }),
    asyncHandler<AuthRequest>(dlReviewController.approve),
);
router.post(
    '/dl-verifications/:userId/decline',
    validate({ params: dlUserIdParamSchema, body: declineDlSchema }),
    asyncHandler<AuthRequest>(dlReviewController.decline),
);

router.post('/bookings/:id/refund', adminController.adminRefundBooking as any);
router.post(
    '/bookings/:id/force-complete',
    validate({ params: bookingIdParamSchema, body: adminForceCompleteBookingSchema }),
    adminController.adminForceCompleteBooking as any,
);
router.post(
    '/bookings/:id/open-dispute',
    validate({ params: bookingIdParamSchema, body: adminOpenBookingDisputeSchema }),
    adminController.adminOpenBookingDispute as any,
);
router.get('/pricing/configs', adminController.listPricingConfigs as any);
router.post('/pricing/configs', validate({ body: pricingConfigCreateSchema }), adminController.createPricingConfig as any);
router.put('/pricing/configs/:id', validate({ params: pricingConfigIdSchema, body: pricingConfigUpdateSchema }), adminController.updatePricingConfig as any);

export default router;
