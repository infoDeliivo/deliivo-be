/** OTP windows follow the journey, not the date on which the seats were paid for. */
export function bookingOtpExpiries(
  ride: { departureDate: Date; departureTime: string; routeDurationSeconds?: number | null },
  now = new Date(),
) {
  const [hours, minutes] = ride.departureTime.split(':').map(Number);
  const departure = new Date(ride.departureDate);
  departure.setUTCHours(hours, minutes, 0, 0);
  const start = Math.max(now.getTime(), departure.getTime());
  const durationMs = Math.max(0, ride.routeDurationSeconds || 0) * 1000;
  return {
    pickupOtpExpiresAt: new Date(start + 6 * 3600000),
    dropOtpExpiresAt: new Date(start + durationMs + 24 * 3600000),
  };
}
