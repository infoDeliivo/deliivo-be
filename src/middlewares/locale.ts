import { NextFunction, Request, RequestHandler, Response } from 'express';
import { verifyAccessToken } from '../modules/token/tokens.service.js';
import { syncPreferredLocale } from '../modules/user/user-locale.service.js';
import { syncDetectedCountry } from '../modules/user/user-geo.service.js';
import { getClientIpForGeo } from '../utils/geoip.js';

/**
 * Learn what a request tells us about the caller — the language they are browsing in, and the
 * country they appear to be connecting from — on every request that carries a token.
 *
 * The passive sync used to live inside `protect`, which meant a user reading the blog or the map
 * in Latvian taught us nothing: those routes are public and run no auth middleware. Since the
 * webapp attaches the access token and `Accept-Language` to every call it makes, the language is
 * right there on the request — it only needed somewhere to be read.
 *
 * Both are recorded on one token verification rather than in two middlewares, and each write is
 * guarded by its own Redis marker, so a repeat request costs two Redis GETs and no database work.
 *
 * Deliberately weaker than authentication and never a gate:
 *  - no `Authorization` header, or one that is not `Bearer`: nothing to learn, move on;
 *  - an expired, forged or malformed token: swallowed, because a public route must stay public
 *    for a visitor whose stored token has gone stale;
 *  - the token is only verified, never looked up, so this costs no database read.
 *
 * `optionalProtect` is not reused here for exactly those reasons: it loads the user row on every
 * call and answers 401 on a malformed header.
 */
export const learnRequestContext: RequestHandler = async (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next();
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return next();
  }

  try {
    const decoded = verifyAccessToken(token);
    await syncPreferredLocale(decoded.id, req.headers['accept-language']);
    await syncDetectedCountry(decoded.id, getClientIpForGeo(req));
  } catch {
    // A token we cannot read tells us nothing about the caller. It is not this middleware's job
    // to reject it — whatever the route is, it decides that for itself.
  }

  return next();
};
