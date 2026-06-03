import { Response } from 'express';
import * as NotificationService from './notification.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';

/* ================= LIST NOTIFICATIONS ================= */
export const getNotifications = async (req: AuthRequest, res: Response) => {
    try {
        const cursor = req.query.cursor as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        const result = await NotificationService.getNotifications(req.user.id, cursor, limit);

        return sendSuccess(res, {
            message: 'Notifications fetched successfully',
            data: result,
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch notifications',
        });
    }
};

/* ================= MARK AS READ ================= */
export const markAsRead = async (req: AuthRequest, res: Response) => {
    try {
        const { notificationIds } = req.body;
        const result = await NotificationService.markAsRead(req.user.id, notificationIds);

        return sendSuccess(res, {
            message: 'Notifications marked as read',
            data: result,
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to mark notifications as read',
        });
    }
};

/* ================= UNREAD COUNT ================= */
export const getUnreadCount = async (req: AuthRequest, res: Response) => {
    try {
        const count = await NotificationService.getUnreadCount(req.user.id);

        return sendSuccess(res, {
            message: 'Unread count fetched successfully',
            data: { unreadCount: count },
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch unread count',
        });
    }
};

/* ================= REGISTER DEVICE ================= */
export const registerDevice = async (req: AuthRequest, res: Response) => {
    try {
        const { platform, token } = req.body;
        const device = await NotificationService.registerDevice(req.user.id, platform, token);

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Device registered successfully',
            data: device,
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to register device',
        });
    }
};

/* ================= REMOVE DEVICE ================= */
export const removeDevice = async (req: AuthRequest, res: Response) => {
    try {
        const tokenId = req.params.tokenId as string;
        await NotificationService.removeDevice(req.user.id, tokenId);

        return sendSuccess(res, {
            message: 'Device removed successfully',
        });
    } catch (error: any) {
        if (error.message === 'DEVICE_NOT_FOUND') {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Device token not found',
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to remove device',
        });
    }
};
