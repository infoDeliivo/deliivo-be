const mockTx = {
  user: {
    findFirst: jest.fn(),
    updateMany: jest.fn(),
    update: jest.fn(),
  },
};

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
};

const mockRedis = {
  set: jest.fn(),
  get: jest.fn(),
  del: jest.fn(),
};

const mockCreateOtp = jest.fn();
const mockVerifyOtp = jest.fn();

jest.mock('../../config/index.js', () => ({ __esModule: true, prisma: mockPrisma }));
jest.mock('../../cache/redis.js', () => ({ __esModule: true, default: mockRedis }));
jest.mock('../otp/otp.service.js', () => ({
  __esModule: true,
  createOtp: (...args: unknown[]) => mockCreateOtp(...args),
  verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
}));

import { requestContactChangeService, verifyContactChangeService } from './user.contact.service';

type ContactRow = {
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
};

const buildUser = (overrides: Partial<ContactRow> = {}): ContactRow => ({
  email: 'rider@example.com',
  phone: null,
  emailVerified: true,
  phoneVerified: false,
  ...overrides,
});

describe('requestContactChangeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.findUnique.mockResolvedValue(buildUser());
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockCreateOtp.mockResolvedValue({ success: true, code: '1234', reason: null });
  });

  it('issues an OTP for a new phone and records the pending change for this user', async () => {
    const res = await requestContactChangeService('user-1', 'phone', ' +37255512345 ');

    expect(res).toEqual({ success: true, data: { identifier: '+37255512345', code: '1234' } });
    expect(mockCreateOtp).toHaveBeenCalledWith('+37255512345', 'contact_change', 'phone');
    expect(mockRedis.set).toHaveBeenCalledWith('contact_change:pending:user-1:phone', '+37255512345', 'EX', 300);
  });

  it('normalises email to lowercase before checking and issuing', async () => {
    await requestContactChangeService('user-1', 'email', ' New@Example.COM ');

    expect(mockPrisma.user.findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'new@example.com', mode: 'insensitive' }, id: { not: 'user-1' }, isVerified: true },
      select: { id: true },
    });
    expect(mockCreateOtp).toHaveBeenCalledWith('new@example.com', 'contact_change', 'email');
  });

  it('rejects the value the user already has verified', async () => {
    const res = await requestContactChangeService('user-1', 'email', 'RIDER@example.com');

    expect(res).toEqual({ success: false, error: 'CONTACT_UNCHANGED' });
    expect(mockCreateOtp).not.toHaveBeenCalled();
  });

  it('allows re-verifying the current value when it is not verified yet', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(buildUser({ phone: '+37255512345', phoneVerified: false }));

    const res = await requestContactChangeService('user-1', 'phone', '+37255512345');

    expect(res.success).toBe(true);
  });

  it('rejects a value owned by another verified account', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-2' });

    const res = await requestContactChangeService('user-1', 'phone', '+37255512345');

    expect(res).toEqual({ success: false, error: 'CONTACT_IN_USE' });
    expect(mockCreateOtp).not.toHaveBeenCalled();
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('maps OTP cooldown and does not store a pending change', async () => {
    mockCreateOtp.mockResolvedValue({ success: false, code: null, reason: 'cooldown' });

    const res = await requestContactChangeService('user-1', 'phone', '+37255512345');

    expect(res).toEqual({ success: false, error: 'OTP_COOLDOWN' });
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns USER_NOT_FOUND for a missing user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const res = await requestContactChangeService('ghost', 'phone', '+37255512345');

    expect(res).toEqual({ success: false, error: 'USER_NOT_FOUND' });
  });
});

describe('verifyContactChangeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedis.get.mockResolvedValue('+37255512345');
    mockVerifyOtp.mockResolvedValue({ success: true });
    mockTx.user.findFirst.mockResolvedValue(null);
    mockTx.user.updateMany.mockResolvedValue({ count: 0 });
    mockTx.user.update.mockResolvedValue({ id: 'user-1' });
  });

  it('saves the phone as verified, releases unverified leftovers and clears the pending change', async () => {
    const res = await verifyContactChangeService('user-1', 'phone', '+37255512345', '1234');

    expect(res).toEqual({ success: true, data: { identifier: '+37255512345' } });
    expect(mockVerifyOtp).toHaveBeenCalledWith('+37255512345', 'contact_change', '1234', 'phone');
    expect(mockTx.user.updateMany).toHaveBeenCalledWith({
      where: { phone: '+37255512345', id: { not: 'user-1' }, isVerified: false },
      data: { phone: null },
    });
    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { phone: '+37255512345', phoneVerified: true },
    });
    expect(mockRedis.del).toHaveBeenCalledWith('contact_change:pending:user-1:phone');
  });

  it('replaces email with the normalised value', async () => {
    mockRedis.get.mockResolvedValue('new@example.com');

    await verifyContactChangeService('user-1', 'email', 'New@Example.com', '1234');

    expect(mockTx.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { email: 'new@example.com', emailVerified: true },
    });
  });

  it('refuses when this user has no pending change for that value', async () => {
    mockRedis.get.mockResolvedValue('+37255500000');

    const res = await verifyContactChangeService('user-1', 'phone', '+37255512345', '1234');

    expect(res).toEqual({ success: false, error: 'NO_PENDING_CHANGE' });
    expect(mockVerifyOtp).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid_otp', 'OTP_INVALID'],
    ['expired', 'OTP_EXPIRED'],
    ['too_many_attempts', 'OTP_TOO_MANY_ATTEMPTS'],
  ])('maps OTP failure %s to %s without writing', async (reason, error) => {
    mockVerifyOtp.mockResolvedValue({ success: false, reason });

    const res = await verifyContactChangeService('user-1', 'phone', '+37255512345', '0000');

    expect(res).toEqual({ success: false, error });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockRedis.del).not.toHaveBeenCalled();
  });

  it('rejects when another verified account took the value meanwhile', async () => {
    mockTx.user.findFirst.mockResolvedValue({ id: 'user-2' });

    const res = await verifyContactChangeService('user-1', 'phone', '+37255512345', '1234');

    expect(res).toEqual({ success: false, error: 'CONTACT_IN_USE' });
    expect(mockTx.user.update).not.toHaveBeenCalled();
  });

  it('maps a unique-constraint race to CONTACT_IN_USE', async () => {
    mockTx.user.update.mockRejectedValue(Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }));

    const res = await verifyContactChangeService('user-1', 'phone', '+37255512345', '1234');

    expect(res).toEqual({ success: false, error: 'CONTACT_IN_USE' });
  });

  it('rethrows unexpected database errors', async () => {
    mockTx.user.update.mockRejectedValue(new Error('connection lost'));

    await expect(verifyContactChangeService('user-1', 'phone', '+37255512345', '1234')).rejects.toThrow(
      'connection lost',
    );
  });
});
