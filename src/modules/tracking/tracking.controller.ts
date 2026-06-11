import { Request, Response } from 'express';
import { createTrackingLink, getTrackingData, revokeTrackingLink, listTrackingLinks } from './tracking.service.js';

export const createLinkHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { bookingId, accessScope, ttlHours } = req.body;
        const result = await createTrackingLink({ bookingId, createdBy: userId, accessScope, ttlHours });
        res.status(201).json({ success: true, data: result });
    } catch (err: any) {
        const errorMap: Record<string, number> = {
            BOOKING_NOT_FOUND: 404,
            FORBIDDEN: 403,
            BOOKING_NOT_TRACKABLE: 400,
        };
        res.status(errorMap[err.message] ?? 500).json({ success: false, error: err.message });
    }
};

export const getTrackingHandler = async (req: Request, res: Response) => {
    try {
        const { token } = req.params;
        const data = await getTrackingData(token as string);
        res.json({ success: true, data });
    } catch (err: any) {
        const errorMap: Record<string, number> = {
            TRACKING_LINK_NOT_FOUND: 404,
            TRACKING_LINK_REVOKED: 410,
            TRACKING_LINK_EXPIRED: 410,
        };
        res.status(errorMap[err.message] ?? 500).json({ success: false, error: err.message });
    }
};

export const revokeLinkHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        await revokeTrackingLink(req.params.id as string, userId);
        res.json({ success: true, message: 'Tracking link revoked' });
    } catch (err: any) {
        if (err.message === 'TRACKING_LINK_NOT_FOUND') {
            return res.status(404).json({ success: false, error: 'Not found' });
        }
        if (err.message === 'FORBIDDEN') {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};

export const listLinksHandler = async (req: Request, res: Response) => {
    try {
        const userId = (req as any).user.id;
        const { bookingId } = req.params;
        const links = await listTrackingLinks(bookingId as string, userId);
        res.json({ success: true, data: links });
    } catch (err: any) {
        if (err.message === 'FORBIDDEN') {
            return res.status(403).json({ success: false, error: 'Forbidden' });
        }
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
};
