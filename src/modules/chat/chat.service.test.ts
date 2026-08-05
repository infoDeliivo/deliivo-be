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
});
