const mockPrisma = {
    rideBooking: {
        findUnique: jest.fn(),
    },
    dispute: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
    },
    user: {
        findMany: jest.fn(),
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

import { createDispute, listDisputes } from './dispute.service.js';

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

describe('listDisputes (admin)', () => {
    const BOOKING_UUID = '3f2a9c1e-8b7d-4c6a-9e1f-2b3c4d5e6f70';

    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.dispute.findMany.mockResolvedValue([]);
        mockPrisma.dispute.count.mockResolvedValue(0);
        mockPrisma.user.findMany.mockResolvedValue([]);
    });

    const listArgs = () => mockPrisma.dispute.findMany.mock.calls[0][0];

    it('lists newest first with a stable tie-break', async () => {
        await listDisputes({});
        expect(listArgs().orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
        expect(listArgs().where).toEqual({});
    });

    it('searches text fields and the route, and leaves id equality out for a non-UUID term', async () => {
        await listDisputes({ search: ' tartu ' });
        const or = listArgs().where.AND[0].OR;
        expect(or).toEqual(expect.arrayContaining([
            { reason: { contains: 'tartu', mode: 'insensitive' } },
            { ride: { destinationAddress: { contains: 'tartu', mode: 'insensitive' } } },
        ]));
        expect(or).not.toContainEqual({ bookingId: 'tartu' });
    });

    it('matches a pasted UUID exactly against the dispute, booking and ride ids', async () => {
        await listDisputes({ search: BOOKING_UUID });
        expect(listArgs().where.AND[0].OR).toEqual(expect.arrayContaining([
            { id: BOOKING_UUID },
            { bookingId: BOOKING_UUID },
            { rideId: BOOKING_UUID },
        ]));
    });

    it('finds disputes by the name or email of whoever raised them', async () => {
        mockPrisma.user.findMany.mockResolvedValueOnce([{ id: 'rider-1' }]);
        await listDisputes({ search: 'anna' });
        expect(mockPrisma.user.findMany.mock.calls[0][0].where.OR).toContainEqual({ email: { contains: 'anna', mode: 'insensitive' } });
        expect(listArgs().where.AND[0].OR).toContainEqual({ raisedBy: { in: ['rider-1'] } });
    });

    it('combines the status filter with the search', async () => {
        await listDisputes({ status: 'OPEN', search: 'tartu' });
        expect(listArgs().where.AND).toHaveLength(2);
        expect(listArgs().where.AND[0]).toEqual({ status: 'OPEN' });
    });

    it('attaches who raised each dispute from one batched lookup', async () => {
        mockPrisma.dispute.findMany.mockResolvedValue([
            { id: 'd1', raisedBy: 'rider-1' },
            { id: 'd2', raisedBy: 'driver-1' },
            { id: 'd3', raisedBy: 'rider-1' },
        ]);
        mockPrisma.dispute.count.mockResolvedValue(3);
        mockPrisma.user.findMany.mockResolvedValue([
            { id: 'rider-1', firstName: 'Anna', lastName: null, email: 'anna@test.local', role: 'USER' },
            { id: 'driver-1', firstName: 'Dan', lastName: null, email: 'dan@test.local', role: 'USER' },
        ]);

        const result = await listDisputes({});

        expect(mockPrisma.user.findMany).toHaveBeenCalledTimes(1);
        expect(mockPrisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['rider-1', 'driver-1'] } });
        expect(result.disputes.map((d) => d.raisedByUser?.firstName)).toEqual(['Anna', 'Dan', 'Anna']);
    });
});
