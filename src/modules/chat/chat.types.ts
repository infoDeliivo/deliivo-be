// ============ Chat Types ============

export interface SendMessageInput {
    receiverId: string;
    text?: string;
    clientMsgId: string;
    bookingId?: string;
    type?: 'TEXT' | 'IMAGE' | 'FILE' | 'LOCATION' | 'SYSTEM';
    payloadJson?: Record<string, unknown>;
}

export interface ImagePayload {
    imageUrl: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    fileSize?: number;
    mimeType?: string;
}

export interface LocationPayload {
    latitude: number;
    longitude: number;
    address?: string;
    placeId?: string;
}

export interface PaginationQuery {
    cursor?: string;
    limit?: number;
}

export interface ConversationListItem {
    id: string;
    peer: {
        id: string;
        firstName: string | null;
        avatarUrl: string | null;
    };
    lastMessage: {
        id: string;
        text: string | null;
        senderId: string;
        createdAt: Date;
        type: string;
    } | null;
    unreadCount: number;
    updatedAt: Date;
}

export interface MessageItem {
    id: string;
    conversationId: string;
    senderId: string;
    receiverId: string;
    type: string;
    text: string | null;
    payloadJson: unknown;
    clientMsgId: string | null;
    deliveredAt: Date | null;
    readAt: Date | null;
    createdAt: Date;
}

// ============ WebSocket Event Types ============

export interface WsEventEnvelope<T = unknown> {
    type: string;
    id: string;
    ts: number;
    data: T;
}

export interface WsSendMessageData {
    receiverId: string;
    text?: string;
    clientMsgId: string;
    type?: string;
    payloadJson?: Record<string, unknown>;
}

export interface WsTypingData {
    conversationId: string;
    receiverId: string;
}

export interface WsSyncData {
    lastMessageTs?: string; // ISO timestamp
}

export interface WsDeliveredData {
    messageId: string;
    conversationId: string;
}

export interface WsReadData {
    conversationId: string;
    lastReadMessageId: string;
}
