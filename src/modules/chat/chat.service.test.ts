const mockPrisma = {
    $queryRaw: jest.fn(),
    rideBooking: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { BookingStatus, RideStatus } from '@prisma/client';
import { hasActiveRideChat, hasActiveRideChatForBooking } from './chat.service.js';

describe('hasActiveRideChat', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('allows chat for active ride participants', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({ id: 'booking-1' });

        await expect(hasActiveRideChat('rider-1', 'driver-1')).resolves.toBe(true);

        expect(mockPrisma.rideBooking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: expect.arrayContaining([
                    expect.objectContaining({
                        status: { in: expect.arrayContaining([BookingStatus.CONFIRMED]) },
                    }),
                    expect.objectContaining({
                        status: {
                            in: expect.arrayContaining([
                                BookingStatus.WAITING_FOR_PICKUP,
                                BookingStatus.ONBOARD,
                                BookingStatus.COMPLETED,
                            ]),
                        },
                    }),
                ]),
            }),
            select: { id: true },
        }));
    });

    it('blocks sending after the active ride session is closed', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);

        await expect(hasActiveRideChat('rider-1', 'driver-1')).resolves.toBe(false);
    });

    it('allows chat for the exact active booking context', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{
            id: 'booking-1',
            passengerId: 'rider-1',
            status: BookingStatus.WAITING_FOR_PICKUP,
            driverId: 'driver-1',
            rideStatus: RideStatus.IN_PROGRESS,
            actualStartTime: new Date(),
            actualEndTime: null,
        }]);

        await expect(hasActiveRideChatForBooking('rider-1', 'driver-1', 'booking-1')).resolves.toBe(true);
        await expect(hasActiveRideChatForBooking('driver-1', 'rider-1', 'booking-1')).resolves.toBe(true);
    });

    it('allows pending booking chat only after the ride session has started', async () => {
        mockPrisma.$queryRaw.mockResolvedValue([{
            id: 'booking-1',
            passengerId: 'rider-1',
            status: BookingStatus.DRIVER_PENDING,
            driverId: 'driver-1',
            rideStatus: RideStatus.IN_PROGRESS,
            actualStartTime: new Date(),
            actualEndTime: null,
        }]);

        await expect(hasActiveRideChatForBooking('rider-1', 'driver-1', 'booking-1')).resolves.toBe(true);

        mockPrisma.$queryRaw.mockResolvedValue([{
            id: 'booking-1',
            passengerId: 'rider-1',
            status: BookingStatus.DRIVER_PENDING,
            driverId: 'driver-1',
            rideStatus: RideStatus.PUBLISHED,
            actualStartTime: null,
            actualEndTime: null,
        }]);

        await expect(hasActiveRideChatForBooking('rider-1', 'driver-1', 'booking-1')).resolves.toBe(false);
    });
});
