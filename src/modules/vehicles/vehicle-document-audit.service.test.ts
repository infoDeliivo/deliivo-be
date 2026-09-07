import { withPrismaFallback } from '../../test-utils/prisma-mock.js';

const mockPrisma = withPrismaFallback({
    vehicleDocument: { findMany: jest.fn(), update: jest.fn() },
    vehicle: { findUnique: jest.fn(), update: jest.fn() },
});

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

// The audit's whole job is asking storage whether an object is there, so this is the seam
// every case below drives.
const mockHeadObject = jest.fn();
jest.mock('../../services/s3.service.js', () => ({
    __esModule: true,
    headObject: (key: string) => mockHeadObject(key),
    keyFromPublicUrl: (url: string) => {
        const idx = url.indexOf('/uploads/');
        return idx === -1 ? null : url.slice(idx + 1);
    },
}));

const mockDeleteCache = jest.fn();
jest.mock('../../services/cache.service.js', () => ({
    __esModule: true,
    deleteCache: (key: string) => mockDeleteCache(key),
    cacheKeys: {
        vehicle: (id: string) => `vehicle:${id}`,
        userVehicles: (id: string) => `user:${id}:vehicles`,
    },
}));

const mockCreateNotification = jest.fn();
jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (input: unknown) => mockCreateNotification(input),
}));

const mockSendMail = jest.fn();
jest.mock('../mail/mail.service.js', () => ({
    __esModule: true,
    sendMail: (payload: unknown) => mockSendMail(payload),
}));

import { auditVehicleDocuments, resolveDocumentKey } from './vehicle-document-audit.service.js';

const OWNER = { id: 'user-1', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' };

const document = (overrides: Record<string, unknown> = {}) => ({
    id: 'doc-1',
    vehicleId: 'vehicle-1',
    documentType: 'VEHICLE_DOCUMENT',
    image: null,
    imageKey: 'uploads/vehicle-documents/user-1/registry.jpg',
    storageMissingAt: null,
    ...overrides,
});

const vehicleRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'vehicle-1',
    userId: OWNER.id,
    documentIssueNotifiedAt: null,
    brand: 'Skoda',
    model_name: 'Octavia',
    licenseNumber: '123ABC',
    user: OWNER,
    ...overrides,
});

/** One batch of documents, then an empty page so the walk terminates. */
const singleBatch = (docs: unknown[]) => {
    mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce(docs);
};

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.vehicle.findUnique.mockResolvedValue(vehicleRow());
    mockPrisma.vehicle.update.mockResolvedValue(vehicleRow());
    mockPrisma.vehicleDocument.update.mockResolvedValue(document());
});

describe('resolveDocumentKey', () => {
    it('prefers the stored key', () => {
        expect(resolveDocumentKey({ imageKey: 'uploads/a/b.jpg', image: null })).toBe('uploads/a/b.jpg');
    });

    it('recovers the key from a public URL when the row predates imageKey', () => {
        expect(
            resolveDocumentKey({ imageKey: null, image: 'https://cdn.test/uploads/vehicle/u/1.jpg' }),
        ).toBe('uploads/vehicle/u/1.jpg');
    });

    it('returns null when the row names nothing', () => {
        expect(resolveDocumentKey({ imageKey: null, image: null })).toBeNull();
    });
});

