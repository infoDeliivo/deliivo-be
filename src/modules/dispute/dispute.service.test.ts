const mockPrisma = {
    rideBooking: {
        findUnique: jest.fn(),
    },
    dispute: {
        findFirst: jest.fn(),
        create: jest.fn(),
    },
};

const mockCreateNotification = jest.fn().mockResolvedValue(undefined);
const mockEmitToUsers = jest.fn().mockResolvedValue(undefined);

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../notification/notification.service.js', () => ({
    __esModule: true,
    createNotification: mockCreateNotification,
}));

jest.mock('../../socket/index.js', () => ({
    __esModule: true,
    emitToUsers: mockEmitToUsers,
}));

import { createDispute } from './dispute.service.js';

const booking = {
    id: 'booking-1',
    rideId: 'ride-1',
    passengerId: 'rider-1',
    ride: {
        driverId: 'driver-1',
        originAddress: 'Tallinn, Estonia',
        destinationAddress: 'Tartu, Estonia',
    },
};

describe('createDispute', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.rideBooking.findUnique.mockResolvedValue(booking);
        mockPrisma.dispute.findFirst.mockResolvedValue(null);
        mockPrisma.dispute.create.mockResolvedValue({
            id: 'dispute-1',
            bookingId: 'booking-1',
            rideId: 'ride-1',
            raisedBy: 'driver-1',
            reason: 'NO_SHOW',
            status: 'OPEN',
            createdAt: new Date('2026-08-03T10:00:00.000Z'),
        });
    });

    it('checks duplicate disputes per reporter, not per booking globally', async () => {
        await createDispute({
            rideId: 'ride-1',
            bookingId: 'booking-1',
            raisedBy: 'driver-1',
            reason: 'NO_SHOW',
        });

        expect(mockPrisma.dispute.findFirst).toHaveBeenCalledWith({
            where: {
                bookingId: 'booking-1',
                raisedBy: 'driver-1',
                status: { in: expect.any(Array) },
            },
        });
        expect(mockPrisma.dispute.create).toHaveBeenCalled();
    });

    it('still rejects duplicate open disputes from the same reporter', async () => {
        mockPrisma.dispute.findFirst.mockResolvedValue({ id: 'existing-dispute' });

        await expect(createDispute({
            rideId: 'ride-1',
            bookingId: 'booking-1',
            raisedBy: 'driver-1',
            reason: 'NO_SHOW',
        })).rejects.toThrow('DISPUTE_ALREADY_EXISTS');

        expect(mockPrisma.dispute.create).not.toHaveBeenCalled();
    });
});
