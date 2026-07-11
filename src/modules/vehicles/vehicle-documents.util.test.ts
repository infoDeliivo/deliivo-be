const mockPromoteObject = jest.fn();

jest.mock('../../services/s3.service.js', () => ({
    promoteObject: mockPromoteObject,
    keyFromPublicUrl: (url: string): string | null => {
        const idx = url.indexOf('/uploads/');
        return idx === -1 ? null : url.slice(idx + 1).split('?')[0];
    },
    PERMANENT_PREFIX: 'uploads',
}));

import { normalizeDocumentSource, isPrivateDocumentType } from './vehicle-documents.util.js';

beforeEach(() => jest.clearAllMocks());

describe('isPrivateDocumentType', () => {
    it('flags KYC types as private, VEHICLE_IMAGE as public', () => {
        expect(isPrivateDocumentType('DRIVING_LICENSE' as never)).toBe(true);
        expect(isPrivateDocumentType('INSURANCE_DOCUMENT' as never)).toBe(true);
        expect(isPrivateDocumentType('VEHICLE_DOCUMENT' as never)).toBe(true);
        expect(isPrivateDocumentType('VEHICLE_IMAGE' as never)).toBe(false);
    });
});

describe('normalizeDocumentSource', () => {
    it('re-keys a private-type doc sent as a public URL into the private folder', async () => {
        mockPromoteObject.mockResolvedValue(undefined);
        const out = await normalizeDocumentSource('u1', 'INSURANCE_DOCUMENT' as never, {
            imageUrl: 'https://gcs/deliivo/uploads/vehicle/u1/abc.png',
        });
        expect(mockPromoteObject).toHaveBeenCalledWith(
            'uploads/vehicle/u1/abc.png',
            'uploads/vehicle-documents/u1/abc.png',
            false,
        );
        expect(out).toEqual({ imageKey: 'uploads/vehicle-documents/u1/abc.png' });
        expect(out.imageUrl).toBeUndefined();
    });

    it('handles the legacy uploads/public/vehicle layout, owner stays 3rd segment', async () => {
        mockPromoteObject.mockResolvedValue(undefined);
        const out = await normalizeDocumentSource('u1', 'DRIVING_LICENSE' as never, {
            imageUrl: 'https://gcs/deliivo/uploads/public/vehicle/u1/xy.png',
        });
        expect(out).toEqual({ imageKey: 'uploads/vehicle-documents/u1/xy.png' });
    });

    it('keeps an already-private imageKey without moving the object', async () => {
        const out = await normalizeDocumentSource('u1', 'DRIVING_LICENSE' as never, {
            imageKey: 'uploads/vehicle-documents/u1/keep.png',
        });
        expect(out).toEqual({ imageKey: 'uploads/vehicle-documents/u1/keep.png' });
        expect(mockPromoteObject).not.toHaveBeenCalled();
    });

    it('leaves a public VEHICLE_IMAGE untouched', async () => {
        const out = await normalizeDocumentSource('u1', 'VEHICLE_IMAGE' as never, {
            imageUrl: 'https://gcs/deliivo/uploads/vehicle/u1/car.png',
        });
        expect(out).toEqual({ imageUrl: 'https://gcs/deliivo/uploads/vehicle/u1/car.png' });
        expect(mockPromoteObject).not.toHaveBeenCalled();
    });

    it('throws when a private doc has no resolvable object', async () => {
        await expect(
            normalizeDocumentSource('u1', 'INSURANCE_DOCUMENT' as never, { imageUrl: 'https://x/no-uploads/y.png' }),
        ).rejects.toThrow('PRIVATE_DOCUMENT_KEY_UNRESOLVED');
    });
});
