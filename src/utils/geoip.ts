import geoip from 'geoip-lite';

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
    const country = geoip.lookup(normalized)?.country;
    return country ? country.toUpperCase() : null;
  } catch {
    // A malformed address is not worth an error — we simply learned nothing.
    return null;
  }
};
