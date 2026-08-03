const mockPrisma = {
    rideBooking: {
        findFirst: jest.fn(),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

import { BookingStatus, RideStatus } from '@prisma/client';
import { hasActiveRideChat } from './chat.service.js';

describe('hasActiveRideChat', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('allows chat only for participants on an in-progress ride', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue({ id: 'booking-1' });

        await expect(hasActiveRideChat('rider-1', 'driver-1')).resolves.toBe(true);

        expect(mockPrisma.rideBooking.findFirst).toHaveBeenCalledWith({
            where: {
                status: {
                    in: expect.arrayContaining([
                        BookingStatus.CONFIRMED,
                        BookingStatus.IN_PROGRESS,
                        BookingStatus.COMPLETED,
                    ]),
                },
                ride: { status: RideStatus.IN_PROGRESS },
                OR: [
                    { passengerId: 'rider-1', ride: { driverId: 'driver-1' } },
                    { passengerId: 'driver-1', ride: { driverId: 'rider-1' } },
                ],
            },
            select: { id: true },
        });
    });

    it('blocks sending after the active ride session is closed', async () => {
        mockPrisma.rideBooking.findFirst.mockResolvedValue(null);

        await expect(hasActiveRideChat('rider-1', 'driver-1')).resolves.toBe(false);
    });
});
