import geoip from 'geoip-lite';
import type { IncomingHttpHeaders } from 'http';

/**
 * Country lookup from a request IP, used to show admins where a user connects from.
 *
 * Backed by the GeoLite2 snapshot bundled with `geoip-lite`: an offline table, so no per-request
 * network call and no third party learning our users' addresses. The snapshot ages — refresh it
 * periodically (`node node_modules/geoip-lite/scripts/updatedb.js`) or countries drift out of date.
 *
 * Accuracy is what IP geolocation always is: right for most residential traffic, wrong for VPNs,
 * and occasionally wrong for mobile carriers that route through another country. It answers "where
 * does this connection appear to come from", never "where is this person".
 */

/** Addresses that belong to no country: loopback, link-local, and the private ranges. */
const isNonRoutable = (ip: string): boolean => {
  if (ip === '::1' || ip === '::' || ip.startsWith('127.')) return true;
  // RFC1918
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  // Link-local (IPv4 169.254/16, IPv6 fe80::/10) and IPv6 unique-local (fc00::/7)
  if (ip.startsWith('169.254.')) return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  return false;
};

/**
 * Resolve a request IP to an ISO-3166 alpha-2 country code.
 *
 * Returns `null` whenever we cannot honestly say — no address, a private or loopback one (a
 * developer on localhost lives nowhere), or an address the database does not cover. Null must keep
 * meaning "never learned", so callers can tell it apart from a country we actually observed.
 */
export const resolveCountryFromIp = (ip?: string | null): string | null => {
  if (!ip) return null;

  // Express reports IPv4 callers as ::ffff:1.2.3.4 when the socket is dual-stack.
  const normalized = ip.trim().replace(/^::ffff:/i, '');
  if (!normalized || isNonRoutable(normalized)) return null;

  try {
    const found = geoip.lookup(normalized);
    const country = found?.country ? found.country.toUpperCase() : null;
    if (!country) return null;

    // City and country in one value, "New Delhi, IN". The city is the less certain half of the
    // same lookup — the table names no city for a great many addresses, and a mobile carrier
    // resolves to wherever its gateway sits — so the country is what always survives, and the
    // country alone is what a bare value means.
    const city = found?.city?.trim();
    return city ? `${city}, ${country}` : country;
  } catch {
    // A malformed address is not worth an error — we simply learned nothing.
    return null;
  }
};

/** Only the parts of a request this needs, so tests need no Express instance. */
type ForwardedRequest = {
  headers: IncomingHttpHeaders;
  ip?: string;
};

/** Node hands a repeated header over as an array; the first value is the one that arrived first. */
const firstHeaderValue = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * The address of the caller a request came from, for country lookup.
 *
 * Deliberately not `req.ip`. With a numeric `trust proxy`, Express resolves `req.ip` by counting
 * hops from the socket inwards, so it lands on whichever address sits that many entries from the
 * right of `x-forwarded-for` — and every platform edge that appends its own address on the way in
 * shifts the answer by one. The count has to match each deployment exactly, and when it does not,
 * the result is not an error but a plausible-looking wrong country: the datacenter's.
 *
 * So this reads the client from the left instead, where the original caller always is:
 *  - `x-real-ip`, which our own Next proxy sets to the caller it saw and no intermediary rewrites;
 *  - else the leftmost `x-forwarded-for` entry, the original client by convention;
 *  - else the socket address, for a direct connection with no proxy in front (local dev).
 *
 * Both headers are ultimately client-supplied, so this answers "where does this user appear to
 * connect from" for an admin to read, and must not be used to key anything that guards the API —
 * the rate limiters stay on `req.ip` for exactly that reason.
 */
export const getClientIpForGeo = (req: ForwardedRequest): string | undefined => {
  // Only the address our own webapp declares, under a name no infrastructure touches.
  //
  // The standard forwarding headers cannot be used here, and this is not a matter of precedence:
  // Railway's edge *replaces* `x-forwarded-for` and `x-real-ip` with the address of whoever
  // connected to it. Since the browser talks to the webapp on Vercel and the webapp talks to this
  // API, the address Railway reports is always Vercel's egress — measured on staging, every single
  // request resolved to AWS us-east-1 in Ashburn, and no browser address appeared once. Reading
  // those headers therefore records the webapp's hosting region as every user's country, whichever
  // end of the chain you read them from.
  //
  // The webapp sets this header from the client address Vercel gives it, and nothing in between
  // rewrites it. A request without it — this API's own server-to-server traffic, or anything
  // reaching it directly — declares no caller, so no country is learned. That is the honest
  // answer: `null` means "never learned", and it is better than a datacenter's country.
  //
  // Being client-supplied, it is spoofable by anyone calling this API directly, so it decides
  // nothing but the country an admin reads. The rate limiters stay on `req.ip`.
  const declared = firstHeaderValue(req.headers['x-deliivo-client-ip'])?.trim();
  if (declared) return declared;

  return undefined;
};
