import { prisma } from '../../config/index.js';
import { BookingStatus } from '@prisma/client';
import type { SendMessageInput, ImagePayload, LocationPayload } from './chat.types.js';

// ============ HELPERS ============

/**
 * Normalize user pair so userAId < userBId (lexicographic).
 * This ensures a unique conversation per 1:1 pair.
 */
const normalizePair = (id1: string, id2: string): [string, string] => {
    return id1 < id2 ? [id1, id2] : [id2, id1];
};

/**
 * Generate a preview string for the conversation list based on message type.
 */
const getMessagePreview = (type: string, text?: string | null): string => {
    switch (type) {
        case 'IMAGE':
            return text ? `📷 ${text.substring(0, 80)}` : '📷 Image';
        case 'LOCATION':
            return text ? `📍 ${text.substring(0, 80)}` : '📍 Location';
        case 'FILE':
            return text ? `📎 ${text.substring(0, 80)}` : '📎 File';
        case 'SYSTEM':
            return text ? text.substring(0, 100) : '[System]';
        default:
            return text ? text.substring(0, 100) : '';
    }
};

/**
 * Check if two users have a confirmed booking between them.
 * One user must be the passenger and the other must be the driver of the ride.
 * Only allows chat for CONFIRMED bookings — blocked after ride completion or cancellation.
 */
export const hasConfirmedBooking = async (userId1: string, userId2: string): Promise<boolean> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            status: BookingStatus.CONFIRMED,
            OR: [
                // userId1 is passenger, userId2 is driver
                {
                    passengerId: userId1,
                    ride: { driverId: userId2 },
                },
                // userId2 is passenger, userId1 is driver
                {
                    passengerId: userId2,
                    ride: { driverId: userId1 },
                },
            ],
        },
        select: { id: true },
    });

    return !!booking;
};

// ============ CONVERSATION OPERATIONS ============

/**
 * Get or create a 1:1 conversation between two users.
 */
export const getOrCreateConversation = async (userId1: string, userId2: string) => {
    const [userAId, userBId] = normalizePair(userId1, userId2);

    // Try to find existing conversation
    let conversation = await prisma.conversation.findUnique({
        where: { userAId_userBId: { userAId, userBId } },
    });

    if (!conversation) {
        conversation = await prisma.conversation.create({
            data: { userAId, userBId },
        });
    }

    return conversation;
};

/**
 * Get paginated conversation list for a user with last message and peer info.
 */
export const getConversations = async (
    userId: string,
    cursor?: string,
    limit: number = 20,
) => {
    const conversations = await prisma.conversation.findMany({
        where: {
            OR: [{ userAId: userId }, { userBId: userId }],
        },
        orderBy: { lastMsgAt: { sort: 'desc', nulls: 'last' } },
        take: limit + 1, // +1 to check for next page
        ...(cursor && {
            cursor: { id: cursor },
            skip: 1,
        }),
        include: {
            userA: {
                select: { id: true, name: true, avatarUrl: true },
            },
            userB: {
                select: { id: true, name: true, avatarUrl: true },
            },
            messages: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: {
                    id: true,
                    text: true,
                    senderId: true,
                    createdAt: true,
                    type: true,
                },
            },
        },
    });

    const hasMore = conversations.length > limit;
    const results = hasMore ? conversations.slice(0, limit) : conversations;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    // Build response with peer info and unread counts
    // Batch fetch unread counts for all conversations at once
    const conversationIds = results.map(conv => conv.id);
    const unreadCounts = await prisma.message.groupBy({
        by: ['conversationId'],
        where: {
            conversationId: { in: conversationIds },
            receiverId: userId,
            readAt: null,
        },
        _count: true,
    });
    const unreadMap = new Map(unreadCounts.map(c => [c.conversationId, c._count]));

    const items = results.map((conv) => {
        const peer = conv.userAId === userId ? conv.userB : conv.userA;
        const lastMessage = conv.messages[0] || null;

        return {
            id: conv.id,
            peer,
            lastMessage,
            unreadCount: unreadMap.get(conv.id) || 0,
            updatedAt: conv.updatedAt,
        };
    });

    return { items, nextCursor, hasMore };
};

// ============ MESSAGE OPERATIONS ============

/**
 * Send a message. Creates conversation if it doesn't exist.
 * Requires a confirmed booking between sender and receiver.
 * Uses a transaction to ensure atomicity.
 *
 * Supports TEXT, IMAGE, LOCATION, FILE, and SYSTEM types.
 * - For IMAGE: payloadJson should contain ImagePayload (imageUrl, etc.)
 * - For LOCATION: payloadJson should contain LocationPayload (latitude, longitude, etc.)
 */
