const mockPrisma = {
    user: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
    },
    vehicle: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
    },
    reconciliationIssue: { count: jest.fn() },
    ride: { findMany: jest.fn(), count: jest.fn() },
    rideBooking: { findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() },
    payoutBatch: { aggregate: jest.fn() },
    dlVerification: { count: jest.fn() },
    dispute: { count: jest.fn() },
    userReport: { count: jest.fn() },
    userBlock: { count: jest.fn() },
    payment: { count: jest.fn(), aggregate: jest.fn() },
    stripeWebhookEvent: { count: jest.fn() },
    $queryRaw: jest.fn(),
};

const mockCreateNotification = jest.fn().mockResolvedValue(undefined);

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

jest.mock('../payments/stripe.service.js', () => ({
    __esModule: true,
    refundPaymentIntent: jest.fn(),
}));

jest.mock('../payments/payment.service.js', () => ({
    __esModule: true,
    PAYMENT_STATUSES: {
        CREATED: 'CREATED',
        PAYMENT_PENDING: 'PAYMENT_PENDING',
        PAID: 'PAID',
        HELD_IN_ESCROW: 'HELD_IN_ESCROW',
        PAYOUT_ELIGIBLE: 'PAYOUT_ELIGIBLE',
        TRANSFER_CREATED: 'TRANSFER_CREATED',
        PAYOUT_COMPLETED: 'PAYOUT_COMPLETED',
        REFUND_PENDING: 'REFUND_PENDING',
        REFUNDED: 'REFUNDED',
        PAYMENT_FAILED: 'PAYMENT_FAILED',
    },
    markBookingPaymentRefunded: jest.fn(),
}));

jest.mock('../../cache/redis.js', () => ({
    __esModule: true,
    default: { get: jest.fn(), setex: jest.fn(), del: jest.fn() },
}));

jest.mock('../content/content.service.js', () => ({
    __esModule: true,
    getContentSummary: jest.fn(),
}));

import { getContentSummary } from '../content/content.service.js';
import {
    getOperationsSummary,
    getUserDetails,
    listUsers,
    listVehicles,
    rejectVehicle,
    verifyVehicle,
} from './admin.service.js';

describe('admin vehicle review', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // verifyVehicle/rejectVehicle notify vehicle.user, so the driver has to come back with it.
        mockPrisma.vehicle.findUnique.mockResolvedValue({
            id: 'vehicle-1',
            userId: 'driver-1',
            user: { id: 'driver-1', firstName: 'Driver', lastName: 'One', email: 'driver@test.local' },
        });
        mockPrisma.vehicle.update.mockImplementation(({ data }: { data: unknown }) => ({
            id: 'vehicle-1',
            ...(data as Record<string, unknown>),
        }));
    });

    describe('listVehicles', () => {
        beforeEach(() => {
            mockPrisma.vehicle.findMany.mockResolvedValue([]);
            mockPrisma.vehicle.count.mockResolvedValue(0);
        });

        it('filters by verification status and excludes deleted vehicles', async () => {
            await listVehicles({ status: 'PENDING' as never });

            expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { deletedAt: null, verificationStatus: 'PENDING' },
                    // A review queue is worked front to back.
                    orderBy: { createdAt: 'asc' },
                }),
            );
        });

        it('returns every status when none is requested', async () => {
            await listVehicles({});

            expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { deletedAt: null } }),
            );
        });

        it('exposes private documents as previewKey and never as a URL', async () => {
            mockPrisma.vehicle.findMany.mockResolvedValue([
                {
                    id: 'vehicle-1',
                    documents: [
                        {
                            id: 'doc-1',
                            documentType: 'VEHICLE_DOCUMENT',
                            image: null,
                            imageKey: 'uploads/vehicle-documents/driver-1/registry.jpg',
                            createdAt: new Date(),
                        },
                    ],
                },
            ]);
            mockPrisma.vehicle.count.mockResolvedValue(1);

            const result = await listVehicles({ status: 'PENDING' as never });

            expect(result.vehicles[0].documents[0]).toMatchObject({
                documentType: 'VEHICLE_DOCUMENT',
                previewKey: 'uploads/vehicle-documents/driver-1/registry.jpg',
                image: null,
            });
            expect(result.vehicles[0].documents[0]).not.toHaveProperty('imageKey');
        });

        it('caps the page size', async () => {
            await listVehicles({ limit: 5000 });

            expect(mockPrisma.vehicle.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ take: 100 }),
            );
        });
    });

    describe('verifyVehicle', () => {
        it('approves the vehicle and keeps isVerified in sync', async () => {
            const result = await verifyVehicle('vehicle-1', 'admin-1');

            const { data } = mockPrisma.vehicle.update.mock.calls[0][0];
            expect(data).toMatchObject({
                verificationStatus: 'APPROVED',
                isVerified: true,
                rejectionReason: null,
                reviewedById: 'admin-1',
            });
            expect(data.reviewedAt).toBeInstanceOf(Date);
            expect(result.verificationStatus).toBe('APPROVED');
        });

        it('notifies the driver', async () => {
            await verifyVehicle('vehicle-1', 'admin-1');

            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'driver-1',
                    type: 'vehicle.approved',
                    data: { vehicleId: 'vehicle-1' },
                }),
            );
        });

        it('throws for an unknown vehicle without writing', async () => {
            mockPrisma.vehicle.findUnique.mockResolvedValue(null);

            await expect(verifyVehicle('missing', 'admin-1')).rejects.toThrow('VEHICLE_NOT_FOUND');
            expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
            expect(mockCreateNotification).not.toHaveBeenCalled();
        });
    });

    describe('rejectVehicle', () => {
        it('records the reason and clears verification', async () => {
            await rejectVehicle('vehicle-1', 'Registry document is unreadable', 'admin-1');

            const { data } = mockPrisma.vehicle.update.mock.calls[0][0];
            expect(data).toMatchObject({
                verificationStatus: 'REJECTED',
                isVerified: false,
                rejectionReason: 'Registry document is unreadable',
                reviewedById: 'admin-1',
            });
        });

        it('sends the reason to the driver so they know what to re-upload', async () => {
            await rejectVehicle('vehicle-1', 'Rear photo is blurry', 'admin-1');

            // The reason must reach the driver; the sentence wrapping it is copy, not contract.
            expect(mockCreateNotification).toHaveBeenCalledWith(
                expect.objectContaining({
                    userId: 'driver-1',
                    type: 'vehicle.rejected',
                    body: expect.stringContaining('Rear photo is blurry'),
                    data: { vehicleId: 'vehicle-1', reason: 'Rear photo is blurry' },
                }),
            );
        });

        it('throws for an unknown vehicle without writing', async () => {
            mockPrisma.vehicle.findUnique.mockResolvedValue(null);

            await expect(rejectVehicle('missing', 'reason', 'admin-1')).rejects.toThrow(
                'VEHICLE_NOT_FOUND',
            );
            expect(mockPrisma.vehicle.update).not.toHaveBeenCalled();
        });
    });
});

