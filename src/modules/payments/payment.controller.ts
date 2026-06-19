import { Response } from 'express';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { getRiderTransactions } from './payment.service.js';

export const riderTransactions = async (req: AuthRequest, res: Response) => {
    try {
        const transactions = await getRiderTransactions(req.user.id);
        return sendSuccess(res, { message: 'Transactions fetched', data: transactions });
    } catch {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch transactions',
        });
    }
};
