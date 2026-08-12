const mockRedis = {
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
};

const mockPrisma = {
    user: { findUnique: jest.fn() },
    vehicle: { count: jest.fn(), create: jest.fn() },
    // The licence gate reads this: a driver must have a licence image on file (or
    // already be DL-verified) before a document-required country accepts a vehicle.
    dlVerification: { findFirst: jest.fn() },
};

jest.mock('../../cache/redis.js', () => ({
    __esModule: true,
    default: mockRedis,
}));

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import * as DraftVehicleService from './draft-vehicle.service.js';

const registryDocument = {
    documentType: 'VEHICLE_DOCUMENT',
    imageKey: 'uploads/vehicle-documents/user-1/registry.jpg',
};
const insuranceDocument = {
    documentType: 'INSURANCE_DOCUMENT',
    imageKey: 'uploads/vehicle-documents/user-1/insurance.jpg',
};
const frontPhoto = {
    documentType: 'VEHICLE_IMAGE_FRONT',
    imageUrl: 'https://cdn.example.com/front.jpg',
};
const backPhoto = {
    documentType: 'VEHICLE_IMAGE_BACK',
    imageUrl: 'https://cdn.example.com/back.jpg',
};

const draftWith = (licenseCountry: string, documents: unknown[]) =>
    JSON.stringify({
        userId: 'user-1',
        step: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        licenseCountry,
        licenseNumber: 'ABC 123',
        brand: 'Toyota',
        documents,
    });

