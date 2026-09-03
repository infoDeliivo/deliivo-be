// Mocks (names prefixed with `mock` so jest.mock factories may reference them).
const mockHeadObject = jest.fn();
const mockPromoteObject = jest.fn();
const mockDeleteObject = jest.fn();
const mockBuildPublicUrl = jest.fn((key: string) => `https://cdn.test/${key}`);
const mockUpdateAvatarService = jest.fn();
const mockUpdateVehicle = jest.fn();
const mockAddVehicleDocument = jest.fn();
const mockUserOwnsVehicle = jest.fn();
const mockDeleteCache = jest.fn();
const mockClearAvatarService = jest.fn();
const mockClearVehicleImage = jest.fn();
const mockDeleteVehicleDocument = jest.fn();
const mockGetPresignedDownloadUrl = jest.fn();

// Real owner-parsing logic mirrored here so the mocked module keeps readUrl's
// authorization behavior; the pure function itself is unit-tested in s3.service.test.ts.
const realOwnerIdFromKey = (key: string): string | null => {
    const parts = key.split('/');
    return parts.length >= 4 && parts[0] === 'uploads' ? parts[2] : null;
};

jest.mock('../../services/s3.service.js', () => ({
    getPresignedUploadUrl: jest.fn(),
    getPresignedDownloadUrl: mockGetPresignedDownloadUrl,
    headObject: mockHeadObject,
    promoteObject: mockPromoteObject,
    deleteObject: mockDeleteObject,
    buildPublicUrl: mockBuildPublicUrl,
    ownerIdFromKey: realOwnerIdFromKey,
    TMP_PREFIX: 'tmp',
    PERMANENT_PREFIX: 'uploads',
}));
jest.mock('../../services/cache.service.js', () => ({
    deleteCache: mockDeleteCache,
    cacheKeys: {
        user: (id: string) => `user:${id}`,
        userProfile: (id: string) => `userProfile:${id}`,
        publicProfile: (id: string) => `publicProfile:${id}`,
        vehicle: (id: string) => `vehicle:${id}`,
        userVehicles: (id: string) => `userVehicles:${id}`,
    },
}));
jest.mock('../vehicles/vehicle.service.js', () => ({
    userOwnsVehicle: mockUserOwnsVehicle,
    updateVehicle: mockUpdateVehicle,
    addVehicleDocument: mockAddVehicleDocument,
    findVehicleDocumentByKey: jest.fn(),
    clearVehicleImage: mockClearVehicleImage,
    deleteVehicleDocument: mockDeleteVehicleDocument,
}));
jest.mock('../user/user.service.js', () => ({
    updateAvatarService: mockUpdateAvatarService,
    clearAvatarService: mockClearAvatarService,
}));
// The presign -> confirm ledger writes to Redis; keep the unit test off a real client.
const mockRedisDel = jest.fn();
jest.mock('../../cache/redis.js', () => ({
    __esModule: true,
    default: { setex: jest.fn(), del: mockRedisDel, get: jest.fn(), scan: jest.fn() },
}));

import { confirmUpload, deleteUpload, readUrl } from './uploads.controller.js';

type JsonResponse = { status: number; body: unknown };
const makeRes = () => {
    const out: JsonResponse = { status: 0, body: null };
    const res = {
        locals: {} as Record<string, unknown>,
        status(code: number) {
            out.status = code;
            return res;
        },
        json(payload: unknown) {
            out.body = payload;
            return res;
        },
    };
    return { res, out };
};

beforeEach(() => {
    jest.clearAllMocks();
    mockHeadObject.mockResolvedValue({ exists: true, contentType: 'image/png', contentLength: 1000 });
    mockPromoteObject.mockImplementation(async (_tmp: string, perm: string) => perm);
    mockBuildPublicUrl.mockImplementation((key: string) => `https://cdn.test/${key}`);
});

