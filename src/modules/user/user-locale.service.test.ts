const mockPrisma = {
  user: { updateMany: jest.fn(), update: jest.fn() },
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

import { setPreferredLocale, syncPreferredLocale } from './user-locale.service.js';

describe('syncPreferredLocale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCache.mockResolvedValue(null);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
  });

  it('stores the language of a user whose language is still unknown', async () => {
    await syncPreferredLocale('u1', 'lv-LV,lv;q=0.9');

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', preferredLocale: null },
      data: { preferredLocale: 'lv' },
    });
  });

  it('skips the database entirely when the language is already synced', async () => {
    mockGetCache.mockResolvedValue('et');

    await syncPreferredLocale('u1', 'et-EE');

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it('only ever fills a language we do not know yet', async () => {
    await syncPreferredLocale('u1', 'lv-LV');

    // The website redirects any unprefixed link to /en, so a request's language is not evidence
    // that the user changed theirs. Detection fills a blank; it never rewrites a known value.
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'u1', preferredLocale: null },
      data: { preferredLocale: 'lv' },
    });
  });

  it('still records the newest language against the marker after a switch', async () => {
    mockGetCache.mockResolvedValue('et');
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    await syncPreferredLocale('u1', 'ru');

    // The row already had a language, so nothing was written — but the marker moves on so the
    // next request in the same language does not retry the guarded update.
    expect(mockSetCache).toHaveBeenCalledWith('user:u1:locale-synced', 'ru', expect.any(Number));
  });

  it('never wipes a known language when the request names none', async () => {
    await syncPreferredLocale('u1', undefined);
    await syncPreferredLocale('u1', '');
    // An unsupported language is "we learned nothing", not "forget what you knew".
    await syncPreferredLocale('u1', 'de-DE,fr;q=0.8');

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('drops the cached profile so /users/me stops serving the old language', async () => {
    await syncPreferredLocale('u1', 'ru');

    expect(mockDeleteCache).toHaveBeenCalledWith('user:u1');
  });

  it('leaves the profile cache alone when the row was already correct', async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    await syncPreferredLocale('u1', 'ru');

    // Still remembered, so the next request skips the database too.
    expect(mockSetCache).toHaveBeenCalledWith('user:u1:locale-synced', 'ru', expect.any(Number));
    expect(mockDeleteCache).not.toHaveBeenCalled();
  });

  it('takes the first value when the header arrives repeated', async () => {
    await syncPreferredLocale('u1', ['lt', 'ru']);

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { preferredLocale: 'lt' } }),
    );
  });

  it('does nothing without a user id', async () => {
    await syncPreferredLocale(undefined, 'ru');

    expect(mockGetCache).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('prefers a stated language over the header', async () => {
    await syncPreferredLocale('u1', 'en-GB,en;q=0.9', 'lt');

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { preferredLocale: 'lt' } }),
    );
  });

  it('falls back to the header when the stated language is not one we serve', async () => {
    await syncPreferredLocale('u1', 'ru-RU', 'de');

    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { preferredLocale: 'ru' } }),
    );
  });

  it('writes nothing when neither the stated language nor the header resolves', async () => {
    await syncPreferredLocale('u1', 'de-DE', 'fr');

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
    expect(mockGetCache).not.toHaveBeenCalled();
  });

  it('swallows a database failure so the request still succeeds', async () => {
    mockPrisma.user.updateMany.mockRejectedValue(new Error('connection lost'));

    await expect(syncPreferredLocale('u1', 'ru')).resolves.toBeUndefined();
    expect(mockLogWarn).toHaveBeenCalled();
  });
});

describe('setPreferredLocale', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({ id: 'u1', preferredLocale: 'lv' });
  });

  it('stores the chosen language and reports it back', async () => {
    const stored = await setPreferredLocale('u1', 'lv');

    expect(stored).toBe('lv');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { preferredLocale: 'lv' },
    });
  });

  it('accepts a full tag and stores only the language', async () => {
    expect(await setPreferredLocale('u1', 'ru-RU')).toBe('ru');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { preferredLocale: 'ru' },
    });
  });

  it('writes unguarded, because an explicit choice always wins', async () => {
    await setPreferredLocale('u1', 'lt');

    // No OR/not guard here — unlike the passive sync, this is the user saying so.
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { preferredLocale: 'lt' },
    });
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it('refreshes the sync marker so the next request does no work', async () => {
    await setPreferredLocale('u1', 'lv');

    expect(mockSetCache).toHaveBeenCalledWith('user:u1:locale-synced', 'lv', expect.any(Number));
    expect(mockDeleteCache).toHaveBeenCalledWith('user:u1');
  });

  it('rejects a language the site does not ship, without writing', async () => {
    expect(await setPreferredLocale('u1', 'de-DE')).toBeNull();
    expect(await setPreferredLocale('u1', 'nonsense')).toBeNull();

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });
});
