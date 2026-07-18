const mockPrisma = {
    user: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue(undefined),
    },
};

jest.mock('../../config/index.js', () => ({
    __esModule: true,
    prisma: mockPrisma,
}));

jest.mock('../token/tokens.service.js', () => ({
    __esModule: true,
    generateTokens: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
    verifyRefreshToken: jest.fn(),
}));

import { verifyOtpService } from './auth.service';

describe('verifyOtpService — channel verification flags', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockPrisma.user.update.mockResolvedValue(undefined);
    });

    it('sets phoneVerified on a successful phone login OTP', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({
            id: 'user-1',
            isVerified: true,
            onboardingStatus: 'COMPLETED',
        });

        const result = await verifyOtpService('+37251234567', '1234', 'login', 'phone');

        expect(result.success).toBe(true);
        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { phoneVerified: true } }),
        );
    });

    it('sets emailVerified on a successful email login OTP', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({
            id: 'user-2',
            isVerified: true,
            onboardingStatus: 'COMPLETED',
        });

        await verifyOtpService('user@test.local', '1234', 'login', 'email');

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { emailVerified: true } }),
        );
    });

    it('marks account verified and sets phoneVerified on phone signup', async () => {
        mockPrisma.user.findFirst.mockResolvedValue({
            id: 'user-3',
            isVerified: false,
            onboardingStatus: 'PENDING',
        });

        await verifyOtpService('+37251234567', '1234', 'signup', 'phone');

        expect(mockPrisma.user.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { isVerified: true, phoneVerified: true } }),
        );
    });
});
