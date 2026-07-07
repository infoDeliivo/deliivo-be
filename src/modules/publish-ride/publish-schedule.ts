export const MINIMUM_PUBLISH_LEAD_MS = 3 * 60 * 60 * 1000;

export const getDepartureAtUtc = (departureDate: Date, departureTime: string): Date | null => {
  const [hoursRaw, minutesRaw] = departureTime.split(':');
  const hours = Number(hoursRaw);
  const minutes = Number(minutesRaw);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return new Date(Date.UTC(
    departureDate.getUTCFullYear(),
    departureDate.getUTCMonth(),
    departureDate.getUTCDate(),
    hours,
    minutes,
  ));
};

export const isPublishDepartureTooSoon = (
  departureDate: Date,
  departureTime: string,
  now: Date = new Date(),
): boolean => {
  const departureAt = getDepartureAtUtc(departureDate, departureTime);
  return !departureAt || departureAt.getTime() - now.getTime() < MINIMUM_PUBLISH_LEAD_MS;
};