describe('confirmUpload — avatar replace deletes the previous object', () => {
    it('deletes the previous key when it differs from the new one', async () => {
        mockUpdateAvatarService.mockResolvedValue({ success: true, previousKey: 'uploads/avatar/u1/old.png' });
        const { res, out } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'avatar', key: 'tmp/avatar/u1/new.png' } } as never,
            res as never,
        );
        expect(mockPromoteObject).toHaveBeenCalledWith('tmp/avatar/u1/new.png', 'uploads/avatar/u1/new.png', true);
        expect(mockDeleteObject).toHaveBeenCalledWith('uploads/avatar/u1/old.png');
        expect(out.body).toMatchObject({ success: true });
    });

    it('does not delete when there was no previous key', async () => {
        mockUpdateAvatarService.mockResolvedValue({ success: true, previousKey: undefined });
        const { res } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'avatar', key: 'tmp/avatar/u1/new.png' } } as never,
            res as never,
        );
        expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it('does not delete when the previous key equals the new key', async () => {
        mockUpdateAvatarService.mockResolvedValue({ success: true, previousKey: 'uploads/avatar/u1/new.png' });
        const { res } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'avatar', key: 'tmp/avatar/u1/new.png' } } as never,
            res as never,
        );
        expect(mockDeleteObject).not.toHaveBeenCalled();
    });
});

describe('confirmUpload — vehicle_image replace deletes the previous object', () => {
    it('deletes the previous image key', async () => {
        mockUserOwnsVehicle.mockResolvedValue(true);
        mockUpdateVehicle.mockResolvedValue({ success: true, previousImageKey: 'uploads/vehicle/u1/old.png' });
        const { res } = makeRes();
        await confirmUpload(
            {
                user: { id: 'u1' },
                body: { target: 'vehicle_image', key: 'tmp/vehicle/u1/new.png', vehicleId: 'v1' },
            } as never,
            res as never,
        );
        expect(mockDeleteObject).toHaveBeenCalledWith('uploads/vehicle/u1/old.png');
    });
});

// A client that never saw the confirm response retries it. By then promoteObject has
// already deleted the tmp/ object, so the naive existence check reported the file as
// missing and the upload could not be recovered.
describe('confirmUpload — is idempotent so a retried confirm succeeds', () => {
    const alreadyPromoted = (tmpKey: string, permanentKey: string) =>
        mockHeadObject.mockImplementation(async (key: string) =>
            key === permanentKey
                ? { exists: true, contentType: 'image/png', contentLength: 1000 }
                : { exists: false },
        );

    it('returns success without re-promoting when the permanent object already exists', async () => {
        alreadyPromoted('tmp/vehicle/u1/x.png', 'uploads/vehicle/u1/x.png');
        const { res, out } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'vehicle_draft_document', key: 'tmp/vehicle/u1/x.png' } } as never,
            res as never,
        );
        expect(mockPromoteObject).not.toHaveBeenCalled();
        expect(out.body).toMatchObject({
            success: true,
            data: { key: 'uploads/vehicle/u1/x.png', url: 'https://cdn.test/uploads/vehicle/u1/x.png' },
        });
    });

    it('produces the same payload on the first and the retried call', async () => {
        const first = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'vehicle_draft_document', key: 'tmp/vehicle/u1/x.png' } } as never,
            first.res as never,
        );

        alreadyPromoted('tmp/vehicle/u1/x.png', 'uploads/vehicle/u1/x.png');
        const retry = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'vehicle_draft_document', key: 'tmp/vehicle/u1/x.png' } } as never,
            retry.res as never,
        );

        expect(retry.out.body).toEqual(first.out.body);
    });

    it('still rejects when neither the staged nor the permanent object exists', async () => {
        mockHeadObject.mockResolvedValue({ exists: false });
        const { res, out } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'vehicle_draft_document', key: 'tmp/vehicle/u1/x.png' } } as never,
            res as never,
        );
        expect(out.status).toBe(400);
        expect(mockPromoteObject).not.toHaveBeenCalled();
    });

    it('clears the pending-upload ledger entry once the object is permanent', async () => {
        const { res } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target: 'vehicle_draft_document', key: 'tmp/vehicle/u1/x.png' } } as never,
            res as never,
        );
        expect(mockRedisDel).toHaveBeenCalledWith('pendingUpload:tmp/vehicle/u1/x.png');
    });
});

