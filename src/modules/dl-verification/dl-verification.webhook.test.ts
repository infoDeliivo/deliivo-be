import crypto from 'crypto';
import type { Request, Response } from 'express';

const mockPrisma = {
    dlVerification: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
        // An approval also closes any open manual submission, in one transaction with
        // the user update.
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
    $transaction: jest.fn((operations: unknown[]) => Promise.all(operations)),
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

const SECRET = 'veriff-shared-secret';

// The service reads VERIFF_SHARED_SECRET at module load, so every test loads a fresh
// copy of both modules with the env it needs.
const loadModules = async (secret: string | undefined) => {
    jest.resetModules();
    if (secret === undefined) {
        delete process.env.VERIFF_SHARED_SECRET;
    } else {
        process.env.VERIFF_SHARED_SECRET = secret;
    }
    const service = await import('./dl-verification.service.js');
    const controller = await import('./dl-verification.controller.js');
    return { service, controller };
};

const sign = (payload: string, secret = SECRET) =>
    crypto.createHmac('sha256', secret).update(payload).digest('hex');

interface FakeResponse {
    res: Response;
    statusCode: number | null;
    payload: unknown;
}

const buildResponse = (): FakeResponse => {
    const state: FakeResponse = { res: null as unknown as Response, statusCode: null, payload: null };
    const res = {
        // sendError reads res.locals.requestId
        locals: {} as Record<string, unknown>,
        status(code: number) {
            state.statusCode = code;
            return this;
        },
        json(body: unknown) {
            state.payload = body;
            return this;
        },
    };
    state.res = res as unknown as Response;
    return state;
};

const buildRequest = (body: unknown, signature?: string): Request =>
    ({
        body,
        headers: signature === undefined ? {} : { 'x-hmac-signature': signature },
    }) as unknown as Request;

describe('validateWebhookSignature', () => {
    afterAll(() => {
        process.env.VERIFF_SHARED_SECRET = SECRET;
    });

    it('accepts a signature over the exact bytes received', async () => {
        const { service } = await loadModules(SECRET);
        const raw = '{"verification":{"id":"s1"}}';

        expect(service.validateWebhookSignature(Buffer.from(raw), sign(raw))).toBe(true);
    });

    // The digest covers bytes, not structure: re-serialising a parsed body changes the
    // whitespace and therefore the signature. This is what a JSON-parsed mount broke.
    it('rejects a payload that was re-serialised after parsing', async () => {
        const { service } = await loadModules(SECRET);
        const raw = '{\n  "verification": {\n    "id": "s1"\n  }\n}';
        const reserialised = JSON.stringify(JSON.parse(raw));

        expect(service.validateWebhookSignature(Buffer.from(raw), sign(raw))).toBe(true);
        expect(service.validateWebhookSignature(reserialised, sign(raw))).toBe(false);
    });

    it('rejects a signature produced with a different secret', async () => {
        const { service } = await loadModules(SECRET);
        const raw = '{"verification":{"id":"s1"}}';

        expect(service.validateWebhookSignature(raw, sign(raw, 'wrong-secret'))).toBe(false);
    });

    // timingSafeEqual throws on a length mismatch, which used to surface as a 500.
    it.each([
        ['too short', 'abcd'],
        ['odd length', 'abc'],
        ['non-hex', 'z'.repeat(64)],
        ['empty', ''],
        ['double length', 'a'.repeat(128)],
    ])('returns false instead of throwing for a %s signature', async (_label, signature) => {
        const { service } = await loadModules(SECRET);

        expect(() => service.validateWebhookSignature('{}', signature)).not.toThrow();
        expect(service.validateWebhookSignature('{}', signature)).toBe(false);
    });

    // An unset secret would otherwise HMAC with an empty key, which anyone can forge.
    it('rejects everything when the shared secret is not configured', async () => {
        const { service } = await loadModules(undefined);
        const raw = '{"verification":{"id":"s1"}}';

        expect(service.validateWebhookSignature(raw, sign(raw, ''))).toBe(false);
    });
});

describe('assertVeriffWebhookConfigured', () => {
    const originalNodeEnv = process.env.NODE_ENV;

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
    });

    afterAll(() => {
        process.env.VERIFF_SHARED_SECRET = SECRET;
    });

    it('throws in production when the secret is missing', async () => {
        process.env.NODE_ENV = 'production';
        const { service } = await loadModules(undefined);

        expect(() => service.assertVeriffWebhookConfigured()).toThrow(/VERIFF_SHARED_SECRET/);
    });

    it('only warns outside production', async () => {
        process.env.NODE_ENV = 'development';
        const { service } = await loadModules(undefined);

        expect(() => service.assertVeriffWebhookConfigured()).not.toThrow();
    });

    it('passes when the secret is set', async () => {
        process.env.NODE_ENV = 'production';
        const { service } = await loadModules(SECRET);

        expect(() => service.assertVeriffWebhookConfigured()).not.toThrow();
    });
});

describe('webhook controller — raw body', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.dlVerification.findUnique.mockResolvedValue({ id: 'rec-1', userId: 'user-1' });
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            firstName: 'Jon',
            lastName: 'Smith',
            dob: new Date('1990-05-15T00:00:00Z'),
            gender: 'MALE',
        });
    });

    afterAll(() => {
        process.env.VERIFF_SHARED_SECRET = SECRET;
    });

    it('processes a decision whose signature covers the raw bytes', async () => {
        const { controller } = await loadModules(SECRET);
        const raw = JSON.stringify({
            verification: {
                id: 'veriff-session-1',
                status: 'approved',
                code: 9001,
                person: { firstName: 'Jon', lastName: 'Smith', dateOfBirth: '1990-05-15', gender: 'M' },
            },
        });
        const response = buildResponse();

        await controller.webhook(buildRequest(Buffer.from(raw), sign(raw)), response.res);

        expect(response.statusCode).toBe(200);
        expect(response.payload).toEqual({ received: true, status: 'APPROVED' });
        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { dlVerified: true },
        });
    });

    it('rejects a forged signature without touching the user', async () => {
        const { controller } = await loadModules(SECRET);
        const raw = JSON.stringify({ verification: { id: 'veriff-session-1', status: 'approved' } });
        const response = buildResponse();

        await controller.webhook(buildRequest(Buffer.from(raw), sign(raw, 'wrong-secret')), response.res);

        expect(response.statusCode).toBe(401);
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
    });

    it('returns 401 when the signature header is absent', async () => {
        const { controller } = await loadModules(SECRET);
        const response = buildResponse();

        await controller.webhook(buildRequest(Buffer.from('{}')), response.res);

        expect(response.statusCode).toBe(401);
        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
    });

    // A parsed object here means the express.raw() mount ordering regressed.
    it('refuses a body that is not raw bytes', async () => {
        const { controller } = await loadModules(SECRET);
        const body = { verification: { id: 'veriff-session-1', status: 'approved' } };
        const response = buildResponse();

        await controller.webhook(buildRequest(body, sign(JSON.stringify(body))), response.res);

        expect(response.statusCode).toBe(400);
        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
    });

    it('acknowledges a correctly signed body that is not JSON', async () => {
        const { controller } = await loadModules(SECRET);
        const raw = 'not-json';
        const response = buildResponse();

        await controller.webhook(buildRequest(Buffer.from(raw), sign(raw)), response.res);

        expect(response.statusCode).toBe(200);
        expect(response.payload).toEqual({ received: true, warning: 'INVALID_PAYLOAD' });
        expect(mockPrisma.dlVerification.update).not.toHaveBeenCalled();
    });
});
