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
        const result = await getDriverPublishEligibility('driver-1');

        expect(result.eligible).toBe(true);
        expect(result.requirements.every((item) => item.satisfied)).toBe(true);
        await expect(assertDriverCanPublish('driver-1')).resolves.toBeUndefined();
    });

    describe('individual gates', () => {
        it('blocks when the driving licence is not verified', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, dlVerified: false });

            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'DRIVER_NOT_VERIFIED',
            );
        });

        it('blocks when no bank account is connected', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                stripeOnboardingComplete: false,
            });

            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'BANK_ACCOUNT_REQUIRED',
            );
        });

        it('blocks when the driver has no vehicle', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue(null);

            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'VEHICLE_REQUIRED',
            );
        });

        it('blocks when the vehicle is still awaiting admin approval', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
            });

            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
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

            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'VEHICLE_REJECTED',
            );
        });

        it('carries the admin rejection note back to the driver', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'REJECTED',
                rejectionReason: 'Registry document is unreadable',
            });

            const result = await getDriverPublishEligibility('driver-1');
            const check = result.requirements.find((item) => item.key === 'VEHICLE');

            expect(check?.reason).toBe('VEHICLE_REJECTED');
            expect(check?.vehicle).toEqual({
                verificationStatus: 'REJECTED',
                rejectionReason: 'Registry document is unreadable',
            });
        });

        it('reports an added-but-unreviewed vehicle once, not as missing as well', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
                rejectionReason: null,
            });

            const result = await getDriverPublishEligibility('driver-1');
            const vehicleChecks = result.requirements.filter((item) => item.key === 'VEHICLE');

            expect(vehicleChecks).toHaveLength(1);
            expect(vehicleChecks[0]).toMatchObject({
                satisfied: false,
                reason: 'VEHICLE_NOT_VERIFIED',
                actionUrl: '/api/v1/vehicles',
            });
        });

        it('reports a pending vehicle with context but no rejection note', async () => {
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
                rejectionReason: null,
            });

            const result = await getDriverPublishEligibility('driver-1');
            const check = result.requirements.find((item) => item.key === 'VEHICLE');

            expect(check?.reason).toBe('VEHICLE_NOT_VERIFIED');
            expect(check?.vehicle).toEqual({ verificationStatus: 'PENDING', rejectionReason: null });
        });

        it('attaches no review context once the vehicle is approved', async () => {
            const result = await getDriverPublishEligibility('driver-1');
            const check = result.requirements.find((item) => item.key === 'VEHICLE');

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

            const result = await getDriverPublishEligibility('driver-1');
            const check = result.requirements.find((item) => item.key === 'VEHICLE');

            expect(check?.skipped).toBe(true);
            expect(check?.satisfied).toBe(true);
            expect(check?.vehicle).toBeUndefined();
        });
    });

    describe('identity mismatch', () => {
        // The mismatch is why the licence gate failed, not a gate of its own: the driver
        // fixes it in the same place, so it rides on DL_VERIFICATION as its reason.
        it('reports DL_IDENTITY_MISMATCH as the licence gate reason', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, dlVerified: false });
            mockPrisma.dlVerification.findFirst.mockResolvedValue({ id: 'dlv-1' });

            const result = await getDriverPublishEligibility('driver-1');

            expect(reasonFor(result.requirements, 'DL_VERIFICATION')).toBe('DL_IDENTITY_MISMATCH');
            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow('DL_IDENTITY_MISMATCH');
        });

        it('falls back to DRIVER_NOT_VERIFIED when nothing mismatched', async () => {
            mockPrisma.user.findUnique.mockResolvedValue({ ...eligibleDriver, dlVerified: false });
            mockPrisma.dlVerification.findFirst.mockResolvedValue(null);

            const result = await getDriverPublishEligibility('driver-1');

            expect(reasonFor(result.requirements, 'DL_VERIFICATION')).toBe('DRIVER_NOT_VERIFIED');
        });

        it('does not query for a mismatch once the licence is verified', async () => {
            await getDriverPublishEligibility('driver-1');

            expect(mockPrisma.dlVerification.findFirst).not.toHaveBeenCalled();
        });
    });

    describe('bypass flags', () => {
        // DL verification is the platform's KYC: no environment flag may skip it.
        it('never skips the licence gates, whatever the environment says', async () => {
            setEnv('SKIP_DL_VERIFICATION', 'true');
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                dlVerified: false,
                stripeOnboardingComplete: false,
            });

            const result = await getDriverPublishEligibility('driver-1');

            expect(result.requirements.find((item) => item.key === 'DL_VERIFICATION')).toMatchObject(
                { satisfied: false, skipped: false, reason: 'DRIVER_NOT_VERIFIED' },
            );
            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'DRIVER_NOT_VERIFIED',
            );
        });

        it('BOOKING_PAYMENT_MODE=bypass skips the bank gate but not the licence gate', async () => {
            setEnv('BOOKING_PAYMENT_MODE', 'bypass');
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                dlVerified: false,
                stripeOnboardingComplete: false,
            });

            const result = await getDriverPublishEligibility('driver-1');

            expect(result.requirements.find((item) => item.key === 'BANK_ACCOUNT')).toMatchObject({
                satisfied: true,
                skipped: true,
            });
            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'DRIVER_NOT_VERIFIED',
            );
        });

        it('STRIPE_CONNECT_MOCK_MODE also skips the bank gate', async () => {
            setEnv('STRIPE_CONNECT_MOCK_MODE', 'true');
            mockPrisma.user.findUnique.mockResolvedValue({
                ...eligibleDriver,
                stripeOnboardingComplete: false,
            });

            const result = await getDriverPublishEligibility('driver-1');

            expect(result.eligible).toBe(true);
        });

        it('SKIP_VEHICLE_VERIFICATION skips approval but still requires a vehicle to exist', async () => {
            setEnv('SKIP_VEHICLE_VERIFICATION', 'true');
            mockPrisma.vehicle.findFirst.mockResolvedValue({
                id: 'vehicle-1',
                verificationStatus: 'PENDING',
            });

            await expect(assertDriverCanPublish('driver-1')).resolves.toBeUndefined();

            mockPrisma.vehicle.findFirst.mockResolvedValue(null);
            await expect(assertDriverCanPublish('driver-1')).rejects.toThrow(
                'VEHICLE_REQUIRED',
            );
        });
    });

    // Three gates, one per task the driver has left. Anything finer is a reason code.
    it('reports exactly the licence, payout and vehicle gates', async () => {
        const result = await getDriverPublishEligibility('driver-1');

        expect(result.requirements.map((item) => item.key)).toEqual([
            'DL_VERIFICATION',
            'BANK_ACCOUNT',
            'VEHICLE',
        ]);
    });

    it('reports the first unmet requirement when several fail at once', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            dlVerified: false,
            stripeOnboardingComplete: false,
        });
        mockPrisma.vehicle.findFirst.mockResolvedValue(null);

        await expect(assertDriverCanPublish('driver-1')).rejects.toThrow('DRIVER_NOT_VERIFIED');
    });

    it('treats a missing user as failing every gate rather than throwing', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.vehicle.findFirst.mockResolvedValue(null);

        const result = await getDriverPublishEligibility('driver-1');

        expect(result.eligible).toBe(false);
        expect(reasonFor(result.requirements, 'DL_VERIFICATION')).toBe('DRIVER_NOT_VERIFIED');
        expect(reasonFor(result.requirements, 'BANK_ACCOUNT')).toBe('BANK_ACCOUNT_REQUIRED');
        expect(reasonFor(result.requirements, 'VEHICLE')).toBe('VEHICLE_REQUIRED');
    });
});
