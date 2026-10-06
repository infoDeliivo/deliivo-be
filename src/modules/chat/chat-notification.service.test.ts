const mockPrisma = { user: { findUnique: jest.fn() } };
const mockPushAdd = jest.fn();
const mockGetUserSocketIds = jest.fn();
const mockEmitToUsers = jest.fn();

jest.mock('../../config/index.js', () => ({ __esModule: true, prisma: mockPrisma }));
jest.mock('../../jobs/index.js', () => ({ __esModule: true, pushQueue: { add: (...args: unknown[]) => mockPushAdd(...args) } }));
jest.mock('../../socket/index.js', () => ({
    __esModule: true,
    getUserSocketIds: (...args: unknown[]) => mockGetUserSocketIds(...args),
    emitToUsers: (...args: unknown[]) => mockEmitToUsers(...args),
}));
jest.mock('./chat.service.js', () => ({
    __esModule: true,
    getMessagePreview: (type: string, text?: string | null) => (type === 'IMAGE' ? '📷 Image' : text ?? ''),
}));

import { deliverChatMessage, pushChatMessageIfOffline } from './chat-notification.service.js';

const message = {
    id: 'msg-1',
    conversationId: 'conv-1',
    senderId: 'driver-1',
    receiverId: 'rider-1',
    type: 'TEXT',
    text: "I'm outside the station",
};

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue({ firstName: 'Mart', lastName: 'Tamm' });
    mockPushAdd.mockResolvedValue({});
});

describe('pushChatMessageIfOffline', () => {
    it("pushes an offline receiver a notification titled with the sender's name", async () => {
        mockGetUserSocketIds.mockResolvedValue([]);

        await expect(pushChatMessageIfOffline(message)).resolves.toBe(true);

        expect(mockPushAdd).toHaveBeenCalledWith(
            'push',
            {
                userId: 'rider-1',
                payload: {
                    title: 'Mart Tamm',
                    body: "I'm outside the station",
                    data: {
                        type: 'chat.message',
                        messageId: 'msg-1',
                        conversationId: 'conv-1',
                        senderId: 'driver-1',
                        senderName: 'Mart Tamm',
                        deepLink: 'app://chat/conv-1',
                    },
                },
            },
            // One push per message, even if the client retries the send.
            { jobId: 'chat-msg-1' },
        );
    });

    it('does not push a receiver who is online (they get it live)', async () => {
        mockGetUserSocketIds.mockResolvedValue(['socket-1']);

        await expect(pushChatMessageIfOffline(message)).resolves.toBe(false);
        expect(mockPushAdd).not.toHaveBeenCalled();
    });

    it('previews an image and falls back to a generic title without a name', async () => {
        mockGetUserSocketIds.mockResolvedValue([]);
        mockPrisma.user.findUnique.mockResolvedValue({ firstName: null, lastName: null });

        await pushChatMessageIfOffline({ ...message, type: 'IMAGE', text: null });

        expect(mockPushAdd.mock.calls[0][1].payload).toMatchObject({ title: 'New message', body: '📷 Image' });
    });

    it('never fails the send when the push queue is down', async () => {
        mockGetUserSocketIds.mockResolvedValue([]);
        mockPushAdd.mockRejectedValue(new Error('redis down'));

        await expect(pushChatMessageIfOffline(message)).resolves.toBe(false);
    });
});

describe('deliverChatMessage (REST sends)', () => {
    it('delivers live with the sender name when the receiver is connected, without pushing', async () => {
        mockEmitToUsers.mockResolvedValue(1);

        await deliverChatMessage(message);

        expect(mockEmitToUsers).toHaveBeenCalledWith(['rider-1'], 'chat:message', expect.objectContaining({
            id: 'msg-1',
            senderId: 'driver-1',
            senderName: 'Mart Tamm',
        }));
        expect(mockPushAdd).not.toHaveBeenCalled();
    });

    it('pushes when no socket received it', async () => {
        mockEmitToUsers.mockResolvedValue(0);
        mockGetUserSocketIds.mockResolvedValue([]);

        await deliverChatMessage(message);

        expect(mockPushAdd).toHaveBeenCalledTimes(1);
    });
});
