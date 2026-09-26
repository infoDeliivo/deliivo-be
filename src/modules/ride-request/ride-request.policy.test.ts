import { assertRequestWindow, assertOfferFits } from './ride-request.policy';
describe('ride request windows and capacity', () => {
  const now = new Date('2026-10-01T09:00:00Z');
  it('accepts an exact departure at least three hours ahead', () =>
    expect(() =>
      assertRequestWindow(new Date('2026-10-01T12:00:00Z'), new Date('2026-10-01T12:00:00Z'), now),
    ).not.toThrow());
  it.each([
    ['2026-10-01T11:59:00Z', '2026-10-01T13:00:00Z'],
    ['2026-10-01T14:00:00Z', '2026-10-01T13:00:00Z'],
    ['2026-10-01T14:00:00Z', '2026-10-02T14:01:00Z'],
    ['invalid', 'invalid'],
    ['2028-10-01T14:00:00Z', '2028-10-01T15:00:00Z'],
  ])('rejects invalid travel window %s to %s', (after, before) =>
    expect(() => assertRequestWindow(new Date(after), new Date(before), now)).toThrow(),
  );
  const request = {
    departureAfter: new Date('2026-10-01T14:00:00Z'),
    departureBefore: new Date('2026-10-01T16:00:00Z'),
    seats: 2,
  };
  it('allows a shared vehicle with spare seats', () =>
    expect(() => assertOfferFits(request, new Date('2026-10-01T15:00:00Z'), 4)).not.toThrow());
  it('rejects insufficient seats', () =>
    expect(() => assertOfferFits(request, new Date('2026-10-01T15:00:00Z'), 1)).toThrow());
  it('rejects a departure outside the window', () =>
    expect(() => assertOfferFits(request, new Date('2026-10-01T17:00:00Z'), 4)).toThrow());
});