describe('auditVehicleDocuments', () => {
    it('flags a document whose object storage does not hold, and tells the owner once', async () => {
        singleBatch([document()]);
        mockHeadObject.mockResolvedValue({ exists: false });
        // After the pass, the vehicle still has the missing row.
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);

        const summary = await auditVehicleDocuments();

        expect(summary.missing).toBe(1);
        expect(summary.vehiclesNotified).toBe(1);
        expect(mockPrisma.vehicleDocument.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'doc-1' },
                data: expect.objectContaining({ storageMissingAt: expect.any(Date) }),
            }),
        );
        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: OWNER.id,
                type: 'vehicle.document.missing',
                data: expect.objectContaining({ vehicleId: 'vehicle-1', deepLink: 'app://vehicle/vehicle-1' }),
            }),
        );
        expect(mockSendMail).toHaveBeenCalledWith(
            expect.objectContaining({ to: OWNER.email }),
        );
    });

    it('leaves the row alone when storage cannot be asked', async () => {
        singleBatch([document()]);
        // headObject throws on every non-404 error — a bucket blip must never be reported to a
        // driver as a lost document.
        mockHeadObject.mockRejectedValue(new Error('ECONNRESET'));

        const summary = await auditVehicleDocuments();

        expect(summary.inconclusive).toBe(1);
        expect(summary.missing).toBe(0);
        expect(mockPrisma.vehicleDocument.update).not.toHaveBeenCalled();
        expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it('treats a row that names no object as missing without calling storage', async () => {
        singleBatch([document({ imageKey: null, image: null })]);
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);

        const summary = await auditVehicleDocuments();

        expect(mockHeadObject).not.toHaveBeenCalled();
        expect(summary.missing).toBe(1);
    });

    it('does not notify a second time while the vehicle is still broken', async () => {
        singleBatch([document({ storageMissingAt: new Date('2026-09-01T00:00:00Z') })]);
        mockHeadObject.mockResolvedValue({ exists: false });
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);
        mockPrisma.vehicle.findUnique.mockResolvedValue(
            vehicleRow({ documentIssueNotifiedAt: new Date('2026-09-01T01:00:00Z') }),
        );

        const summary = await auditVehicleDocuments();

        expect(summary.missing).toBe(1);
        expect(summary.vehiclesNotified).toBe(0);
        expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it('keeps the original discovery time rather than restamping it each pass', async () => {
        const discoveredAt = new Date('2026-09-01T00:00:00Z');
        singleBatch([document({ storageMissingAt: discoveredAt })]);
        mockHeadObject.mockResolvedValue({ exists: false });
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);

        await auditVehicleDocuments();

        expect(mockPrisma.vehicleDocument.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ storageMissingAt: discoveredAt }) }),
        );
    });

    it('clears the flag and the notify guard when the object comes back', async () => {
        singleBatch([document({ storageMissingAt: new Date('2026-09-01T00:00:00Z') })]);
        mockHeadObject.mockResolvedValue({ exists: true });
        // Nothing missing left on the vehicle.
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([]);
        mockPrisma.vehicle.findUnique.mockResolvedValue(
            vehicleRow({ documentIssueNotifiedAt: new Date('2026-09-01T01:00:00Z') }),
        );

        const summary = await auditVehicleDocuments();

        expect(summary.recovered).toBe(1);
        expect(mockPrisma.vehicleDocument.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ storageMissingAt: null }) }),
        );
        expect(mockPrisma.vehicle.update).toHaveBeenCalledWith({
            where: { id: 'vehicle-1' },
            data: { documentIssueNotifiedAt: null },
        });
        expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it('busts the vehicle and owner caches so the flag is visible on the next read', async () => {
        singleBatch([document()]);
        mockHeadObject.mockResolvedValue({ exists: false });
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);

        await auditVehicleDocuments();

        expect(mockDeleteCache).toHaveBeenCalledWith('vehicle:vehicle-1');
        expect(mockDeleteCache).toHaveBeenCalledWith(`user:${OWNER.id}:vehicles`);
    });

    it('writes nothing and notifies nobody on a dry run', async () => {
        singleBatch([document()]);
        mockHeadObject.mockResolvedValue({ exists: false });

        const summary = await auditVehicleDocuments({ dryRun: true });

        expect(summary.missing).toBe(1);
        expect(mockPrisma.vehicleDocument.update).not.toHaveBeenCalled();
        expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
        expect(mockDeleteCache).not.toHaveBeenCalled();
        expect(mockCreateNotification).not.toHaveBeenCalled();
    });

    it('flags without messaging when notifications are suppressed', async () => {
        singleBatch([document()]);
        mockHeadObject.mockResolvedValue({ exists: false });
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);

        const summary = await auditVehicleDocuments({ notify: false });

        expect(summary.missing).toBe(1);
        expect(mockPrisma.vehicleDocument.update).toHaveBeenCalled();
        expect(mockCreateNotification).not.toHaveBeenCalled();
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('still notifies when the owner has no email on file', async () => {
        singleBatch([document()]);
        mockHeadObject.mockResolvedValue({ exists: false });
        mockPrisma.vehicleDocument.findMany.mockResolvedValueOnce([{ documentType: 'VEHICLE_DOCUMENT' }]);
        mockPrisma.vehicle.findUnique.mockResolvedValue(
            vehicleRow({ user: { ...OWNER, email: null } }),
        );

        const summary = await auditVehicleDocuments();

        expect(summary.vehiclesNotified).toBe(1);
        expect(mockCreateNotification).toHaveBeenCalled();
        expect(mockSendMail).not.toHaveBeenCalled();
    });
});
