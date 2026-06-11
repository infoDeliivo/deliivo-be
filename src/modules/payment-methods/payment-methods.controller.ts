import { Request, Response } from 'express';
import {
    listPaymentMethods,
    createSetupIntent,
    savePaymentMethod,
    setDefaultPaymentMethod,
    removePaymentMethod,
} from './payment-methods.service.js';

export const listHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const methods = await listPaymentMethods(userId);
        res.json({ success: true, data: methods });
    } catch {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const setupIntentHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const result = await createSetupIntent(userId);
        res.json({ success: true, data: result });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const saveHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { stripePaymentMethodId, stripeCustomerId } = req.body;
        const pm = await savePaymentMethod(userId, stripePaymentMethodId, stripeCustomerId);
        res.json({ success: true, data: pm });
    } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
    }
};

export const setDefaultHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { id } = req.params;
        const pm = await setDefaultPaymentMethod(userId, id as string);
        res.json({ success: true, data: pm });
    } catch (err: any) {
        if (err.code === 'P2025') {
            return res.status(404).json({ success: false, error: 'Payment method not found' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
};

export const removeHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { id } = req.params;
        await removePaymentMethod(userId, id as string);
        res.json({ success: true, message: 'Payment method removed' });
    } catch (err: any) {
        if (err.message === 'PAYMENT_METHOD_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Payment method not found' });
        }
        res.status(500).json({ success: false, error: err.message });
    }
};
