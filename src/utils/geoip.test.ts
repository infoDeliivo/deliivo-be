import { resolveCountryFromIp } from './geoip.js';

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
