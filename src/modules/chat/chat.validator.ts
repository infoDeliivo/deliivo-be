import { z } from 'zod';

// ============ Param Schemas ============

export const conversationIdParamSchema = z.object({
    conversationId: z.string().uuid('Invalid conversation ID'),
});

// ============ Query Schemas ============

export const getConversationsQuerySchema = z.object({
    cursor: z.string().uuid().optional(),
    limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 20))
        .pipe(z.number().int().min(1).max(50)),
});

export const getMessagesQuerySchema = z.object({
    cursor: z.string().uuid().optional(),
    limit: z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : 30))
        .pipe(z.number().int().min(1).max(100)),
});

// ============ Body Schemas ============

export const sendMessageSchema = z.object({
    receiverId: z.string().uuid('Invalid receiver ID'),
    text: z.string().min(1, 'Message text is required').max(5000, 'Message too long'),
    clientMsgId: z.string().min(1, 'Client message ID is required').max(100),
    type: z.string().optional().default('TEXT'),
    payloadJson: z.record(z.string(), z.unknown()).optional(),
});

export const sendImageSchema = z.object({
    receiverId: z.string().uuid('Invalid receiver ID'),
    clientMsgId: z.string().min(1, 'Client message ID is required').max(100),
    text: z.string().max(5000, 'Caption too long').optional(),
    // Image is uploaded via the presigned flow (target=chat_image); the confirmed
    // public URL is passed here rather than a multipart file.
    imageUrl: z.string().url('A valid imageUrl is required'),
    mimeType: z.string().max(100).optional(),
    fileSize: z.number().int().nonnegative().optional(),
});

export const sendLocationSchema = z.object({
    receiverId: z.string().uuid('Invalid receiver ID'),
    clientMsgId: z.string().min(1, 'Client message ID is required').max(100),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    address: z.string().max(500).optional(),
    placeId: z.string().max(255).optional(),
    text: z.string().max(5000, 'Message too long').optional(),
});

export const openConversationSchema = z.object({
    receiverId: z.string().uuid('Invalid receiver ID'),
});

export const openBookingConversationSchema = z.object({
    bookingId: z.string().uuid('Invalid booking ID'),
});

export const markReadSchema = z.object({
    lastReadMessageId: z.string().uuid('Invalid message ID'),
});

export const syncQuerySchema = z.object({
    lastMessageTs: z.string().datetime().optional(),
});
