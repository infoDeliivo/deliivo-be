const mockFindFirst = jest.fn();
const mockFindMany = jest.fn();
const mockCount = jest.fn();

jest.mock('../../config/index.js', () => ({
    prisma: {
        vehicle: {
            findFirst: mockFindFirst,
            findMany: mockFindMany,
            count: mockCount,
        },
    },
}));

import { getVehicle } from './vehicle.service.js';

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