describe('confirmUpload — one-shot public targets return {url,key} without an owner write', () => {
    it.each(['chat_image', 'vehicle_draft_document'] as const)('%s', async (target) => {
        const folder = target === 'chat_image' ? 'chat' : 'vehicle';
        const { res, out } = makeRes();
        await confirmUpload(
            { user: { id: 'u1' }, body: { target, key: `tmp/${folder}/u1/x.png` } } as never,
            res as never,
        );
        expect(mockUpdateAvatarService).not.toHaveBeenCalled();
        expect(mockUpdateVehicle).not.toHaveBeenCalled();
        expect(mockAddVehicleDocument).not.toHaveBeenCalled();
        expect(mockDeleteObject).not.toHaveBeenCalled();
        expect(out.body).toMatchObject({
            success: true,
            data: { key: expect.stringContaining('uploads/'), url: expect.stringContaining('https://cdn.test/') },
        });
    });
});

describe('confirmUpload — private draft doc promotes privately and returns only a key', () => {
    it('returns { key } (no url) and does not grant public read', async () => {
        const { res, out } = makeRes();
        await confirmUpload(
            {
                user: { id: 'u1' },
                body: { target: 'vehicle_draft_document_private', key: 'tmp/vehicle-documents/u1/x.png' },
            } as never,
            res as never,
        );
        // Promoted privately (isPublic = false), tmp/ -> uploads/.
        expect(mockPromoteObject).toHaveBeenCalledWith(
            'tmp/vehicle-documents/u1/x.png',
            'uploads/vehicle-documents/u1/x.png',
            false,
        );
        const data = (out.body as { data: { key: string; url?: string } }).data;
        expect(data.key).toBe('uploads/vehicle-documents/u1/x.png');
        expect(data.url).toBeUndefined();
        expect(mockAddVehicleDocument).not.toHaveBeenCalled();
    });
});

describe('readUrl — view a private object you own', () => {
    it('returns a signed URL when the caller owns the key', async () => {
        mockGetPresignedDownloadUrl.mockResolvedValue('https://signed.test/doc');
        const { res, out } = makeRes();
        await readUrl(
            { user: { id: 'u1' }, query: { key: 'uploads/vehicle-documents/u1/doc.png' } } as never,
            res as never,
        );
        expect(mockGetPresignedDownloadUrl).toHaveBeenCalledWith('uploads/vehicle-documents/u1/doc.png', 300);
        expect(out.body).toMatchObject({
            success: true,
            data: { url: 'https://signed.test/doc', expiresIn: 300 },
        });
    });

    it('404 when the key belongs to another owner', async () => {
        const { res, out } = makeRes();
        await readUrl(
            { user: { id: 'u1' }, query: { key: 'uploads/vehicle-documents/u2/doc.png' } } as never,
            res as never,
        );
        expect(out.status).toBe(404);
        expect(mockGetPresignedDownloadUrl).not.toHaveBeenCalled();
    });

    it('404 for a malformed / non-permanent key', async () => {
        const { res, out } = makeRes();
        await readUrl(
            { user: { id: 'u1' }, query: { key: 'tmp/vehicle-documents/u1/doc.png' } } as never,
            res as never,
        );
        expect(out.status).toBe(404);
        expect(mockGetPresignedDownloadUrl).not.toHaveBeenCalled();
    });
});