export const sendMessage = async (senderId: string, data: SendMessageInput) => {
    const { receiverId, text, clientMsgId, type = 'TEXT', payloadJson } = data;

    // Prevent sending to self
    if (senderId === receiverId) {
        throw new Error('CANNOT_MESSAGE_SELF');
    }

    // Check booking authorization — only rider↔driver with a confirmed booking can chat
    const canChat = await hasConfirmedBooking(senderId, receiverId);
    if (!canChat) {
        throw new Error('NO_CONFIRMED_BOOKING');
    }

    // Validate message content based on type
    if (type === 'TEXT' && !text) {
        throw new Error('TEXT_REQUIRED');
    }
    if (type === 'IMAGE' && !(payloadJson as unknown as ImagePayload)?.imageUrl) {
        throw new Error('IMAGE_URL_REQUIRED');
    }
    if (type === 'LOCATION') {
        const loc = payloadJson as unknown as LocationPayload;
        if (!loc || typeof loc.latitude !== 'number' || typeof loc.longitude !== 'number') {
            throw new Error('LOCATION_REQUIRED');
        }
    }

    // Check for idempotency — if clientMsgId already exists, return existing message
    if (clientMsgId) {
        const existingMsg = await prisma.message.findUnique({
            where: { senderId_clientMsgId: { senderId, clientMsgId } },
        });
        if (existingMsg) return existingMsg;
    }

    // Get or create conversation
    const conversation = await getOrCreateConversation(senderId, receiverId);

    // Create message + update conversation in a transaction
    const message = await prisma.$transaction(async (tx) => {
        const msg = await tx.message.create({
            data: {
                conversationId: conversation.id,
                senderId,
                receiverId,
                type: type as any,
                text: text || null,
                payloadJson: payloadJson ? (payloadJson as any) : undefined,
                clientMsgId,
            },
        });

        // Update conversation last message info
        await tx.conversation.update({
            where: { id: conversation.id },
            data: {
                lastMsgAt: msg.createdAt,
                lastMsgPreview: getMessagePreview(type, text),
            },
        });

        return msg;
    });

    return message;
};

/**
 * Get paginated messages for a conversation.
 * Validates that the user is a participant.
 */
export const getMessages = async (
    userId: string,
    conversationId: string,
    cursor?: string,
    limit: number = 30,
) => {
    // Verify user is participant
    const conversation = await prisma.conversation.findFirst({
        where: {
            id: conversationId,
            OR: [{ userAId: userId }, { userBId: userId }],
        },
    });

    if (!conversation) {
        throw new Error('CONVERSATION_NOT_FOUND');
    }

    const messages = await prisma.message.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: limit + 1,
        ...(cursor && {
            cursor: { id: cursor },
            skip: 1,
        }),
        select: {
            id: true,
            conversationId: true,
            senderId: true,
            receiverId: true,
            type: true,
            text: true,
            payloadJson: true,
            clientMsgId: true,
            deliveredAt: true,
            readAt: true,
            createdAt: true,
        },
    });

    const hasMore = messages.length > limit;
    const results = hasMore ? messages.slice(0, limit) : messages;
    const nextCursor = hasMore ? results[results.length - 1].id : null;

    return { messages: results, nextCursor, hasMore };
};

// ============ RECEIPT OPERATIONS ============

/**
 * Mark all messages in a conversation as delivered for the receiver.
 */
export const markMessagesDelivered = async (userId: string, conversationId: string) => {
    await prisma.message.updateMany({
        where: {
            conversationId,
            receiverId: userId,
            deliveredAt: null,
        },
        data: { deliveredAt: new Date() },
    });
};

/**
 * Mark messages as read up to a specific message.
 */
export const markMessagesRead = async (
    userId: string,
    conversationId: string,
    lastReadMessageId: string,
) => {
    // Get the message timestamp to mark all messages up to that point as read
    const lastReadMessage = await prisma.message.findFirst({
        where: { id: lastReadMessageId, conversationId },
        select: { createdAt: true },
    });

    if (!lastReadMessage) {
        throw new Error('MESSAGE_NOT_FOUND');
    }

    const now = new Date();

    await prisma.message.updateMany({
        where: {
            conversationId,
            receiverId: userId,
            readAt: null,
            createdAt: { lte: lastReadMessage.createdAt },
        },
        data: {
            readAt: now,
            deliveredAt: now, // Also mark as delivered if not already
        },
    });
};

/**
 * Get total unread message count across all conversations for a user.
 */
export const getUnreadCount = async (userId: string) => {
    const count = await prisma.message.count({
        where: {
            receiverId: userId,
            readAt: null,
        },
    });

    return count;
};

// ============ SYNC OPERATIONS ============

/**
 * Get messages since a given timestamp (for offline sync).
 */
export const getMessagesSince = async (userId: string, since?: string) => {
    const messages = await prisma.message.findMany({
        where: {
            receiverId: userId,
            ...(since && { createdAt: { gt: new Date(since) } }),
            deliveredAt: null,
        },
        orderBy: { createdAt: 'asc' },
        take: 100, // Limit to prevent huge payloads
        select: {
            id: true,
            conversationId: true,
            senderId: true,
            receiverId: true,
            type: true,
            text: true,
            payloadJson: true,
            clientMsgId: true,
            deliveredAt: true,
            readAt: true,
            createdAt: true,
        },
    });

    return messages;
};
