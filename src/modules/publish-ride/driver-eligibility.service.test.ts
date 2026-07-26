const mockPrisma = {
    user: { findUnique: jest.fn() },
    vehicle: { findFirst: jest.fn() },
    dlVerification: { findFirst: jest.fn() },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import {
    assertDriverCanPublish,
    getDriverPublishEligibility,
    PublishRequirementKey,
} from './driver-eligibility.service.js';

const eligibleDriver = {
    tosAcceptedAt: new Date(),
    dlVerified: true,
    stripeOnboardingComplete: true,
};

const approvedVehicle = { id: 'vehicle-1', verificationStatus: 'APPROVED' };

const reasonFor = (
    requirements: Array<{ key: PublishRequirementKey; reason: string | null }>,
    key: PublishRequirementKey,
) => requirements.find((item) => item.key === key)?.reason ?? null;

const setEnv = (key: string, value?: string) => {
    if (value === undefined) {
        delete process.env[key];
    } else {
        process.env[key] = value;
    }
};

describe('driver publish eligibility', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.clearAllMocks();
        setEnv('SKIP_DL_VERIFICATION', undefined);
        setEnv('SKIP_VEHICLE_VERIFICATION', undefined);
        setEnv('BOOKING_PAYMENT_MODE', 'stripe');
        setEnv('STRIPE_CONNECT_MOCK_MODE', undefined);

        mockPrisma.user.findUnique.mockResolvedValue(eligibleDriver);
        mockPrisma.vehicle.findFirst.mockResolvedValue(approvedVehicle);
        mockPrisma.dlVerification.findFirst.mockResolvedValue(null);
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it('reports a fully onboarded driver as eligible', async () => {
        const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');

        expect(result.eligible).toBe(true);
        expect(result.requirements.every((item) => item.satisfied)).toBe(true);
        await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).resolves.toBeUndefined();
    });

    describe('individual gates', () => {
        it('blocks when Terms of Service are not accepted', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, tosAcceptedAt: null });

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'TOS_NOT_ACCEPTED',
            );
        });

        it('blocks when the driving licence is not verified', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, dlVerified: false });

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'DRIVER_NOT_VERIFIED',
            );
        });

        it('blocks when no bank account is connected', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                stripeOnboardingComplete: false,
            });

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'BANK_ACCOUNT_REQUIRED',
            );
        });

        it('blocks when the driver has no vehicle', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue(null);

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'VEHICLE_REQUIRED',
            );
        });

        it('blocks when the vehicle is still awaiting admin approval', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
            });

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'VEHICLE_NOT_VERIFIED',
            );
        });

        // A rejected vehicle is a different situation from a pending one: waiting will
        // never clear it, so it gets its own code and the driver is told what to fix.
        it('blocks a rejected vehicle with its own reason code', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'REJECTED',
                rejectionReason: 'Registry document is unreadable',
            });

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'VEHICLE_REJECTED',
            );
        });

        it('carries the admin rejection note back to the driver', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'REJECTED',
                rejectionReason: 'Registry document is unreadable',
            });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');
            const check = result.requirements.find((item) => item.key === 'VEHICLE_VERIFICATION');

            expect(check?.reason).toBe('VEHICLE_REJECTED');
            expect(check?.vehicle).toEqual({
                verificationStatus: 'REJECTED',
                rejectionReason: 'Registry document is unreadable',
            });
        });

        it('reports a pending vehicle with context but no rejection note', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
                rejectionReason: null,
            });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');
            const check = result.requirements.find((item) => item.key === 'VEHICLE_VERIFICATION');

            expect(check?.reason).toBe('VEHICLE_NOT_VERIFIED');
            expect(check?.vehicle).toEqual({ verificationStatus: 'PENDING', rejectionReason: null });
        });

        it('attaches no review context once the vehicle is approved', async () => {
            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');
            const check = result.requirements.find((item) => item.key === 'VEHICLE_VERIFICATION');

            expect(check?.satisfied).toBe(true);
            expect(check?.vehicle).toBeUndefined();
        });

        it('leaks no review context when the gate is bypassed', async () => {
            setEnv('SKIP_VEHICLE_VERIFICATION', 'true');
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'REJECTED',
                rejectionReason: 'Registry document is unreadable',
            });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');
            const check = result.requirements.find((item) => item.key === 'VEHICLE_VERIFICATION');

            expect(check?.skipped).toBe(true);
            expect(check?.satisfied).toBe(true);
            expect(check?.vehicle).toBeUndefined();
        });
    });

    describe('identity mismatch', () => {
        it('reports DL_IDENTITY_MISMATCH rather than a plain unverified licence', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, dlVerified: false });
            mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'dlv-1' });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');

            expect(reasonFor(result.requirements, 'IDENTITY_MATCH')).toBe('DL_IDENTITY_MISMATCH');
            expect(reasonFor(result.requirements, 'DL_VERIFICATION')).toBe('DRIVER_NOT_VERIFIED');
        });

        it('does not query for a mismatch once the licence is verified', async () => {
            await getDriverPublishEligibility('driver-1', 'PUBLISH');

            expect(mockPrisma.dlVerification.findFirst).not.toHaveBeenCalled();
        });
    });

    describe('stages', () => {
        it('omits the ToS gate at the start of the flow but enforces it at publish', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, tosAcceptedAt: null });

            const start = await getDriverPublishEligibility('driver-1', 'START');
            expect(start.eligible).toBe(true);
            expect(start.requirements.some((item) => item.key === 'TOS')).toBe(false);
            await expect(assertDriverCanPublish('driver-1', 'START')).resolves.toBeUndefined();

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'TOS_NOT_ACCEPTED',
            );
        });

        it('evaluates every non-ToS gate identically in both stages', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue(null);

            await expect(assertDriverCanPublish('driver-1', 'START')).rejects.toThrow(
                'VEHICLE_REQUIRED',
            );
        });
    });

    describe('bypass flags', () => {
        it('SKIP_DL_VERIFICATION skips the licence gates but not the bank gate', async () => {
            setEnv('SKIP_DL_VERIFICATION', 'true');
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                dlVerified: false,
                stripeOnboardingComplete: false,
            });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');

            expect(result.requirements.find((item) => item.key === 'DL_VERIFICATION')).toMatchObject(
                { satisfied: true, skipped: true },
            );
            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'BANK_ACCOUNT_REQUIRED',
            );
        });

        it('BOOKING_PAYMENT_MODE=bypass skips the bank gate but not the licence gate', async () => {
            setEnv('BOOKING_PAYMENT_MODE', 'bypass');
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                dlVerified: false,
                stripeOnboardingComplete: false,
            });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');

            expect(result.requirements.find((item) => item.key === 'BANK_ACCOUNT')).toMatchObject({
                satisfied: true,
                skipped: true,
            });
            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'DRIVER_NOT_VERIFIED',
            );
        });

        it('STRIPE_CONNECT_MOCK_MODE also skips the bank gate', async () => {
            setEnv('STRIPE_CONNECT_MOCK_MODE', 'true');
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                stripeOnboardingComplete: false,
            });

            const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');

            expect(result.eligible).toBe(true);
        });

        it('SKIP_VEHICLE_VERIFICATION skips approval but still requires a vehicle to exist', async () => {
            setEnv('SKIP_VEHICLE_VERIFICATION', 'true');
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
            });

            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).resolves.toBeUndefined();

            mockPrisma.vehicle.findFirst.mockResolvedValue(null);
            await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
                'VEHICLE_REQUIRED',
            );
        });
    });

    it('reports the first unmet requirement when several fail at once', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            tosAcceptedAt: null,
            dlVerified: false,
            stripeOnboardingComplete: false,
        });
        mockPrisma.vehicle.findFirst.mockResolvedValue(null);

        await expect(assertDriverCanPublish('driver-1', 'PUBLISH')).rejects.toThrow(
            'TOS_NOT_ACCEPTED',
        );
    });

    it('treats a missing user as failing every gate rather than throwing', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.vehicle.findFirst.mockResolvedValue(null);

        const result = await getDriverPublishEligibility('driver-1', 'PUBLISH');

        expect(result.eligible).toBe(false);
        expect(reasonFor(result.requirements, 'TOS')).toBe('TOS_NOT_ACCEPTED');
    });
});