// Reviewing a vehicle means opening the registry document, which lives under the
// driver's owner segment — so admins are exempt from the owner rule.
describe('readUrl — admin review access', () => {
    it('returns a signed URL for a document owned by someone else', async () => {
        mockGetPresignedDownloadUrl.mockResolvedValue('https://signed.test/registry');
        const { res, out } = makeRes();
        await readUrl(
            {
                user: { id: 'admin-1', role: 'ADMIN' },
                query: { key: 'uploads/vehicle-documents/u2/registry.png' },
            } as never,
            res as never,
        );
        expect(mockGetPresignedDownloadUrl).toHaveBeenCalledWith(
            'uploads/vehicle-documents/u2/registry.png',
            300,
        );
        expect(out.body).toMatchObject({ success: true });
    });

    it('does not extend the exemption to other roles', async () => {
        const { res, out } = makeRes();
        await readUrl(
            {
                user: { id: 'u1', role: 'USER' },
                query: { key: 'uploads/vehicle-documents/u2/registry.png' },
            } as never,
            res as never,
        );
        expect(out.status).toBe(404);
        expect(mockGetPresignedDownloadUrl).not.toHaveBeenCalled();
    });
});

describe('deleteUpload', () => {
    it('avatar: clears the record and deletes the object', async () => {
        mockClearAvatarService.mockResolvedValue({ success: true, previousKey: 'uploads/avatar/u1/a.png' });
        const { res, out } = makeRes();
        await deleteUpload({ user: { id: 'u1' }, query: { target: 'avatar' } } as never, res as never);
        expect(mockClearAvatarService).toHaveBeenCalledWith('u1');
        expect(mockDeleteObject).toHaveBeenCalledWith('uploads/avatar/u1/a.png');
        expect(out.body).toMatchObject({ success: true });
    });

    it('avatar: no object delete when there was no key', async () => {
        mockClearAvatarService.mockResolvedValue({ success: true, previousKey: undefined });
        const { res } = makeRes();
        await deleteUpload({ user: { id: 'u1' }, query: { target: 'avatar' } } as never, res as never);
        expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it('vehicle_image: clears the record and deletes the object', async () => {
        mockClearVehicleImage.mockResolvedValue({ success: true, previousImageKey: 'uploads/vehicle/u1/v.png' });
        const { res } = makeRes();
        await deleteUpload(
            { user: { id: 'u1' }, query: { target: 'vehicle_image', vehicleId: 'v1' } } as never,
            res as never,
        );
        expect(mockClearVehicleImage).toHaveBeenCalledWith('u1', 'v1');
        expect(mockDeleteObject).toHaveBeenCalledWith('uploads/vehicle/u1/v.png');
    });

    it('vehicle_document: deletes the row and its object', async () => {
        mockDeleteVehicleDocument.mockResolvedValue({ id: 'doc1', imageKey: 'uploads/vehicle-documents/u1/d.png' });
        const { res, out } = makeRes();
        await deleteUpload(
            {
                user: { id: 'u1' },
                query: { target: 'vehicle_document', vehicleId: 'v1', key: 'uploads/vehicle-documents/u1/d.png' },
            } as never,
            res as never,
        );
        expect(mockDeleteObject).toHaveBeenCalledWith('uploads/vehicle-documents/u1/d.png');
        expect(out.body).toMatchObject({ success: true });
    });

    it('vehicle_document: 404 when the key is not found', async () => {
        mockDeleteVehicleDocument.mockResolvedValue(null);
        const { res, out } = makeRes();
        await deleteUpload(
            { user: { id: 'u1' }, query: { target: 'vehicle_document', vehicleId: 'v1', key: 'nope' } } as never,
            res as never,
        );
        expect(out.status).toBe(404);
        expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it('object-delete failure does not fail the request (best-effort)', async () => {
        mockClearAvatarService.mockResolvedValue({ success: true, previousKey: 'uploads/avatar/u1/a.png' });
        mockDeleteObject.mockRejectedValueOnce(new Error('bucket down'));
        const { res, out } = makeRes();
        await deleteUpload({ user: { id: 'u1' }, query: { target: 'avatar' } } as never, res as never);
        expect(out.body).toMatchObject({ success: true });
    });
});
