export const MINIMUM_BOOKING_AGE_YEARS = 8;

export const parseDateOnlyAsUtc = (value: string): Date | null => {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const calculateAgeYears = (dob: Date, at: Date = new Date()): number => {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const monthDelta = at.getUTCMonth() - dob.getUTCMonth();
  const dayDelta = at.getUTCDate() - dob.getUTCDate();

  if (monthDelta < 0 || (monthDelta === 0 && dayDelta < 0)) {
    age -= 1;
  }

  return age;
};

export const isAtLeastAge = (
  value: string | Date,
  minimumAgeYears: number,
  at: Date = new Date(),
): boolean => {
  const dob = value instanceof Date ? value : parseDateOnlyAsUtc(value);
  if (!dob) return false;
  return calculateAgeYears(dob, at) >= minimumAgeYears;
};
