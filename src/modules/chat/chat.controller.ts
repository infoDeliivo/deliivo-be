import { Response } from 'express';
import * as ChatService from './chat.service.js';
import { AuthRequest } from '../../middlewares/authMiddleware.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import type { ImagePayload, LocationPayload } from './chat.types.js';

/* ================= LIST CONVERSATIONS ================= */
export const getConversations = async (req: AuthRequest, res: Response) => {
    try {
        const { cursor, limit } = req.query as { cursor?: string; limit?: number };
        const result = await ChatService.getConversations(req.user.id, cursor, limit);

        return sendSuccess(res, {
            message: 'Conversations fetched successfully',
            data: result,
        });
    } catch (error: any) {
        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch conversations',
        });
    }
};

/* ================= GET MESSAGES ================= */
export const getMessages = async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string;
        const { cursor, limit } = req.query as { cursor?: string; limit?: number };

        const result = await ChatService.getMessages(
            req.user.id,
            conversationId,
            cursor,
            limit,
        );

        return sendSuccess(res, {
            message: 'Messages fetched successfully',
            data: result,
        });
    } catch (error: any) {
        if (error.message === 'CONVERSATION_NOT_FOUND') {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Conversation not found or you are not a participant',
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to fetch messages',
        });
    }
};

/* ================= SEND MESSAGE (TEXT) ================= */
export const sendMessage = async (req: AuthRequest, res: Response) => {
    try {
        const message = await ChatService.sendMessage(req.user.id, req.body);

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Message sent successfully',
            data: message,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to send message';

        switch (error.message) {
            case 'CANNOT_MESSAGE_SELF':
                status = HttpStatus.BAD_REQUEST;
                message = 'You cannot send a message to yourself';
                break;
            case 'NO_CONFIRMED_BOOKING':
            case 'CHAT_NOT_ACTIVE':
                status = HttpStatus.FORBIDDEN;
                message = 'Chat is available only while the ride is active';
                break;
            case 'TEXT_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Text is required for text messages';
                break;
        }

        return sendError(res, { status, message });
    }
};

/* ================= SEND IMAGE ================= */
export const sendImage = async (req: AuthRequest, res: Response) => {
    try {
        // Image already uploaded via the presigned flow (target=chat_image); the body
        // carries the confirmed public URL.
        const { imageUrl, mimeType, fileSize } = req.body as {
            imageUrl: string;
            mimeType?: string;
            fileSize?: number;
        };

        // Build image payload
        const imagePayload: ImagePayload = {
            imageUrl,
            mimeType,
            fileSize,
        };

        // Send message with IMAGE type
        const message = await ChatService.sendMessage(req.user.id, {
            receiverId: req.body.receiverId,
            clientMsgId: req.body.clientMsgId,
            text: req.body.text || undefined,
            type: 'IMAGE',
            payloadJson: imagePayload as any,
        });

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Image message sent successfully',
            data: message,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to send image message';

        switch (error.message) {
            case 'CANNOT_MESSAGE_SELF':
                status = HttpStatus.BAD_REQUEST;
                message = 'You cannot send a message to yourself';
                break;
            case 'NO_CONFIRMED_BOOKING':
            case 'CHAT_NOT_ACTIVE':
                status = HttpStatus.FORBIDDEN;
                message = 'Chat is available only while the ride is active';
                break;
        }

        return sendError(res, { status, message });
    }
};

/* ================= SEND LOCATION ================= */
export const sendLocation = async (req: AuthRequest, res: Response) => {
    try {
        const { receiverId, clientMsgId, latitude, longitude, address, placeId, text } = req.body;

        // Build location payload
        const locationPayload: LocationPayload = {
            latitude,
            longitude,
            ...(address && { address }),
            ...(placeId && { placeId }),
        };

        // Send message with LOCATION type
        const message = await ChatService.sendMessage(req.user.id, {
            receiverId,
            clientMsgId,
            text: text || undefined,
            type: 'LOCATION',
            payloadJson: locationPayload as any,
        });

        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Location message sent successfully',
            data: message,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to send location message';

        switch (error.message) {
            case 'CANNOT_MESSAGE_SELF':
                status = HttpStatus.BAD_REQUEST;
                message = 'You cannot send a message to yourself';
                break;
            case 'NO_CONFIRMED_BOOKING':
            case 'CHAT_NOT_ACTIVE':
                status = HttpStatus.FORBIDDEN;
                message = 'Chat is available only while the ride is active';
                break;
            case 'LOCATION_REQUIRED':
                status = HttpStatus.BAD_REQUEST;
                message = 'Valid latitude and longitude are required';
                break;
        }

        return sendError(res, { status, message });
    }
};

/* ================= OPEN CONVERSATION ================= */
export const openConversation = async (req: AuthRequest, res: Response) => {
    try {
        const result = await ChatService.openConversation(req.user.id, req.body.receiverId);

        return sendSuccess(res, {
            message: 'Conversation opened successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to open conversation';

        switch (error.message) {
            case 'CANNOT_MESSAGE_SELF':
                status = HttpStatus.BAD_REQUEST;
                message = 'You cannot open a conversation with yourself';
                break;
            case 'CHAT_NOT_ACTIVE':
                status = HttpStatus.FORBIDDEN;
                message = 'Chat is available only while the ride is active';
                break;
        }

        return sendError(res, { status, message });
    }
};

/* ================= OPEN CONVERSATION FOR BOOKING ================= */
export const openBookingConversation = async (req: AuthRequest, res: Response) => {
    try {
        const result = await ChatService.openBookingConversation(req.user.id, req.body.bookingId);

        return sendSuccess(res, {
            message: 'Conversation opened successfully',
            data: result,
        });
    } catch (error: any) {
        let status = HttpStatus.INTERNAL_ERROR;
        let message = 'Failed to open conversation';

        switch (error.message) {
            case 'BOOKING_NOT_FOUND':
                status = HttpStatus.NOT_FOUND;
                message = 'Booking not found';
                break;
            case 'FORBIDDEN_BOOKING_PARTICIPANT':
                status = HttpStatus.FORBIDDEN;
                message = 'You cannot open chat for this booking';
                break;
            case 'CHAT_NOT_ACTIVE':
                status = HttpStatus.FORBIDDEN;
                message = 'Chat is available only while the ride is active';
                break;
        }

        return sendError(res, { status, message });
    }
};

/* ================= MARK MESSAGES AS READ ================= */
export const markRead = async (req: AuthRequest, res: Response) => {
    try {
        const conversationId = req.params.conversationId as string;
        const { lastReadMessageId } = req.body;

        await ChatService.markMessagesRead(req.user.id, conversationId, lastReadMessageId);

        return sendSuccess(res, {
            message: 'Messages marked as read',
        });
    } catch (error: any) {
        if (error.message === 'MESSAGE_NOT_FOUND') {
            return sendError(res, {
                status: HttpStatus.NOT_FOUND,
                message: 'Message not found',
            });
        }

        return sendError(res, {
            status: HttpStatus.INTERNAL_ERROR,
            message: 'Failed to mark messages as read',
        });
    }
};

/* ================= GET UNREAD COUNT ================= */
export const getUnreadCount = async (req: AuthRequest, res: Response) => {
    try {
        const count = await ChatService.getUnreadCount(req.user.id);

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
