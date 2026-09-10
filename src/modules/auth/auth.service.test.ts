const mockPrisma = {
  user: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
};

const mockGenerateTokens = jest.fn();

jest.mock('../../config/index.js', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

jest.mock('../token/tokens.service.js', () => ({
  __esModule: true,
  generateTokens: (...args: unknown[]) => mockGenerateTokens(...args),
  verifyRefreshToken: jest.fn(),
}));

jest.mock('../rewards/rewards.service.js', () => ({
  __esModule: true,
  attachReferralCodeToUser: jest.fn(),
  ensureUserReferralCode: jest.fn(),
}));

import { verifyOtpService } from './auth.service.js';

type UserRow = {
  id: string;
  email: string | null;
  phone: string | null;
  role: string;
  isVerified: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  isBanned: boolean;
  onboardingStatus: string;
};

const buildUser = (overrides: Partial<UserRow> = {}): UserRow => ({
  id: 'user-1',
  email: 'rider@example.com',
  phone: '+447700900000',
  role: 'USER',
  isVerified: false,
  emailVerified: false,
  phoneVerified: false,
  isBanned: false,
  onboardingStatus: 'PENDING',
  ...overrides,
});

describe('verifyOtpService channel verification flags', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGenerateTokens.mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
    mockPrisma.user.update.mockImplementation(async () => undefined);
  });

  it('marks emailVerified on signup verification via email', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser());

    const result = await verifyOtpService('Rider@Example.com', '123456', 'signup', 'email');

    expect(result.success).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isVerified: true, emailVerified: true },
    });
  });

  it('marks phoneVerified on signup verification via phone', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser());

    await verifyOtpService('+447700900000', '123456', 'signup', 'phone');

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { isVerified: true, phoneVerified: true },
    });
  });

  it('does not set the other channel flag', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser());

    await verifyOtpService('rider@example.com', '123456', 'signup', 'email');

    const data = mockPrisma.user.update.mock.calls[0][0].data;
    expect(data.phoneVerified).toBeUndefined();
  });

  it('backfills the channel flag on login for an already verified account', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser({ isVerified: true }));

    await verifyOtpService('rider@example.com', '123456', 'login', 'email');

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { emailVerified: true },
    });
  });

  it('backfills the channel flag on reset_password', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser({ isVerified: true }));

    await verifyOtpService('+447700900000', '123456', 'reset_password', 'phone');

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { phoneVerified: true },
    });
  });

  it('writes nothing when the channel is already verified', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(
      buildUser({ isVerified: true, emailVerified: true }),
    );

    await verifyOtpService('rider@example.com', '123456', 'login', 'email');

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('does not flag the channel when an unverified account attempts login', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser({ isVerified: false }));

    const result = await verifyOtpService('rider@example.com', '123456', 'login', 'email');

    expect(result).toEqual({ success: false, reason: 'USER_NOT_VERIFIED' });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('returns the updated flags on the returned user', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(buildUser());

    const result = await verifyOtpService('rider@example.com', '123456', 'signup', 'email');

    expect(result.user).toMatchObject({ isVerified: true, emailVerified: true });
  });

  it('fails when no user matches the identifier', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const result = await verifyOtpService('nobody@example.com', '123456', 'login', 'email');

    expect(result).toEqual({ success: false, reason: 'USER_NOT_FOUND' });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