describe('getOperationsSummary — vehicle review queue depth', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
        mockPrisma.reconciliationIssue.count.mockResolvedValue(0);
        mockPrisma.payment.count.mockResolvedValue(0);
        mockPrisma.stripeWebhookEvent.count.mockResolvedValue(0);
        mockPrisma.vehicle.count.mockResolvedValue(7);
        (getContentSummary as jest.Mock).mockResolvedValue({ total: 0, published: 0, drafts: 0 });
    });

    it('reports how many vehicles are waiting for review', async () => {
        const summary = await getOperationsSummary();

        expect(summary.operations.pendingVehicles).toBe(7);
    });

    it('counts only live pending vehicles, not deleted or already-decided ones', async () => {
        await getOperationsSummary();

        expect(mockPrisma.vehicle.count).toHaveBeenCalledWith({
            where: { deletedAt: null, verificationStatus: 'PENDING' },
        });
    });
});

describe('admin user language visibility', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('selects preferredLocale in the user list', async () => {
        mockPrisma.user.findMany.mockResolvedValue([
            { id: 'u1', email: 'a@test.local', preferredLocale: 'et' },
        ]);
        mockPrisma.user.count.mockResolvedValue(1);

        const result = await listUsers({});

        const select = mockPrisma.user.findMany.mock.calls[0][0].select;
        expect(select.preferredLocale).toBe(true);
        expect(result.users[0]).toMatchObject({ preferredLocale: 'et' });
    });

    it('selects preferredLocale on the user detail', async () => {
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'u1',
            preferredLocale: 'ru',
            vehicles: [],
            dlVerifications: [],
        });
        // getUserDetails fans out to ride/booking/payment stats; empty results are enough to
        // let it reach the end so the select can be inspected.
        mockPrisma.ride.findMany.mockResolvedValue([]);
        mockPrisma.ride.count.mockResolvedValue(0);
        mockPrisma.rideBooking.findMany.mockResolvedValue([]);
        mockPrisma.rideBooking.count.mockResolvedValue(0);
        const emptyAggregate = { _sum: {}, _count: { _all: 0 } };
        mockPrisma.rideBooking.aggregate.mockResolvedValue(emptyAggregate);
        mockPrisma.payment.aggregate.mockResolvedValue(emptyAggregate);
        mockPrisma.payoutBatch.aggregate.mockResolvedValue(emptyAggregate);
        mockPrisma.dlVerification.count.mockResolvedValue(0);
        mockPrisma.dispute.count.mockResolvedValue(0);
        mockPrisma.userReport.count.mockResolvedValue(0);
        mockPrisma.userBlock.count.mockResolvedValue(0);

        const result = await getUserDetails('u1');

        expect(result.user).toMatchObject({ preferredLocale: 'ru' });

        const select = mockPrisma.user.findUnique.mock.calls[0][0].select;
        expect(select.preferredLocale).toBe(true);
    });

    it('passes a null locale through untouched for a user who never chose one', async () => {
        mockPrisma.user.findMany.mockResolvedValue([
            { id: 'u2', email: 'b@test.local', preferredLocale: null },
        ]);
        mockPrisma.user.count.mockResolvedValue(1);

        const result = await listUsers({});

        expect(result.users[0]).toMatchObject({ preferredLocale: null });
    });
});
