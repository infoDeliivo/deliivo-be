import { isPublishDepartureTooSoon } from './publish-schedule.js';

describe('publish schedule lead time', () => {
  const now = new Date('2026-07-06T10:00:00.000Z');
  const sameDay = new Date('2026-07-06T00:00:00.000Z');

  it('allows publishing today when departure is at least three hours away', () => {
    expect(isPublishDepartureTooSoon(sameDay, '13:00', now)).toBe(false);
  });

  it('rejects publishing today when departure is less than three hours away', () => {
    expect(isPublishDepartureTooSoon(sameDay, '12:59', now)).toBe(true);
  });
});
