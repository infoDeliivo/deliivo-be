import { prisma } from '../../config/index.js';
import { pushQueue } from '../../jobs/index.js';
import { emitToUsers, getUserSocketIds } from '../../socket/index.js';
import logger from '../../utils/logger.js';
import { getMessagePreview } from './chat.service.js';

type ChatMessageForNotify = {
    id: string;
    conversationId: string;
    senderId: string;
    receiverId: string;
    type: string;
    text: string | null;
    payloadJson?: unknown;
    clientMsgId?: string | null;
    createdAt?: Date;
};

/** What the receiving app shows as the chat's title: the sender's name. */
export const chatSenderName = async (senderId: string): Promise<string> => {
    const sender = await prisma.user.findUnique({
        where: { id: senderId },
        select: { firstName: true, lastName: true },
    });
    return [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim() || 'New message';
};

/**
 * Push a chat message to a receiver who has no live socket, so it still reaches them.
 *
 * The title is the sender's name and the data carries senderId / senderName /
 * conversationId, so tapping it opens the right conversation with the name shown.
 * Chat is deliberately push-only, not an in-app notification row, so the notification
 * panel is not flooded with every message.
 *
 * The job id is the message id: a client retry that resends the same message (sendMessage
 * returns the existing row for a repeated clientMsgId) cannot push it twice.
 */
export const pushChatMessageIfOffline = async (message: ChatMessageForNotify): Promise<boolean> => {
    try {
        const receiverSockets = await getUserSocketIds(message.receiverId);
        if (receiverSockets.length > 0) return false;

        const senderName = await chatSenderName(message.senderId);
        await pushQueue.add(
            'push',
            {
                userId: message.receiverId,
                payload: {
                    title: senderName,
                    body: getMessagePreview(message.type, message.text) || 'Sent you a message',
                    // FCM data values must be strings.
                    data: {
                        type: 'chat.message',
                        messageId: message.id,
                        conversationId: message.conversationId,
                        senderId: message.senderId,
                        senderName,
                        deepLink: `app://chat/${message.conversationId}`,
                    },
                },
            },
            { jobId: `chat-${message.id}` },
        );
        return true;
    } catch (error) {
        // A failed push must never fail the send; the message is already stored.
        logger.error('Chat push enqueue error:', error);
        return false;
    }
};

/**
 * Delivery for messages sent over REST (text, image, location). The socket `chat:send`
 * path delivers live itself; these routes used to only store the message, so the receiver
 * saw nothing until they reopened the chat. Live delivery when the receiver is connected,
 * push otherwise.
 */
export const deliverChatMessage = async (message: ChatMessageForNotify): Promise<void> => {
    try {
        const delivered = await emitToUsers([message.receiverId], 'chat:message', {
            id: message.id,
            conversationId: message.conversationId,
            senderId: message.senderId,
            senderName: await chatSenderName(message.senderId),
            receiverId: message.receiverId,
            type: message.type,
            text: message.text,
            payloadJson: message.payloadJson ?? null,
            clientMsgId: message.clientMsgId ?? null,
            createdAt: message.createdAt,
        });
        if (delivered > 0) return;
    } catch (error) {
        logger.error('Chat live delivery error:', error);
    }
    await pushChatMessageIfOffline(message);
};
