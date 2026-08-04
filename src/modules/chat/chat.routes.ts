import { Router } from 'express';
import { validate } from '../../middlewares/validate.js';
import * as controller from './chat.controller.js';
import {
    getConversationsQuerySchema,
    getMessagesQuerySchema,
    conversationIdParamSchema,
    sendMessageSchema,
    sendImageSchema,
    sendLocationSchema,
    openConversationSchema,
    markReadSchema,
} from './chat.validator.js';

const router = Router();

// List user's conversations (paginated)
router.get(
    '/',
    validate({ query: getConversationsQuerySchema }),
    controller.getConversations,
);

// Get unread message count
router.get('/unread-count', controller.getUnreadCount);

// Open or create a conversation with an active ride participant
router.post(
    '/open',
    validate({ body: openConversationSchema }),
    controller.openConversation,
);

// Get messages in a conversation (paginated)
router.get(
    '/:conversationId/messages',
    validate({
        params: conversationIdParamSchema,
        query: getMessagesQuerySchema,
    }),
    controller.getMessages,
);

// Send a text message
router.post(
    '/send',
    validate({ body: sendMessageSchema }),
    controller.sendMessage,
);

// Send an image message. The image is uploaded first via the presigned flow
// (POST /uploads/presign + /confirm, target=chat_image); the confirmed URL is passed here.
router.post(
    '/send-image',
    validate({ body: sendImageSchema }),
    controller.sendImage,
);

// Send a location message
router.post(
    '/send-location',
    validate({ body: sendLocationSchema }),
    controller.sendLocation,
);

// Mark messages as read in a conversation
router.post(
    '/:conversationId/read',
    validate({
        params: conversationIdParamSchema,
        body: markReadSchema,
    }),
    controller.markRead,
);

export default router;
