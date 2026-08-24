import type { NextFunction, Request, Response } from 'express';

const mockVerifyAccessToken = jest.fn();
const mockSyncPreferredLocale = jest.fn();
const mockSyncDetectedCountry = jest.fn();

jest.mock('../modules/token/tokens.service.js', () => ({
  __esModule: true,
  verifyAccessToken: (...args: unknown[]) => mockVerifyAccessToken(...args),
}));

jest.mock('../modules/user/user-locale.service.js', () => ({
  __esModule: true,
  syncPreferredLocale: (...args: unknown[]) => mockSyncPreferredLocale(...args),
}));

jest.mock('../modules/user/user-geo.service.js', () => ({
  __esModule: true,
  syncDetectedCountry: (...args: unknown[]) => mockSyncDetectedCountry(...args),
}));

import { learnRequestContext } from './locale.js';

const run = async (headers: Record<string, string | string[] | undefined>, ip = '8.8.8.8') => {
  const next = jest.fn() as NextFunction;
  const req = { headers, ip } as unknown as Request;
  await learnRequestContext(req, {} as Response, next);
  return next;
};

describe('learnRequestContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyAccessToken.mockReturnValue({ id: 'u1', role: 'USER' });
    mockSyncPreferredLocale.mockResolvedValue(undefined);
    mockSyncDetectedCountry.mockResolvedValue(undefined);
  });

  it('follows the language of a request that carries a token', async () => {
    const next = await run({ authorization: 'Bearer token-123', 'accept-language': 'lv-LV,lv;q=0.9' });

    expect(mockSyncPreferredLocale).toHaveBeenCalledWith('u1', 'lv-LV,lv;q=0.9');
    expect(next).toHaveBeenCalledWith();
  });

  it('records the country of the same request, on one token verification', async () => {
    const next = await run({ authorization: 'Bearer token-123' }, '80.235.1.1');

    expect(mockVerifyAccessToken).toHaveBeenCalledTimes(1);
    expect(mockSyncDetectedCountry).toHaveBeenCalledWith('u1', '80.235.1.1');
    expect(next).toHaveBeenCalledWith();
  });

  it('does no work for an anonymous request', async () => {
    const next = await run({ 'accept-language': 'et-EE' });

    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    expect(mockSyncPreferredLocale).not.toHaveBeenCalled();
    expect(mockSyncDetectedCountry).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores an authorization header that is not a bearer token', async () => {
    const next = await run({ authorization: 'Basic dXNlcjpwYXNz' });

    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('ignores a bearer header with nothing after it', async () => {
    const next = await run({ authorization: 'Bearer    ' });

    expect(mockVerifyAccessToken).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('lets an expired or forged token through untouched', async () => {
    // A public route must stay public for a visitor whose stored token has gone stale — deciding
    // what to do about the token is the route's business, not this middleware's.
    mockVerifyAccessToken.mockImplementation(() => {
      throw new Error('jwt expired');
    });

    const next = await run({ authorization: 'Bearer stale', 'accept-language': 'ru' });

    expect(mockSyncPreferredLocale).not.toHaveBeenCalled();
    expect(mockSyncDetectedCountry).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('never blocks the request when either sync fails', async () => {
    mockSyncPreferredLocale.mockRejectedValue(new Error('redis down'));
    mockSyncDetectedCountry.mockRejectedValue(new Error('redis down'));

    const next = await run({ authorization: 'Bearer token-123', 'accept-language': 'lt' });

    expect(next).toHaveBeenCalledWith();
  });
});
