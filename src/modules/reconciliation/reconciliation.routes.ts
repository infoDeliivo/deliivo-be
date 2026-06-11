import { Router } from 'express';
import {
    triggerHourlyReconciliation,
    triggerDailyReconciliation,
    listIssuesHandler,
    resolveIssueHandler,
    summaryHandler,
} from './reconciliation.controller.js';

// Mounted at /api/v1/admin/reconciliation (admin-only, protected)
export const reconciliationRouter = Router();

// Trigger reconciliation manually
reconciliationRouter.post('/run/hourly', triggerHourlyReconciliation);
reconciliationRouter.post('/run/daily', triggerDailyReconciliation);

// Issue management
reconciliationRouter.get('/summary', summaryHandler);
reconciliationRouter.get('/issues', listIssuesHandler);
reconciliationRouter.post('/issues/:id/resolve', resolveIssueHandler);
