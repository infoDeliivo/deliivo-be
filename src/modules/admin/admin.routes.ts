import { Router } from 'express';
import { authorize } from '../../middlewares/auth.js';
import { validate } from '../../middlewares/validate.js';
import * as adminController from './admin.controller.js';
import { pricingConfigCreateSchema, pricingConfigIdSchema, pricingConfigUpdateSchema } from '../pricing/pricing.validator.js';

const router = Router();

// All routes in this file are already protected by `protect` in app.ts
// authorize('ADMIN') enforces admin-only access
router.use(authorize('ADMIN') as any);

router.get('/users', adminController.listUsers as any);
router.get('/rides', adminController.listRides as any);
router.get('/revenue/ledger', adminController.getRevenueLedger as any);
router.get('/sos', adminController.listEmergencyAlerts as any);
router.post('/sos/:id/status', adminController.updateEmergencyAlertStatus as any);
router.post('/users/:id/ban', adminController.banUser as any);
router.post('/users/:id/unban', adminController.unbanUser as any);
router.get('/stats', adminController.getStats as any);
router.get('/stats/trends', adminController.getMonitoringTrends as any);
router.get('/ops/summary', adminController.getOperationsSummary as any);
router.post('/vehicles/:id/verify', adminController.verifyVehicle as any);
router.post('/bookings/:id/refund', adminController.adminRefundBooking as any);
router.get('/pricing/configs', adminController.listPricingConfigs as any);
router.post('/pricing/configs', validate({ body: pricingConfigCreateSchema }), adminController.createPricingConfig as any);
router.put('/pricing/configs/:id', validate({ params: pricingConfigIdSchema, body: pricingConfigUpdateSchema }), adminController.updatePricingConfig as any);

export default router;
