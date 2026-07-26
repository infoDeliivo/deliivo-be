const mockPrisma = {
    dlVerification: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
};

const mockPost = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('axios', () => ({
    __esModule: true,
    default: { post: (...args: unknown[]) => mockPost(...args) },
}));

import { createSessionSchema } from './dl-verification.validator';

type SessionPayload = { verification: { callback?: string } };

const loadService = async (callbackEnv: string) => {
    process.env.VERIFF_CALLBACK_URL = callbackEnv;
    jest.resetModules();
    return import('./dl-verification.service');
};

const sentPayload = (): SessionPayload => JSON.parse(mockPost.mock.calls[0][1] as string);

describe('createSessionSchema — callback URL', () => {
    it('accepts an HTTPS callback', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            callback: 'https://example.com/return',
        });

        expect(parsed.success).toBe(true);
    });

    it('rejects an HTTP callback before it reaches Veriff', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            callback: 'http://localhost:3000/return',
        });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]?.message).toBe('Callback URL must use HTTPS');
    });
});

describe('createVeriffSession — callback resolution', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.dlVerification.findFirst.mockResolvedValue(null);
        mockPrisma.dlVerification.create.mockResolvedValue({ id: 'rec-1' });
        mockPost.mockResolvedValue({
            data: { verification: { id: 'sess-1', url: 'https://magic.veriff.me/v/sess-1' } },
        });
    });

    it('falls back to the configured HTTPS callback', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        await createVeriffSession({ userId: 'user-1', firstName: 'Jon', lastName: 'Smith' });

        expect(sentPayload().verification.callback).toBe('https://api.example.com/webhook');
    });

    it('omits a non-HTTPS callback instead of sending it to Veriff', async () => {
        const { createVeriffSession } = await loadService('http://localhost:3000/webhook');

        await createVeriffSession({ userId: 'user-1', firstName: 'Jon', lastName: 'Smith' });

        expect(sentPayload().verification.callback).toBeUndefined();
    });
});
