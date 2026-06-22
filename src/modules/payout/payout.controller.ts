import { Request, Response } from 'express';
import { processDriverPayout, getDriverPayoutHistory, checkAndMarkEligible, getEligiblePayoutCandidates } from './payout.service.js';
import { getDriverEarningItems, getDriverEarnings, getDriverBalance } from '../ledger/ledger.service.js';

export const processPayoutHandler = async (req: Request, res: Response) => {
    try {
        const { driverId } = req.body;
        if (!driverId) {
            return res.status(400).json({ success: false, error: 'driverId required' });
        }
        const result = await processDriverPayout(driverId);
        res.json({ success: true, data: result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const requestOwnPayoutHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const result = await processDriverPayout(userId);
        res.json({ success: true, data: result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const checkEligibilityHandler = async (_req: Request, res: Response) => {
    try {
        const result = await checkAndMarkEligible();
        res.json({ success: true, data: result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const eligiblePayoutCandidatesHandler = async (_req: Request, res: Response) => {
    try {
        const candidates = await getEligiblePayoutCandidates();
        res.json({ success: true, data: candidates });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const payoutHistoryHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const history = await getDriverPayoutHistory(userId);
        res.json({ success: true, data: history });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const earningsHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const earnings = await getDriverEarnings(userId);
        res.json({ success: true, data: earnings });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const balanceHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const balance = await getDriverBalance(userId);
        res.json({ success: true, data: balance });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const earningItemsHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const items = await getDriverEarningItems(userId);
        res.json({ success: true, data: items });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};
