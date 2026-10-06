const mockPrisma = {
    dispute: { findUnique: jest.fn(), update: jest.fn() },
    rideBooking: { update: jest.fn() },
    payment: { update: jest.fn() },
};

jest.mock('../../config/index.js', () => ({ __esModule: true, prisma: mockPrisma }));
jest.mock('../notification/notification.service.js', () => ({ __esModule: true, createNotification: jest.fn() }));
jest.mock('../ledger/ledger.service.js', () => ({ __esModule: true, recordRefund: jest.fn() }));
jest.mock('../payments/stripe.service.js', () => ({ __esModule: true, refundPaymentIntent: jest.fn() }));
jest.mock('../../socket/index.js', () => ({ __esModule: true, emitToUsers: jest.fn() }));

import { settleDispute } from './dispute-settlement.service.js';

/** A dispute on a booking whose other dispute was already settled with the given refund. */
const disputeOnBooking = (booking: { refundedAt: Date | null; refundAmount: number | null; refundPercent: number | null }) => ({
    id: 'dispute-2',
    status: 'OPEN',
    raisedBy: 'driver-1',
    booking: {
        id: 'booking-1',
        passengerId: 'rider-1',
        status: 'CANCELLED',
        totalPrice: 20,
        paymentAmount: 20,
        paymentCurrency: 'EUR',
        segmentFare: 18,
        stripePaymentIntentId: 'pi_1',
        paymentCapturedAt: new Date(),
        ...booking,
        payment: { id: 'payment-1', amountTotal: 20, fareAmount: 18, platformFeeAmount: 2, currency: 'EUR', refundedFareAmount: 0 },
        passenger: { id: 'rider-1', firstName: 'Rider' },
        ride: { id: 'ride-1', driverId: 'driver-1', originAddress: 'A', destinationAddress: 'B', currency: 'EUR' },
    },
    ride: { id: 'ride-1', driverId: 'driver-1', originAddress: 'A', destinationAddress: 'B' },
});

describe('settleDispute with two disputes on one booking', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('refuses to pay the driver out on a booking the other dispute fully refunded', async () => {
        mockPrisma.dispute.findUnique.mockResolvedValue(
            disputeOnBooking({ refundedAt: new Date(), refundAmount: 20, refundPercent: 100 }),
        );

        await expect(settleDispute({ disputeId: 'dispute-2', resolution: 'PAYOUT', resolvedBy: 'admin-1' }))
            .rejects.toThrow('BOOKING_ALREADY_REFUNDED');

        expect(mockPrisma.payment.update).not.toHaveBeenCalled();
        expect(mockPrisma.rideBooking.update).not.toHaveBeenCalled();
        expect(mockPrisma.dispute.update).not.toHaveBeenCalled();
    });

    it('still pays out what is left after a partial (split) refund', async () => {
        mockPrisma.dispute.findUnique.mockResolvedValue(
            disputeOnBooking({ refundedAt: new Date(), refundAmount: 10, refundPercent: 50 }),
        );
        mockPrisma.dispute.update.mockResolvedValue({
            id: 'dispute-2',
            status: 'RESOLVED_PAYOUT',
            raisedBy: 'driver-1',
            resolution: 'PAYOUT',
            booking: { id: 'booking-1', passengerId: 'rider-1', status: 'CANCELLED', totalPrice: 20 },
            ride: { id: 'ride-1', driverId: 'driver-1', originAddress: 'A', destinationAddress: 'B' },
        });

        await settleDispute({ disputeId: 'dispute-2', resolution: 'PAYOUT', resolvedBy: 'admin-1' });

        expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'PAYOUT_ELIGIBLE' }),
        }));
    });
});
