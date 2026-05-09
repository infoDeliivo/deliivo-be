import { prisma } from '../../config/index.js';
import redis from '../../cache/redis.js';
import type { CreateNotificationInput } from './notification.types.js';
import { sendPushToUser } from '../../services/push.service.js';
import logger from '../../utils/logger.js';

// Redis key for unread count cache (60s TTL)
const unreadKey = (userId: string) => `unread:${userId}`;

export const normalizeNotificationDataForTransport = (
    data?: Record<string, unknown>
): Record<string, string> => {
    if (!data) return {};

    return Object.fromEntries(
        Object.entries(data).map(([key, value]) => [key, value == null ? '' : String(value)])
    );
};

// ============ NOTIFICATION CRUD ============

/**
 * Create a notification, emit in real-time via WebSocket, and
 * send push notification via FCM/APNs if user is offline.
 */
export const createNotification = async (input: CreateNotificationInput) => {
    const { userId, type, title, body, data } = input;
    const normalizedData = normalizeNotificationDataForTransport(data);

    logger.info(`📬 Creating notification for user ${userId}, type: ${type}`);

    const notification = await prisma.notification.create({
        data: {
            userId,
            type,
            title,
            body,
            data: data ? (data as any) : undefined,
        },
    });

    logger.info(`✅ Notification ${notification.id} created in database`);

    // Increment cached unread count
    try {
        const key = unreadKey(userId);
        const exists = await redis.exists(key);
        if (exists) {
            await redis.incr(key);
        }
    } catch (error) {
        logger.error('Redis unread increment error:', error);
    }

    // Try real-time delivery via WebSocket
    let deliveredViaSocket = false;
    try {
        logger.info(`🔍 Attempting WebSocket delivery for user ${userId}, notification type: ${type}`);
        
        const { getIO, getUserSocketIds } = await import('../../socket/index.js');
        const io = getIO();
        
        if (!io) {
            logger.warn(`⚠️ Socket.IO instance not available for user ${userId}`);
            logger.warn(`⚠️ This means WebSocket server may not be initialized`);
        } else {
            logger.info(`✅ Socket.IO instance is available`);
            const socketIds = getUserSocketIds(userId);
            logger.info(`📡 User ${userId} has ${socketIds.length} active socket(s): ${socketIds.join(', ')}`);

            if (socketIds.length > 0) {
                // User is ONLINE — deliver via WebSocket
                const payload = {
                    type: 'notification.new',
                    data: {
                        id: notification.id,
                        title: notification.title,
                        body: notification.body,
                        notificationType: notification.type,
                        data: normalizedData,
                        preview: true,
                        createdAt: notification.createdAt,
                    },
                };

                logger.info(`📤 Emitting notification to ${socketIds.length} socket(s)`);
                logger.info(`📦 Payload:`, JSON.stringify(payload, null, 2));

                socketIds.forEach((sid: string) => {
                    io.to(sid).emit('notification:new', payload);
                    logger.info(`✅ Emitted 'notification:new' event to socket ${sid}`);
                });

                deliveredViaSocket = true;
                logger.info(`✅ WebSocket delivery successful for user ${userId}`);
            } else {
                logger.info(`📴 User ${userId} is OFFLINE - will send push notification`);
            }
        }
    } catch (error) {
        logger.error('❌ WebSocket notification emit error:', error);
        logger.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
    }

    // User is OFFLINE — send push notification via FCM/APNs
    if (!deliveredViaSocket) {
        logger.info(`📲 Sending push notification to user ${userId} (deliveredViaSocket=${deliveredViaSocket})`);
        try {
            await sendPushToUser(userId, {
                title,
                body,
                data: {
                    notificationId: notification.id,
                    type: notification.type,
                    ...normalizedData,
                },
            });
            logger.info(`✅ Push notification sent to user ${userId}`);
        } catch (error) {
            logger.error('Push notification error:', error);
        }
    }

    return notification;
};

/**
 * Get paginated notifications for a user (newest first).
 */
export const getNotifications = async (
    userId: string,
    cursor?: string,
    limit: number = 20,
) => {
    const notifications = await prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor && {
            cursor: { id: cursor },
            skip: 1,
        }),
        select: {
            id: true,
            type: true,
            title: true,
            body: true,
            data: true,
            isRead: true,
            readAt: true,
            createdAt: true,
        },
    });

    const hasMore = notifications.length > limit;
    const results = hasMore ? notifications.slice(0, limit) : notifications;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    return { notifications: results, nextCursor, hasMore };
};

// ============ READ RECEIPTS ============

/**
 * Mark specific notifications as read.
 */
export const markAsRead = async (userId: string, notificationIds: string[]) => {
    const now = new Date();

    const result = await prisma.notification.updateMany({
        where: {
            id: { in: notificationIds },
            userId, // Ensure user owns these notifications
            isRead: false,
        },
        data: {
            isRead: true,
            readAt: now,
        },
    });

    // Update cached unread count
    if (result.count > 0) {
        try {
            const key = unreadKey(userId);
            await redis.del(key); // Invalidate cache — will be re-fetched
        } catch (error) {
            logger.error('Redis unread cache invalidation error:', error);
        }
    }

    return { markedCount: result.count };
};

// ============ UNREAD COUNT ============

/**
 * Get unread notification count for a user.
 * Uses Redis cache with 60s TTL, falls back to DB.
 */
export const getUnreadCount = async (userId: string): Promise<number> => {
    const key = unreadKey(userId);

    // Try Redis cache first
    try {
        const cached = await redis.get(key);
        if (cached !== null) {
            return parseInt(cached, 10);
        }
    } catch (error) {
        logger.error('Redis unread count read error:', error);
    }

    // Fallback to DB
    const count = await prisma.notification.count({
        where: {
            userId,
            isRead: false,
        },
    });

    // Cache in Redis
    try {
        await redis.setex(key, 60, count.toString());
    } catch (error) {
        logger.error('Redis unread count cache error:', error);
    }

    return count;
};

// ============ DEVICE TOKEN OPERATIONS ============

/**
 * Register a device token for push notifications.
 * Upserts — if token already exists, updates the userId and lastSeenAt.
 */
export const registerDevice = async (userId: string, platform: string, token: string) => {
    const device = await prisma.deviceToken.upsert({
        where: { token },
        create: {
            userId,
            platform,
            token,
            lastSeenAt: new Date(),
        },
        update: {
            userId,
            platform,
            lastSeenAt: new Date(),
        },
    });

    return device;
};

/**
 * Remove a device token.
 */
export const removeDevice = async (userId: string, tokenId: string) => {
    const device = await prisma.deviceToken.findFirst({
        where: { id: tokenId, userId },
    });

    if (!device) {
        throw new Error('DEVICE_NOT_FOUND');
    }

    await prisma.deviceToken.delete({
        where: { id: tokenId },
    });
};