describe('saveVehicle', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        delete process.env.SKIP_VEHICLE_VERIFICATION;
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', dlVerified: false });
        mockPrisma.vehicle.count.mockResolvedValue(0);
        mockPrisma.vehicle.create.mockResolvedValue({ id: 'vehicle-1', documents: [] });
        // Default: the driver has a licence on file, so the gate is out of the way of
        // the tests that are about something else.
        mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'dl-1' });
    });

    const createArgs = () => mockPrisma.vehicle.create.mock.calls[0][0];

    describe('document requirements by country', () => {
        it('requires the full document set in Estonia', async () => {
            mockRedis.get.mockResolvedValue(draftWith('EE', []));

            await expect(DraftVehicleService.saveVehicle('user-1')).rejects.toThrow(
                /^VEHICLE_DOCUMENTS_REQUIRED:/,
            );
            expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
        });

        it.each([
            ['front photo', [backPhoto, registryDocument, insuranceDocument], 'VEHICLE_IMAGE_FRONT'],
            ['rear photo', [frontPhoto, registryDocument, insuranceDocument], 'VEHICLE_IMAGE_BACK'],
            ['registry document', [frontPhoto, backPhoto, insuranceDocument], 'VEHICLE_DOCUMENT'],
            ['insurance document', [frontPhoto, backPhoto, registryDocument], 'INSURANCE_DOCUMENT'],
        ])('names the missing %s', async (_label, documents, expectedMissing) => {
            mockRedis.get.mockResolvedValue(draftWith('EE', documents));

            await expect(DraftVehicleService.saveVehicle('user-1')).rejects.toThrow(
                `VEHICLE_DOCUMENTS_REQUIRED:${expectedMissing}`,
            );
        });

        it('saves an Estonian vehicle once all required vehicle documents are supplied', async () => {
            mockRedis.get.mockResolvedValue(
                draftWith('EE', [frontPhoto, backPhoto, registryDocument, insuranceDocument]),
            );

            await DraftVehicleService.saveVehicle('user-1');

            expect(mockPrisma.vehicle.create).toHaveBeenCalledTimes(1);
        });

        it('matches the country case-insensitively', async () => {
            mockRedis.get.mockResolvedValue(draftWith('ee', []));

            await expect(DraftVehicleService.saveVehicle('user-1')).rejects.toThrow(
                /^VEHICLE_DOCUMENTS_REQUIRED:/,
            );
        });

        it('does not impose the requirement on other countries', async () => {
            mockRedis.get.mockResolvedValue(draftWith('GB', []));

            await DraftVehicleService.saveVehicle('user-1');

            expect(mockPrisma.vehicle.create).toHaveBeenCalledTimes(1);
        });
    });

    describe('document persistence', () => {
        beforeEach(() => {
            mockRedis.get.mockResolvedValue(
                draftWith('EE', [frontPhoto, backPhoto, registryDocument, insuranceDocument]),
            );
        });

        it('promotes the front photo to the rider-visible vehicle image', async () => {
            await DraftVehicleService.saveVehicle('user-1');

            expect(createArgs().data.imageUrl).toBe(frontPhoto.imageUrl);
        });

        it('persists the rear photo and registry document as document rows', async () => {
            await DraftVehicleService.saveVehicle('user-1');

            const created = createArgs().data.documents.create;
            expect(created).toHaveLength(3);
            expect(created).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        documentType: 'VEHICLE_IMAGE_BACK',
                        image: backPhoto.imageUrl,
                    }),
                    // Private type: the public URL is dropped, only the key survives.
                    expect.objectContaining({
                        documentType: 'VEHICLE_DOCUMENT',
                        image: null,
                        imageKey: registryDocument.imageKey,
                    }),
                    expect.objectContaining({
                        documentType: 'INSURANCE_DOCUMENT',
                        image: null,
                        imageKey: insuranceDocument.imageKey,
                    }),
                ]),
            );
        });

        it('still treats the legacy VEHICLE_IMAGE type as the primary photo', async () => {
            mockRedis.get.mockResolvedValue(
                draftWith('GB', [
                    { documentType: 'VEHICLE_IMAGE', imageUrl: 'https://cdn.example.com/legacy.jpg' },
                ]),
            );

            await DraftVehicleService.saveVehicle('user-1');

            expect(createArgs().data.imageUrl).toBe('https://cdn.example.com/legacy.jpg');
            expect(createArgs().data.documents.create).toHaveLength(0);
        });
    });

    describe('review state', () => {
        beforeEach(() => {
            mockRedis.get.mockResolvedValue(
                draftWith('EE', [frontPhoto, backPhoto, registryDocument, insuranceDocument]),
            );
        });

        it('lands in the admin queue as PENDING and unverified', async () => {
            await DraftVehicleService.saveVehicle('user-1');

            expect(createArgs().data).toMatchObject({
                verificationStatus: 'PENDING',
                isVerified: false,
                reviewedAt: null,
            });
        });

        it('auto-approves when SKIP_VEHICLE_VERIFICATION is set', async () => {
            process.env.SKIP_VEHICLE_VERIFICATION = 'true';

            await DraftVehicleService.saveVehicle('user-1');

            expect(createArgs().data).toMatchObject({
                verificationStatus: 'APPROVED',
                isVerified: true,
            });
            expect(createArgs().data.reviewedAt).toBeInstanceOf(Date);
        });
    });

    describe('driving licence gate', () => {
        const fullSet = [frontPhoto, backPhoto, registryDocument, insuranceDocument];

        it('rejects a document-required country when the driver has no licence on file', async () => {
            mockRedis.get.mockResolvedValue(draftWith('EE', fullSet));
            mockPrisma.dlVerification.findFirst.mockResolvedValue(null);

            await expect(DraftVehicleService.saveVehicle('user-1')).rejects.toThrow(
                'DL_DOCUMENT_REQUIRED',
            );
            expect(mockPrisma.vehicle.create).not.toHaveBeenCalled();
        });

        it('accepts a licence uploaded for an earlier vehicle — it is not asked for again', async () => {
            mockRedis.get.mockResolvedValue(draftWith('EE', fullSet));
            mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'dl-1' });

            await expect(DraftVehicleService.saveVehicle('user-1')).resolves.toBeDefined();
            expect(mockPrisma.vehicle.create).toHaveBeenCalled();
        });

        it('skips the gate for an already DL-verified driver, who has no uploaded image', async () => {
            mockRedis.get.mockResolvedValue(draftWith('EE', fullSet));
            mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', dlVerified: true });
            mockPrisma.dlVerification.findFirst.mockResolvedValue(null);

            await expect(DraftVehicleService.saveVehicle('user-1')).resolves.toBeDefined();
            expect(mockPrisma.dlVerification.findFirst).not.toHaveBeenCalled();
        });

        it('does not gate a country outside the document-required set', async () => {
            mockRedis.get.mockResolvedValue(draftWith('GB', []));
            mockPrisma.dlVerification.findFirst.mockResolvedValue(null);

            await expect(DraftVehicleService.saveVehicle('user-1')).resolves.toBeDefined();
        });
    });

    describe('pre-existing guards still apply', () => {
        it('rejects a draft without licence details', async () => {
            mockRedis.get.mockResolvedValue(
                JSON.stringify({ userId: 'user-1', step: 1, documents: [] }),
            );

            await expect(DraftVehicleService.saveVehicle('user-1')).rejects.toThrow(
                'LICENSE_REQUIRED',
            );
        });

        it('rejects once the vehicle limit is reached', async () => {
            mockRedis.get.mockResolvedValue(draftWith('GB', []));
            mockPrisma.vehicle.count.mockResolvedValue(1);

            await expect(DraftVehicleService.saveVehicle('user-1')).rejects.toThrow(
                'MAX_VEHICLE_LIMIT_REACHED',
            );
        });
    });
});
