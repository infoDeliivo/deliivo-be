const mockPrisma = {
    dlVerification: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
    user: {
        findUnique: jest.fn(),
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

type SessionPayload = {
    verification: {
        callback?: string;
        person: { firstName?: string; lastName?: string; email?: string; phoneNumber?: string };
    };
};

const loadService = async (callbackEnv: string) => {
    process.env.VERIFF_CALLBACK_URL = callbackEnv;
    jest.resetModules();
    return import('./dl-verification.service');
};

const sentPayload = (): SessionPayload => JSON.parse(mockPost.mock.calls[0][1] as string);

describe('createSessionSchema', () => {
    it('accepts an HTTPS callback', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            callback: 'https://example.com/return',
        });

        expect(parsed.success).toBe(true);
    });

    // A non-HTTPS callback is recoverable — the service drops it and falls back to
    // VERIFF_CALLBACK_URL — so it must not 400 the whole request.
    it('accepts an HTTP callback and leaves the decision to the service', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            callback: 'http://localhost:3000/return',
        });

        expect(parsed.success).toBe(true);
    });

    it('still rejects a callback that is not a URL at all', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            callback: 'not a url',
        });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]?.message).toBe('Invalid callback URL');
    });

    // This is KYC — the caller must state the identity being verified.
    it('rejects an empty body', () => {
        const parsed = createSessionSchema.safeParse({});

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues.map((i) => i.path.join('.'))).toEqual(
            expect.arrayContaining(['firstName', 'lastName']),
        );
    });

    // A phone-registered driver has no email and an email-registered one has no phone. The
    // client forwards the profile verbatim, so null is what "not set" looks like on the wire.
    it('accepts a null email from a phone-registered driver', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            email: null,
        });

        expect(parsed.success).toBe(true);
    });

    it('accepts a null phoneNumber from an email-registered driver', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            phoneNumber: null,
        });

        expect(parsed.success).toBe(true);
    });

    // Null means "not set". A malformed value is still a caller error.
    it('still rejects a malformed email', () => {
        const parsed = createSessionSchema.safeParse({
            firstName: 'Jon',
            lastName: 'Smith',
            email: 'not-an-email',
        });

        expect(parsed.success).toBe(false);
        expect(parsed.error?.issues[0]?.message).toBe('Invalid email format');
    });

    // DOB and gender come from the profile, so a caller-supplied value is stripped
    // rather than forwarded to Veriff.
    it('strips dateOfBirth and gender from the body', () => {
        const parsed = createSessionSchema.parse({
            firstName: 'Jon',
            lastName: 'Smith',
            dateOfBirth: '1980-01-01',
            gender: 'F',
        });

        expect(parsed).not.toHaveProperty('dateOfBirth');
        expect(parsed).not.toHaveProperty('gender');
    });
});

const dbProfile = {
    firstName: 'Jon',
    lastName: 'Smith',
    dob: new Date('1990-05-15T00:00:00Z'),
    gender: 'MALE',
    email: 'jon@example.com',
    phone: '+919876543210',
};

const caller = { userId: 'user-1', firstName: 'Jon', lastName: 'Smith' };

const resetSessionMocks = () => {
    jest.clearAllMocks();
    mockPrisma.dlVerification.findFirst.mockResolvedValue(null);
    mockPrisma.dlVerification.create.mockResolvedValue({ id: 'rec-1' });
    mockPrisma.user.findUnique.mockResolvedValue(dbProfile);
    mockPost.mockResolvedValue({
        data: { verification: { id: 'sess-1', url: 'https://magic.veriff.me/v/sess-1' } },
    });
};

describe('createVeriffSession — callback resolution', () => {
    beforeEach(resetSessionMocks);

    it('falls back to the configured HTTPS callback', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        await createVeriffSession(caller);

        expect(sentPayload().verification.callback).toBe('https://api.example.com/webhook');
    });

    it('omits a non-HTTPS callback instead of sending it to Veriff', async () => {
        const { createVeriffSession } = await loadService('http://localhost:3000/webhook');

        await createVeriffSession(caller);

        expect(sentPayload().verification.callback).toBeUndefined();
    });

    // The reported 400: a caller-supplied HTTP callback used to be rejected by the
    // validator. It now reaches the service, which drops it for the configured one.
    it('drops a caller-supplied non-HTTPS callback and uses the configured one', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        await createVeriffSession({ ...caller, callback: 'http://localhost:3000/return' });

        expect(sentPayload().verification.callback).toBe('https://api.example.com/webhook');
    });
});

describe('createVeriffSession — KYC identity gate', () => {
    beforeEach(resetSessionMocks);

    it('sends the profile DOB and gender, not anything the caller could supply', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        const res = await createVeriffSession(caller);

        expect(res.success).toBe(true);
        expect(sentPayload().verification.person).toEqual({
            firstName: 'Jon',
            lastName: 'Smith',
            dateOfBirth: '1990-05-15',
            gender: 'M',
            email: 'jon@example.com',
            phoneNumber: '+919876543210',
        });
    });

    it('rejects a name that is not the caller own profile name', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        const res = await createVeriffSession({ ...caller, firstName: 'Bob', lastName: 'Jones' });

        expect(res).toEqual({ success: false, reason: 'NAME_DOES_NOT_MATCH_PROFILE' });
        expect(mockPost).not.toHaveBeenCalled();
    });

    // Exact matching, so an extra middle name the profile does not carry is a mismatch.
    it('rejects an extra middle name the profile does not have', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        const res = await createVeriffSession({ ...caller, firstName: 'Jon Michael' });

        expect(res).toEqual({ success: false, reason: 'NAME_DOES_NOT_MATCH_PROFILE' });
    });

    it('accepts accent and case variance of the profile name', async () => {
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        const res = await createVeriffSession({ ...caller, firstName: 'jón' });

        expect(res.success).toBe(true);
    });

    // The webhook needs DOB and gender to verify anyone, so an incomplete profile is
    // blocked before a Veriff check is spent on a decision that must be withheld.
    it.each([
        ['no DOB', { dob: null }],
        ['no gender', { gender: null }],
        ['a gender Veriff cannot assert', { gender: 'NON_BINARY' }],
        ['no last name', { lastName: null }],
    ])('refuses a profile with %s', async (_label, override) => {
        mockPrisma.user.findUnique.mockResolvedValue({ ...dbProfile, ...override });
        const { createVeriffSession } = await loadService('https://api.example.com/webhook');

        const res = await createVeriffSession(caller);

        expect(res).toEqual({ success: false, reason: 'PROFILE_INCOMPLETE' });
        expect(mockPost).not.toHaveBeenCalled();
    });
});
