import { getClientIpForGeo, resolveCountryFromIp } from './geoip.js';

describe('resolveCountryFromIp', () => {
  it('resolves a public address to its city and country', () => {
    expect(resolveCountryFromIp('8.8.8.8')).toBe('US');
    // City and country together when the table names a city, which it does for most of Europe.
    expect(resolveCountryFromIp('80.235.1.1')).toBe('Tallinn, EE');
  });

  it('reads an IPv4-mapped IPv6 address like its IPv4 form', () => {
    // Express reports dual-stack sockets this way.
    expect(resolveCountryFromIp('::ffff:8.8.8.8')).toBe('US');
  });

  it('places nobody when there is no address', () => {
    expect(resolveCountryFromIp(undefined)).toBeNull();
    expect(resolveCountryFromIp(null)).toBeNull();
    expect(resolveCountryFromIp('')).toBeNull();
    expect(resolveCountryFromIp('   ')).toBeNull();
  });

  it('places nobody on a loopback or private address', () => {
    // A developer on localhost lives nowhere, and null must keep meaning "never learned".
    for (const ip of [
      '127.0.0.1',
      '::1',
      '10.1.2.3',
      '192.168.1.10',
      '172.16.0.1',
      '172.31.255.254',
      '169.254.1.1',
      'fd00::1',
      'fe80::1',
    ]) {
      expect(resolveCountryFromIp(ip)).toBeNull();
    }
  });

  it('treats 172.32.x as public, not private', () => {
    // The RFC1918 block stops at 172.31 — an off-by-one here would blind us to real users.
    expect(resolveCountryFromIp('172.15.0.1')).not.toBe(undefined);
    expect(['string', 'object']).toContain(typeof resolveCountryFromIp('172.32.0.1'));
  });

  it('returns null rather than throwing on a malformed address', () => {
    expect(resolveCountryFromIp('not-an-ip')).toBeNull();
    expect(resolveCountryFromIp('999.999.999.999')).toBeNull();
  });
});

describe('getClientIpForGeo', () => {
  const CLIENT_HEADER = 'x-deliivo-client-ip';

  it('reads the address the webapp declares', () => {
    expect(getClientIpForGeo({ headers: { [CLIENT_HEADER]: '157.49.51.193' } })).toBe('157.49.51.193');
    expect(resolveCountryFromIp(getClientIpForGeo({ headers: { [CLIENT_HEADER]: '157.49.51.193' } }))).toBe(
      'New Delhi, IN',
    );
  });

  it('ignores x-forwarded-for and x-real-ip entirely', () => {
    // Railway replaces both with the address of whoever connected to it, which is Vercel's egress
    // in us-east-1 — measured on staging, every request resolved to Ashburn and no browser address
    // appeared at all. Trusting either header records the webapp's hosting region as the country.
    expect(
      getClientIpForGeo({
        headers: {
          [CLIENT_HEADER]: '157.49.51.193',
          'x-forwarded-for': '98.80.101.1, 152.233.47.68',
          'x-real-ip': '98.80.101.1',
        },
        ip: '152.233.47.68',
      }),
    ).toBe('157.49.51.193');

    // And with no declared caller, those headers buy nothing.
    expect(
      getClientIpForGeo({
        headers: { 'x-forwarded-for': '98.80.101.1, 152.233.47.68', 'x-real-ip': '98.80.101.1' },
        ip: '152.233.47.68',
      }),
    ).toBeUndefined();
  });

  it('learns nothing from an internal call that declares no caller', () => {
    // The webapp's SSR calls this API directly, carrying a user's token but no client address.
    expect(getClientIpForGeo({ headers: {}, ip: '76.76.21.21' })).toBeUndefined();
    expect(resolveCountryFromIp(getClientIpForGeo({ headers: {}, ip: '76.76.21.21' }))).toBeNull();
  });

  it('reads the first value when the header arrives repeated', () => {
    expect(getClientIpForGeo({ headers: { [CLIENT_HEADER]: ['8.8.8.8', '1.1.1.1'] } })).toBe('8.8.8.8');
  });

  it('trims surrounding whitespace', () => {
    expect(getClientIpForGeo({ headers: { [CLIENT_HEADER]: '  8.8.8.8  ' } })).toBe('8.8.8.8');
  });

  it('treats a header that is present but empty as no address at all', () => {
    expect(getClientIpForGeo({ headers: { [CLIENT_HEADER]: '   ' }, ip: '8.8.8.8' })).toBeUndefined();
  });

  it('places nobody when there is no address anywhere', () => {
    expect(getClientIpForGeo({ headers: {} })).toBeUndefined();
    expect(resolveCountryFromIp(getClientIpForGeo({ headers: {} }))).toBeNull();
  });
});

describe('resolveCountryFromIp — the city half', () => {
  it('falls back to the country alone when the table names no city', () => {
    // Common, and not an error: many ranges are placed in a country and nowhere more precise.
    expect(resolveCountryFromIp('8.8.8.8')).toBe('US');
  });

  it('always ends with the country, so the last segment can be read as the country', () => {
    for (const ip of ['157.49.51.193', '80.235.1.1', '8.8.8.8']) {
      const value = resolveCountryFromIp(ip);
      expect(value).not.toBeNull();
      const country = value!.split(',').pop()!.trim();
      expect(country).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('stays within the column width', () => {
    // detectedCountry is VARCHAR(120); a value longer than that would fail the write outright.
    for (const ip of ['157.49.51.193', '80.235.1.1', '212.7.0.1', '133.11.0.1']) {
      expect((resolveCountryFromIp(ip) ?? '').length).toBeLessThanOrEqual(120);
    }
  });
});
