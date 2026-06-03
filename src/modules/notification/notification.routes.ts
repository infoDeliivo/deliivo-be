import { Router } from 'express';
import {
    getNotifications,
    markAsRead,
    getUnreadCount,
    registerDevice,
    removeDevice,
} from './notification.controller.js';
import { validate } from '../../middlewares/validate.js';
import {
    getNotificationsQuerySchema,
    markReadSchema,
    registerDeviceSchema,
    tokenIdParamSchema,
} from './notification.validator.js';

const notificationRouter = Router();

// ============ Notification Routes ============

// GET /notifications — paginated list
notificationRouter.get(
    '/',
    validate({ query: getNotificationsQuerySchema }),
    getNotifications,
);

// POST /notifications/mark-read — mark notifications as read
notificationRouter.post(
    '/mark-read',
    validate({ body: markReadSchema }),
    markAsRead,
);

// GET /notifications/unread-count — cached unread count
notificationRouter.get('/unread-count', getUnreadCount);

// ============ Device Token Routes ============

// POST /notifications/device-token — register device for push
notificationRouter.post(
    '/device-token',
    validate({ body: registerDeviceSchema }),
    registerDevice,
);

// DELETE /notifications/devices/:tokenId — remove device token
notificationRouter.delete(
    '/devices/:tokenId',
    validate({ params: tokenIdParamSchema }),
    removeDevice,
);

export default notificationRouter;
