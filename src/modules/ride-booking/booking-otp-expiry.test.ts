import { bookingOtpExpiries } from './booking-otp-expiry';

describe('journey-based booking OTP expiry', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  it('keeps codes valid for journeys booked months ahead', () => {
    const result = bookingOtpExpiries(
      {
        departureDate: new Date('2027-01-01T00:00:00Z'),
        departureTime: '09:30',
        routeDurationSeconds: 7200,
      },
      now,
    );
    expect(result.pickupOtpExpiresAt.toISOString()).toBe('2027-01-01T15:30:00.000Z');
    expect(result.dropOtpExpiresAt.toISOString()).toBe('2027-01-02T11:30:00.000Z');
  });
  it('covers journeys longer than a day and crossing midnight', () => {
    const result = bookingOtpExpiries(
      {
        departureDate: new Date('2026-09-27T00:00:00Z'),
        departureTime: '23:30',
        routeDurationSeconds: 30 * 3600,
      },
      now,
    );
    expect(result.dropOtpExpiresAt.toISOString()).toBe('2026-09-30T05:30:00.000Z');
  });
  it('keeps the existing grace window for a late confirmation', () => {
    const result = bookingOtpExpiries(
      { departureDate: new Date('2026-09-26T00:00:00Z'), departureTime: '11:00' },
      now,
    );
    expect(result.pickupOtpExpiresAt.toISOString()).toBe('2026-09-26T18:00:00.000Z');
    expect(result.dropOtpExpiresAt.toISOString()).toBe('2026-09-27T12:00:00.000Z');
  });
});
