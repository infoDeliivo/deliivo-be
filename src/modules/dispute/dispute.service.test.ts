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

    it('lets the rider open a dispute after the driver has opened one on the same booking', async () => {
        // In-memory disputes table, filtered the way Postgres would, so the second party's
        // report is checked against the first one for real.
        const disputes: Array<{ id: string; bookingId: string; raisedBy: string; status: string }> = [];
        mockPrisma.dispute.findFirst.mockImplementation(async ({ where }: { where: { bookingId: string; raisedBy: string; status: { in: string[] } } }) =>
            disputes.find((d) => d.bookingId === where.bookingId && d.raisedBy === where.raisedBy && where.status.in.includes(d.status)) ?? null);
        mockPrisma.dispute.create.mockImplementation(async ({ data }: { data: { bookingId: string; raisedBy: string; status: string; reason: string; rideId: string } }) => {
            const row = { id: `dispute-${disputes.length + 1}`, ...data, createdAt: new Date() };
            disputes.push(row);
            return row;
        });

        const driverDispute = await createDispute({ rideId: 'ride-1', bookingId: 'booking-1', raisedBy: 'driver-1', reason: 'NO_SHOW' });
        const riderDispute = await createDispute({ rideId: 'ride-1', bookingId: 'booking-1', raisedBy: 'rider-1', reason: 'DRIVER_MISSED_PICKUP' });

        expect(driverDispute.raisedBy).toBe('driver-1');
        expect(riderDispute.raisedBy).toBe('rider-1');
        expect(disputes).toHaveLength(2);
        // Each side is notified of the other's report.
        expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'rider-1' }));
        expect(mockCreateNotification).toHaveBeenCalledWith(expect.objectContaining({ userId: 'driver-1' }));

        // A second open report from the rider is still refused.
        await expect(createDispute({ rideId: 'ride-1', bookingId: 'booking-1', raisedBy: 'rider-1', reason: 'OTHER' }))
            .rejects.toThrow('DISPUTE_ALREADY_EXISTS');
        expect(disputes).toHaveLength(2);
    });
});
