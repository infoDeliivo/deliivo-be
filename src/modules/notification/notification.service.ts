import { prisma } from '../../config/index.js';
import redis from '../../cache/redis.js';
import type { CreateNotificationInput } from './notification.types.js';
import { sendPushToUser } from '../../services/push.service.js';
import logger from '../../utils/logger.js';
import { pushQueue } from '../../jobs/index.js';
import { RideStatus } from '@prisma/client';

// Redis key for unread count cache (60s TTL)
const unreadKey = (userId: string) => `unread:${userId}`;
const OVERDUE_UNSTARTED_RIDE_MINUTES = Number(process.env.RIDE_OVERDUE_CANCEL_AFTER_MINUTES || '120');
const TERMINAL_RIDE_STATUSES = new Set<RideStatus>([RideStatus.COMPLETED, RideStatus.CANCELLED]);
const UNSTARTED_RIDE_STATUSES = new Set<RideStatus>([
    RideStatus.PUBLISHED,
    RideStatus.SCHEDULED,
    RideStatus.READY_TO_START,
]);
const staleCleanupInFlight = new Map<string, Promise<number>>();

const getRideId = (data: unknown): string | null => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const rideId = (data as Record<string, unknown>).rideId;
    return typeof rideId === 'string' && rideId.trim() ? rideId.trim() : null;
};

const getDepartureAt = (departureDate: Date, departureTime: string): Date | null => {
    const [hoursRaw, minutesRaw] = departureTime.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
        return null;
    }

    return new Date(Date.UTC(
        departureDate.getUTCFullYear(),
        departureDate.getUTCMonth(),
        departureDate.getUTCDate(),
        hours,
        minutes,
    ));
};

const invalidateUnreadCount = async (userId: string) => {
    try {
        await redis.del(unreadKey(userId));
    } catch (error) {
        logger.error('Redis unread cache invalidation error:', error);
    }
};

/** Remove ride activity notifications that can no longer lead to an active ride. */
export const removeStaleRideNotifications = async (userId: string): Promise<number> => {
    const existing = staleCleanupInFlight.get(userId);
    if (existing) return existing;

    const cleanup = (async () => {
        const notificationRows = await prisma.notification.findMany({
            where: { userId },
            select: { id: true, data: true },
        });
        const notificationRideIds = new Map<string, string>();

        for (const row of notificationRows) {
            const rideId = getRideId(row.data);
            if (rideId) notificationRideIds.set(row.id, rideId);
        }

        const rideIds = [...new Set(notificationRideIds.values())];
        if (rideIds.length === 0) return 0;

        const rides = await prisma.ride.findMany({
            where: { id: { in: rideIds } },
            select: {
                id: true,
                status: true,
                departureDate: true,
                departureTime: true,
                actualStartTime: true,
            },
        });
        const ridesById = new Map(rides.map((ride) => [ride.id, ride]));
        const now = Date.now();
        const staleRideIds = new Set<string>();

        for (const rideId of rideIds) {
            const ride = ridesById.get(rideId);
            if (!ride) {
                staleRideIds.add(rideId);
                continue;
            }
            if (TERMINAL_RIDE_STATUSES.has(ride.status)) {
                staleRideIds.add(rideId);
                continue;
            }
            if (UNSTARTED_RIDE_STATUSES.has(ride.status) && !ride.actualStartTime) {
                const departureAt = getDepartureAt(ride.departureDate, ride.departureTime);
                if (departureAt && now >= departureAt.getTime() + OVERDUE_UNSTARTED_RIDE_MINUTES * 60 * 1000) {
                    staleRideIds.add(rideId);
                }
            }
        }

        const notificationIds = [...notificationRideIds.entries()]
            .filter(([, rideId]) => staleRideIds.has(rideId))
            .map(([notificationId]) => notificationId);
        if (notificationIds.length === 0) return 0;

        const result = await prisma.notification.deleteMany({
            where: { userId, id: { in: notificationIds } },
        });
        if (result.count > 0) await invalidateUnreadCount(userId);
        return result.count;
    })().finally(() => {
        staleCleanupInFlight.delete(userId);
    });

    staleCleanupInFlight.set(userId, cleanup);
    return cleanup;
};

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
        const { getIO, getUserSocketIds } = await import('../../socket/index.js');
        const io = getIO();
        
        if (!io) {
            logger.warn('Socket.IO not initialized');
        } else {
            const socketIds = await getUserSocketIds(userId);

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

                socketIds.forEach((sid: string) => {
                    io.to(sid).emit('notification:new', payload);
                });
                deliveredViaSocket = true;
            }
        }
    } catch (error) {
        logger.error('WebSocket notification emit error:', error);
    }

    // User is OFFLINE — enqueue push notification for async delivery
    if (!deliveredViaSocket) {
        try {
            await pushQueue.add('push', {
                userId,
                payload: {
                    title,
                    body,
                    data: {
                        notificationId: notification.id,
                        type: notification.type,
                        ...normalizedData,
                    },
                },
            });
        } catch (error) {
            logger.error('Push queue enqueue error:', error);
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
    await removeStaleRideNotifications(userId);
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

export const deleteNotification = async (userId: string, notificationId: string) => {
    const result = await prisma.notification.deleteMany({
        where: { id: notificationId, userId },
    });
    if (result.count > 0) await invalidateUnreadCount(userId);
    return { deletedCount: result.count };
};

export const clearNotifications = async (userId: string) => {
    const result = await prisma.notification.deleteMany({ where: { userId } });
    if (result.count > 0) await invalidateUnreadCount(userId);
    return { deletedCount: result.count };
};

// ============ UNREAD COUNT ============

/**
 * Get unread notification count for a user.
 * Uses Redis cache with 60s TTL, falls back to DB.
 */
export const getUnreadCount = async (userId: string): Promise<number> => {
    await removeStaleRideNotifications(userId);
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
