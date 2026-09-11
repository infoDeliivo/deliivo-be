const mockPrisma = {
    payment: {
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
    },
};

const mockRecordRefund = jest.fn().mockResolvedValue({ entryGroupId: 'grp-1' });

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: require('../../test-utils/prisma-mock.js').withPrismaFallback(mockPrisma),
}));

jest.mock('../ledger/ledger.service.js', () => ({
    __esModule: true,
    recordPaymentReceived: jest.fn(),
    recordRefund: (...args: unknown[]) => mockRecordRefund(...args),
}));

jest.mock('./payment-outbox.worker.js', () => ({
    __esModule: true,
    writeOutboxEvent: jest.fn(),
    processOutboxEvents: jest.fn(),
}));

import { markRefunded, PAYMENT_STATUSES } from './payment.service.js';

// A 10.20 charge: the driver set 10.00 and the rider paid a 0.20 service fee on top.
const paidPayment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    bookingId: 'booking-1',
    riderId: 'rider-1',
    status: PAYMENT_STATUSES.HELD_IN_ESCROW,
    amountTotal: 10.2,
    fareAmount: 10,
    platformFeeAmount: 0.2,
    refundedFareAmount: 0,
    refundedFeeAmount: 0,
    currency: 'EUR',
    ...overrides,
});

beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.payment.update.mockImplementation(async ({ data }: { data: unknown }) => data);
});

describe('markRefunded — refund attribution', () => {
    it('splits a partial refund so the driver does not fund the platform fee', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(paidPayment());

        await markRefunded('pay-1', 'driver-1', 5.1);

        expect(mockRecordRefund).toHaveBeenCalledWith(expect.objectContaining({
            refundAmount: 5.1,
            fareRefundAmount: 5,
            feeRefundAmount: 0.1,
        }));
    });

    it('records what was refunded and leaves the gross charge intact', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(paidPayment());

        await markRefunded('pay-1', 'driver-1', 5.1);

        const [{ data }] = mockPrisma.payment.update.mock.calls[
            mockPrisma.payment.update.mock.calls.length - 1
        ] as [{ data: Record<string, unknown> }];
        // Payout owes fareAmount - refundedFareAmount. Overwriting the gross instead would destroy
        // the only record of what the rider was charged.
        expect(data.refundedFareAmount).toBe(5);
        expect(data.refundedFeeAmount).toBe(0.1);
        expect(data.fareAmount).toBeUndefined();
        expect(data.platformFeeAmount).toBeUndefined();
    });

    it('apportions a second partial refund against the original charge', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(
            paidPayment({
                status: PAYMENT_STATUSES.PAYOUT_ELIGIBLE,
                refundedFareAmount: 5,
                refundedFeeAmount: 0.1,
            })
        );

        await markRefunded('pay-1', 'driver-1', 2.55);

        // 2.55 of a 10.20 gross is 2.50 fare + 0.05 fee — the same ratio as the first refund, which
        // is only true because the split still reads the untouched fareAmount.
        expect(mockRecordRefund).toHaveBeenCalledWith(expect.objectContaining({
            refundAmount: 2.55,
            fareRefundAmount: 2.5,
            feeRefundAmount: 0.05,
        }));

        const [{ data }] = mockPrisma.payment.update.mock.calls[
            mockPrisma.payment.update.mock.calls.length - 1
        ] as [{ data: { refundedFareAmount: number; refundedFeeAmount: number; status: string } }];
        expect(data.refundedFareAmount).toBe(7.5);
        expect(data.refundedFeeAmount).toBe(0.15);
        expect(data.status).toBe(PAYMENT_STATUSES.PAYOUT_ELIGIBLE);
    });

    it('keeps a partially refunded booking payable to the driver', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(paidPayment());

        await markRefunded('pay-1', 'driver-1', 5.1);

        const [{ data }] = mockPrisma.payment.update.mock.calls[
            mockPrisma.payment.update.mock.calls.length - 1
        ] as [{ data: { status: string; payoutEligibleAt?: Date } }];
        // Previously this terminated at REFUNDED, which payout selection ignores, so the driver
        // received nothing while the rider kept half the ride.
        expect(data.status).toBe(PAYMENT_STATUSES.PAYOUT_ELIGIBLE);
        expect(data.payoutEligibleAt).toBeInstanceOf(Date);
    });

    it('terminates at REFUNDED on a full refund', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(paidPayment());

        await markRefunded('pay-1', 'driver-1', 10.2);

        const [{ data }] = mockPrisma.payment.update.mock.calls[
            mockPrisma.payment.update.mock.calls.length - 1
        ] as [{ data: { status: string; refundedFareAmount: number; refundedFeeAmount: number } }];
        expect(data.status).toBe(PAYMENT_STATUSES.REFUNDED);
        expect(data.refundedFareAmount).toBe(10);
        expect(data.refundedFeeAmount).toBe(0.2);
    });

    it('defaults to refunding the whole charge when no amount is given', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(paidPayment());

        await markRefunded('pay-1', 'driver-1');

        expect(mockRecordRefund).toHaveBeenCalledWith(expect.objectContaining({
            refundAmount: 10.2,
            fareRefundAmount: 10,
            feeRefundAmount: 0.2,
        }));
    });

    it('keeps the refund components summing to the refund exactly', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(paidPayment());

        await markRefunded('pay-1', 'driver-1', 3.4);

        const [{ refundAmount, fareRefundAmount, feeRefundAmount }] = mockRecordRefund.mock.calls[0] as [
            { refundAmount: number; fareRefundAmount: number; feeRefundAmount: number }
        ];
        expect(Math.round(fareRefundAmount * 100) + Math.round(feeRefundAmount * 100))
            .toBe(Math.round(refundAmount * 100));
    });

    it('attributes the whole refund to the driver when there was no fee', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(
            paidPayment({ amountTotal: 10, fareAmount: 10, platformFeeAmount: 0 })
        );

        await markRefunded('pay-1', 'driver-1', 5);

        expect(mockRecordRefund).toHaveBeenCalledWith(expect.objectContaining({
            fareRefundAmount: 5,
            feeRefundAmount: 0,
        }));
    });

    it('is idempotent once already refunded', async () => {
        mockPrisma.payment.findUniqueOrThrow.mockResolvedValue(
            paidPayment({ status: PAYMENT_STATUSES.REFUNDED })
        );

        await markRefunded('pay-1', 'driver-1', 5.1);

        expect(mockRecordRefund).not.toHaveBeenCalled();
        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
    });
});
