import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import {
    runHourlyReconciliation,
    runDailyReconciliation,
    listIssues,
    resolveIssue,
    getIssueSummary,
} from './reconciliation.service.js';

export const triggerHourlyReconciliation = async (req: AuthRequest, res: Response) => {
    try {
        const result = await runHourlyReconciliation();
        return sendSuccess(res, { message: 'Hourly reconciliation complete', data: result });
    } catch (err: any) {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: err.message });
    }
};

export const triggerDailyReconciliation = async (req: AuthRequest, res: Response) => {
    try {
        const result = await runDailyReconciliation();
        return sendSuccess(res, { message: 'Daily reconciliation complete', data: result });
    } catch (err: any) {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: err.message });
    }
};

export const listIssuesHandler = async (req: AuthRequest, res: Response) => {
    try {
        const { status, issueType, severity, page, limit } = req.query as Record<string, string | undefined>;
        const result = await listIssues({
            status: status as 'open' | 'resolved' | undefined,
            issueType,
            severity,
            page: page ? parseInt(page, 10) : undefined,
            limit: limit ? parseInt(limit, 10) : undefined,
        });
        return sendSuccess(res, { data: result });
    } catch (err: any) {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: err.message });
    }
};

export const resolveIssueHandler = async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id as string;
        const { resolution } = req.body;
        const result = await resolveIssue(id, req.user.id, resolution);
        return sendSuccess(res, { message: 'Issue resolved', data: result });
    } catch (err: any) {
        if (err.message === 'ISSUE_NOT_FOUND') {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Issue not found' });
        }
        if (err.message === 'ISSUE_ALREADY_RESOLVED') {
            return sendError(res, { status: HttpStatus.CONFLICT, message: 'Issue already resolved' });
        }
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: err.message });
    }
};

export const summaryHandler = async (req: AuthRequest, res: Response) => {
    try {
        const result = await getIssueSummary();
        return sendSuccess(res, { data: result });
    } catch (err: any) {
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: err.message });
    }
};
