const mockPrisma = {
  user: { updateMany: jest.fn() },
};
const mockGetCache = jest.fn();
const mockSetCache = jest.fn();
const mockDeleteCache = jest.fn();
const mockLogWarn = jest.fn();

jest.mock('../../config/index.js', () => ({
  __esModule: true,
  prisma: mockPrisma,
}));

jest.mock('../../services/cache.service.js', () => ({
  __esModule: true,
  cacheKeys: { user: (id: string) => `user:${id}` },
  getCache: (...args: unknown[]) => mockGetCache(...args),
  setCache: (...args: unknown[]) => mockSetCache(...args),
  deleteCache: (...args: unknown[]) => mockDeleteCache(...args),
}));

jest.mock('../../utils/logger.js', () => ({
  __esModule: true,
  logWarn: (...args: unknown[]) => mockLogWarn(...args),
  logInfo: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
  logHttp: jest.fn(),
  default: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn(), http: jest.fn() },
}));

import { clearDetectedCountryCache, syncDetectedCountry } from './user-geo.service.js';

describe('syncDetectedCountry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCache.mockResolvedValue(null);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('records the country a user connects from', async () => {
    await syncDetectedCountry('u1', '8.8.8.8');

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'u1',
        // The null branch is required: in SQL `detectedCountry != 'US'` is unknown for NULL.
        OR: [{ detectedCountry: null }, { detectedCountry: { not: 'US' } }],
      },
      data: { detectedCountry: 'US' },
    });
  });

  it('follows the user when they turn up somewhere else', async () => {
    // Unlike the language, nobody picks this in the UI, so there is no choice to protect and a
    // trip or a move should show.
    mockGetCache.mockResolvedValue('EE');

    await syncDetectedCountry('u1', '8.8.8.8');

    expect(mockPrisma.user.updateMany).toHaveBeenCalled();
    expect(mockSetCache).toHaveBeenCalledWith('user:u1:country-synced', 'US', expect.any(Number));
  });

  it('touches nothing when the country is already the one we recorded', async () => {
    mockGetCache.mockResolvedValue('US');

    await syncDetectedCountry('u1', '8.8.8.8');

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('never wipes a known country when the address places nobody', async () => {
    await syncDetectedCountry('u1', '127.0.0.1');
    await syncDetectedCountry('u1', '192.168.0.5');
    await syncDetectedCountry('u1', undefined);

    expect(mockGetCache).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('does nothing without a user id', async () => {
    await syncDetectedCountry(undefined, '8.8.8.8');

    expect(mockGetCache).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('drops the cached profile so /users/me stops serving the old country', async () => {
    await syncDetectedCountry('u1', '8.8.8.8');

    expect(mockDeleteCache).toHaveBeenCalledWith('user:u1');
  });

  it('leaves the profile cache alone when the row was already correct', async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    await syncDetectedCountry('u1', '8.8.8.8');

    expect(mockSetCache).toHaveBeenCalledWith('user:u1:country-synced', 'US', expect.any(Number));
    expect(mockDeleteCache).not.toHaveBeenCalled();
  });

  it('swallows a database failure so the request still succeeds', async () => {
    mockPrisma.user.updateMany.mockRejectedValue(new Error('connection lost'));

    await expect(syncDetectedCountry('u1', '8.8.8.8')).resolves.toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalled();
  });
});

describe('clearDetectedCountryCache', () => {
  it('forgets the marker for a deleted account', async () => {
    jest.clearAllMocks();

    await clearDetectedCountryCache('u1');

    expect(mockDeleteCache).toHaveBeenCalledWith('user:u1:country-synced');
  });
});
