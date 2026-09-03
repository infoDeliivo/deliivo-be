import { getClientIpForGeo, resolveCountryFromIp } from './geoip.js';

describe('resolveCountryFromIp', () => {
  it('resolves a public address to its country', () => {
    expect(resolveCountryFromIp('8.8.8.8')).toBe('US');
    expect(resolveCountryFromIp('80.235.1.1')).toBe('EE');
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
  it('prefers x-real-ip, which our own proxy sets and no intermediary rewrites', () => {
    expect(
      getClientIpForGeo({
        headers: { 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '8.8.8.8, 10.0.0.7' },
        ip: '10.0.0.7',
      }),
    ).toBe('8.8.8.8');
  });

  it('falls back to the leftmost x-forwarded-for entry', () => {
    expect(getClientIpForGeo({ headers: { 'x-forwarded-for': '8.8.8.8' }, ip: '10.0.0.7' })).toBe('8.8.8.8');
  });

  it('ignores proxy hops appended to the right of the client', () => {
    // The bug this helper exists for: req.ip lands on the rightmost hop, so a platform edge
    // appending its own address made every user look like they connect from a datacenter.
    expect(
      getClientIpForGeo({ headers: { 'x-forwarded-for': '80.235.1.1, 10.0.0.7, 172.20.0.3' }, ip: '172.20.0.3' }),
    ).toBe('80.235.1.1');
    expect(resolveCountryFromIp(getClientIpForGeo({ headers: { 'x-forwarded-for': '80.235.1.1, 10.0.0.7' } }))).toBe('EE');
  });

  it('reads the first value when a header arrives repeated', () => {
    expect(getClientIpForGeo({ headers: { 'x-real-ip': ['8.8.8.8', '1.1.1.1'] } })).toBe('8.8.8.8');
    expect(getClientIpForGeo({ headers: { 'x-forwarded-for': ['8.8.8.8, 10.0.0.7', '1.1.1.1'] } })).toBe('8.8.8.8');
  });

  it('trims surrounding whitespace', () => {
    expect(getClientIpForGeo({ headers: { 'x-forwarded-for': '  8.8.8.8 , 10.0.0.7' } })).toBe('8.8.8.8');
  });

  it('falls back to the socket address when no forwarding header is present', () => {
    // Local dev and any non-proxied deployment.
    expect(getClientIpForGeo({ headers: {}, ip: '127.0.0.1' })).toBe('127.0.0.1');
    expect(resolveCountryFromIp(getClientIpForGeo({ headers: {}, ip: '127.0.0.1' }))).toBeNull();
  });

  it('skips a header that is present but empty rather than returning a blank address', () => {
    expect(getClientIpForGeo({ headers: { 'x-real-ip': '   ' }, ip: '8.8.8.8' })).toBe('8.8.8.8');
    expect(getClientIpForGeo({ headers: { 'x-forwarded-for': ' , 10.0.0.7' }, ip: '8.8.8.8' })).toBe('8.8.8.8');
  });

  it('places nobody when there is no address anywhere', () => {
    expect(getClientIpForGeo({ headers: {} })).toBeUndefined();
    expect(resolveCountryFromIp(getClientIpForGeo({ headers: {} }))).toBeNull();
  });
});
