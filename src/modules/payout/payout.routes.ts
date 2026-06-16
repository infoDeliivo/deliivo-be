import { Router } from 'express';
import {
    processPayoutHandler,
    requestOwnPayoutHandler,
    checkEligibilityHandler,
    payoutHistoryHandler,
    earningsHandler,
    balanceHandler,
} from './payout.controller.js';

// Admin routes (mounted under /api/v1/admin/payouts)
export const adminPayoutRouter = Router();
adminPayoutRouter.post('/process', processPayoutHandler);
adminPayoutRouter.post('/check-eligibility', checkEligibilityHandler);

// Driver routes (mounted under /api/v1/drivers/me)
export const driverPayoutRouter = Router();
driverPayoutRouter.get('/payouts', payoutHistoryHandler);
driverPayoutRouter.post('/payouts/request', requestOwnPayoutHandler);
driverPayoutRouter.get('/earnings', earningsHandler);
driverPayoutRouter.get('/balance', balanceHandler);
