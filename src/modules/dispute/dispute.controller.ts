import { Request, Response } from 'express';
import {
    createDispute,
    collectEvidence,
    evaluateDispute,
    resolveDispute,
    getDisputeById,
    listDisputes,
    getUserDisputes,
} from './dispute.service.js';

export const createDisputeHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { rideId, bookingId, reason, description } = req.body;
        const dispute = await createDispute({ rideId, bookingId, raisedBy: userId, reason, description });
        res.status(201).json({ success: true, data: dispute });
    } catch (err: any) {
        const errorMap: Record<string, number> = {
            BOOKING_NOT_FOUND: 404,
            BOOKING_RIDE_MISMATCH: 400,
            FORBIDDEN_DISPUTE: 403,
            DISPUTE_ALREADY_EXISTS: 409,
        };
        const status = errorMap[err.message] ?? 500;
        res.status(status).json({ success: false, error: err.message });
    }
};

export const getDisputeHandler = async (req: Request, res: Response) => {
    try {
        const dispute = await getDisputeById(req.params.id as string);
        if (!dispute) return res.status(404).json({ success: false, error: 'Dispute not found' });
        res.json({ success: true, data: dispute });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const myDisputesHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const disputes = await getUserDisputes(userId);
        res.json({ success: true, data: disputes });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

// Admin handlers
export const adminListDisputesHandler = async (req: Request, res: Response) => {
    try {
        const { status, page, limit } = req.query as any;
        const result = await listDisputes({
            status,
            page: page ? Number(page) : undefined,
            limit: limit ? Number(limit) : undefined,
        });
        res.json({ success: true, data: result });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const adminCollectEvidenceHandler = async (req: Request, res: Response) => {
    try {
        const evidence = await collectEvidence(req.params.id as string);
        res.json({ success: true, data: evidence });
    } catch (err: any) {
        if (err.message === 'DISPUTE_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Dispute not found' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
};

export const adminEvaluateHandler = async (req: Request, res: Response) => {
    try {
        const result = await evaluateDispute(req.params.id as string);
        res.json({ success: true, data: result });
    } catch (err: any) {
        if (err.message === 'DISPUTE_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Dispute not found' });
        }
        if (err.message === 'EVIDENCE_NOT_COLLECTED') {
            return res.status(400).json({ success: false, error: 'Collect evidence first' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
};

export const adminResolveHandler = async (req: Request, res: Response) => {
    try {
        const resolvedBy = (req as any).user.id;
        const { resolution } = req.body;
        const dispute = await resolveDispute(req.params.id as string, { resolution, resolvedBy });
        res.json({ success: true, data: dispute });
    } catch (err: any) {
        if (err.message === 'DISPUTE_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Dispute not found' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
};
