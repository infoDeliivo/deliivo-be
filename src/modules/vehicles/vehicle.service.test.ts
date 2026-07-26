const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();
const mockUpdate = jest.fn();
const mockDocCreate = jest.fn();
const mockDocDelete = jest.fn();
const mockDocFindFirst = jest.fn();
// The service passes an array of un-awaited Prisma promises; the mock resolves them in
// order so callers still destructure the created row out of index 0.
const mockTransaction = jest.fn((operations: unknown[]) => Promise.all(operations));

jest.mock('../../config/index.js', () => ({
    prisma: {
        vehicle: {
            findFirst: mockFindFirst,
            findMany: mockFindMany,
            count: mockCount,
            update: mockUpdate,
        },
        vehicleDocument: {
            create: mockDocCreate,
            delete: mockDocDelete,
            findFirst: mockDocFindFirst,
        },
        $transaction: mockTransaction,
    },
}));

import {
    addVehicleDocument,
    getVehicle,
    updateCreateVehicle,
    updateVehicle,
    updateVehicleDetailService,
} from './vehicle.service.js';

const docRow = {
    id: 'doc1',
    imageKey: 'uploads/vehicle-documents/u1/d.png',
    image: null,
    documentType: 'VEHICLE_DOCUMENT',
    createdAt: new Date('2026-07-11T10:00:00.000Z'),
};

beforeEach(() => jest.clearAllMocks());

describe('getVehicle — single vehicle exposes documents with previewKey', () => {
    it('maps a private document imageKey to previewKey', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', brand: 'Toyota', documents: [docRow] });
        const result = (await getVehicle('u1', 'v1')) as { documents: unknown[] };
        expect(result.documents).toEqual([
            {
                id: 'doc1',
                documentType: 'VEHICLE_DOCUMENT',
                previewKey: 'uploads/vehicle-documents/u1/d.png',
                image: null,
                createdAt: docRow.createdAt,
            },
        ]);
    });

    it('returns an empty documents array when there are none', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', brand: 'Toyota', documents: [] });
        const result = (await getVehicle('u1', 'v1')) as { documents: unknown[] };
        expect(result.documents).toEqual([]);
    });

    it('throws VEHICLE_NOT_FOUND when missing', async () => {
        mockFindFirst.mockResolvedValue(null);
        await expect(getVehicle('u1', 'v1')).rejects.toThrow('VEHICLE_NOT_FOUND');
    });
});

describe('getVehicle — list maps documents on every vehicle', () => {
    it('exposes previewKey in the paginated list', async () => {
        mockFindMany.mockResolvedValue([{ id: 'v1', brand: 'Toyota', documents: [docRow] }]);
        mockCount.mockResolvedValue(1);
        const result = (await getVehicle('u1')) as {
            vehicles: Array<{ documents: Array<{ previewKey: string | null }> }>;
        };
        expect(result.vehicles[0].documents[0].previewKey).toBe('uploads/vehicle-documents/u1/d.png');
    });
});

const REVIEW_RESET = {
    isVerified: false,
    verificationStatus: 'PENDING',
    rejectionReason: null,
    reviewedAt: null,
    reviewedById: null,
};

const detailsInput = {
    brand: 'Toyota',
    model_num: 'ZVW50',
    model_name: 'Prius',
    type: 'SEDAN' as never,
    color: 'Blue',
    year: 2019,
};

describe('driver edits return a vehicle to the admin review queue', () => {
    it('re-queues a REJECTED vehicle in the same update as the detail change', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', verificationStatus: 'REJECTED' });
        mockUpdate.mockResolvedValue({ id: 'v1' });

        await updateVehicleDetailService('u1', 'v1', detailsInput);

        // One write, not two — a separate status update could diverge from the edit.
        expect(mockUpdate).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'v1' },
            data: expect.objectContaining({ brand: 'Toyota', ...REVIEW_RESET }),
        });
    });

    it('re-queues an APPROVED vehicle when the plate changes', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', verificationStatus: 'APPROVED' });
        mockUpdate.mockResolvedValue({ id: 'v1' });

        await updateCreateVehicle('u1', 'v1', 'EE', '123ABC');

        expect(mockUpdate).toHaveBeenCalledWith({
            where: { id: 'v1' },
            data: expect.objectContaining({ licenseCountry: 'EE', licenseNumber: '123ABC', ...REVIEW_RESET }),
        });
    });

    it('does not touch review state on an already PENDING vehicle', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', verificationStatus: 'PENDING' });
        mockUpdate.mockResolvedValue({ id: 'v1' });

        await updateVehicleDetailService('u1', 'v1', detailsInput);

        const data = mockUpdate.mock.calls[0][0].data as Record<string, unknown>;
        expect(data).not.toHaveProperty('verificationStatus');
        expect(data).not.toHaveProperty('rejectionReason');
    });

    it('leaves an APPROVED vehicle approved when only the primary photo changes', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', verificationStatus: 'APPROVED', imageKey: 'old.png' });
        mockUpdate.mockResolvedValue({ id: 'v1' });

        await updateVehicle('u1', 'v1', { imageUrl: 'https://cdn/new.png', imageKey: 'new.png' });

        const data = mockUpdate.mock.calls[0][0].data as Record<string, unknown>;
        expect(data).not.toHaveProperty('verificationStatus');
        expect(data.imageKey).toBe('new.png');
    });

    it('re-queues an APPROVED vehicle when a KYC document is added, atomically', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', verificationStatus: 'APPROVED' });
        mockDocCreate.mockResolvedValue({ id: 'doc9', documentType: 'VEHICLE_DOCUMENT' });
        mockUpdate.mockResolvedValue({ id: 'v1' });

        const created = await addVehicleDocument('u1', 'v1', {
            imageKey: 'k.png',
            documentType: 'VEHICLE_DOCUMENT' as never,
        });

        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(mockUpdate).toHaveBeenCalledWith({ where: { id: 'v1' }, data: REVIEW_RESET });
        expect(created).toEqual({ id: 'doc9', documentType: 'VEHICLE_DOCUMENT' });
    });

    it('does not re-queue an APPROVED vehicle when a car photo is added', async () => {
        mockFindFirst.mockResolvedValue({ id: 'v1', verificationStatus: 'APPROVED' });
        mockDocCreate.mockResolvedValue({ id: 'doc10', documentType: 'VEHICLE_IMAGE_BACK' });

        await addVehicleDocument('u1', 'v1', {
            imageKey: 'k.png',
            documentType: 'VEHICLE_IMAGE_BACK' as never,
        });

        expect(mockUpdate).not.toHaveBeenCalled();
    });
});
