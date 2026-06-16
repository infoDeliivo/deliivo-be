const mockPrisma = {
    stripeWebhookEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
    },
    rideBooking: {
        updateMany: jest.fn(),
        findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
};

const mockCreateNotification = jest.fn();
const mockConstructStripeEvent = jest.fn();

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('./stripe.service.js', () => ({
    __esModule: true,
    constructStripeEvent: (...args: unknown[]) => mockConstructStripeEvent(...args),
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: (...args: unknown[]) => mockCreateNotification(...args),
}));

import { handleStripeWebhook } from './stripe.webhook.controller.js';

const makeRes = () => {
    const res: any = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    res.send = jest.fn().mockReturnValue(res);
    return res;
};

describe('handleStripeWebhook', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('moves booking to DRIVER_PENDING on payment success and sends driver notification', async () => {
        mockConstructStripeEvent.mockReturnValue({
            id: 'evt_success_1',
            type: 'payment_intent.succeeded',
            data: {
                object: {
                    id: 'pi_1',
                    amount: 1200,
                    amount_received: 1200,
                    currency: 'inr',
                    latest_charge: 'ch_1',
                    metadata: {
                        bookingId: 'booking-1',
                    },
                },
            },
        });

        mockPrisma.stripeWebhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.stripeWebhookEvent.create.mockResolvedValue({});
        mockPrisma.rideBooking.updateMany.mockResolvedValue({ count: 1 });
        mockPrisma.rideBooking.findUnique.mockResolvedValue({
            id: 'booking-1',
            rideId: 'ride-1',
            passengerId: 'passenger-1',
            seatsBooked: 1,
            totalPrice: 12,
            paymentCurrency: 'INR',
            pickupWaypointId: null,
            dropoffWaypointId: null,
            driverDecisionDeadlineAt: new Date('2026-04-02T12:30:00.000Z'),
            passenger: { name: 'Rider', avatarUrl: null },
            ride: {
                id: 'ride-1',
                driverId: 'driver-1',
                originAddress: 'Mathura',
                destinationAddress: 'Delhi',
                departureDate: new Date('2026-04-02T00:00:00.000Z'),
                departureTime: '12:00',
                currency: 'INR',
                waypoints: [],
            },
        });

        const req: any = {
            headers: { 'stripe-signature': 'sig_test' },
            body: Buffer.from('{}'),
        };
        const res = makeRes();

        await handleStripeWebhook(req, res);

        expect(mockPrisma.rideBooking.updateMany).toHaveBeenCalled();
        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'driver-1',
                type: 'booking.request.driver_decision',
            })
        );
        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'passenger-1',
                type: 'booking.request.sent',
            })
        );
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('marks PAYMENT_FAILED and restores seats on payment failure', async () => {
        mockConstructStripeEvent.mockReturnValue({
            id: 'evt_failed_1',
            type: 'payment_intent.payment_failed',
            data: {
                object: {
                    id: 'pi_2',
                    metadata: {
                        bookingId: 'booking-2',
                    },
                },
            },
        });

        mockPrisma.stripeWebhookEvent.findUnique.mockResolvedValue(null);
        mockPrisma.stripeWebhookEvent.create.mockResolvedValue({});

        const tx = {
            rideBooking: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'booking-2',
                    rideId: 'ride-2',
                    passengerId: 'passenger-2',
                    seatsBooked: 2,
                    status: 'PAYMENT_PENDING',
                    ride: {
                        id: 'ride-2',
                        originAddress: 'Mathura',
                        destinationAddress: 'Delhi',
                        departureDate: new Date('2026-04-03T00:00:00.000Z'),
                        departureTime: '13:00',
                    },
                }),
                update: jest.fn().mockResolvedValue({}),
            },
            ride: {
                update: jest.fn().mockResolvedValue({}),
            },
        };

        mockPrisma.$transaction.mockImplementation(async (callback: any) => callback(tx));

        const req: any = {
            headers: { 'stripe-signature': 'sig_test' },
            body: Buffer.from('{}'),
        };
        const res = makeRes();

        await handleStripeWebhook(req, res);

        expect(tx.rideBooking.update).toHaveBeenCalled();
        expect(tx.ride.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: { availableSeats: { increment: 2 } },
            })
        );
        expect(mockCreateNotification).toHaveBeenCalledWith(
            expect.objectContaining({
                userId: 'passenger-2',
                type: 'booking.payment.failed',
            })
        );
        expect(res.status).toHaveBeenCalledWith(200);
    });

    it('ignores duplicate event ids', async () => {
        mockConstructStripeEvent.mockReturnValue({
            id: 'evt_duplicate_1',
            type: 'payment_intent.succeeded',
            data: { object: { id: 'pi_3', metadata: { bookingId: 'booking-3' } } },
        });

        mockPrisma.stripeWebhookEvent.findUnique.mockResolvedValue({ id: 'stored-event' });

        const req: any = {
            headers: { 'stripe-signature': 'sig_test' },
            body: Buffer.from('{}'),
        };
        const res = makeRes();

        await handleStripeWebhook(req, res);

        expect(mockPrisma.stripeWebhookEvent.create).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ received: true, duplicate: true });
    });
});
