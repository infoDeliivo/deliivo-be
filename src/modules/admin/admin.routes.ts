import { Router } from 'express';
import { authorize } from '../../middlewares/auth.js';
import * as adminController from './admin.controller.js';

const router = Router();

// All routes in this file are already protected by `protect` in app.ts
// authorize('ADMIN') enforces admin-only access
router.use(authorize('ADMIN') as any);

router.get('/users', adminController.listUsers as any);
router.get('/rides', adminController.listRides as any);
router.get('/revenue/ledger', adminController.getRevenueLedger as any);
router.post('/users/:id/ban', adminController.banUser as any);
router.post('/users/:id/unban', adminController.unbanUser as any);
router.get('/stats', adminController.getStats as any);
router.post('/vehicles/:id/verify', adminController.verifyVehicle as any);
router.post('/bookings/:id/refund', adminController.adminRefundBooking as any);

export default router;
