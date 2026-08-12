/**
 * Identity matching for verified identity (Veriff DL, Stripe Connect) against
 * the name / date-of-birth / gender a user typed into their profile.
 *
 * Names use a normalized, order-independent token comparison so real-world
 * variance (accents, punctuation, name order, extra middle names on the
 * document) does not cause false rejects, while still rejecting genuinely
 * different names. DOB and gender are compared only when both sides supply the
 * field — an absent field is "not comparable" (null), not a mismatch.
 */

export type DateInput = Date | string | null | undefined;
export type DobParts = { day?: number | null; month?: number | null; year?: number | null };

/**
 * Normalize a name into comparable tokens:
 * lowercase → strip diacritics → remove punctuation → split on whitespace →
 * drop tokens shorter than 2 chars (single initials carry no signal).
 */
export const normalizeName = (input: string): string[] => {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritical marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ') // punctuation → space
    .split(/\s+/)
    .filter((token) => token.length >= 2);
};

/**
 * True iff the entered name matches the verified name:
 * every entered token appears in the verified token set AND at least two tokens
 * overlap (guards against a single common token matching, e.g. shared surname).
 * Order-independent; extra tokens on the verified side (middle names) are allowed.
 * Returns false if either name is missing/empty.
 */
export const namesMatch = (
  enteredName: string | null | undefined,
  verifiedName: string | null | undefined,
): boolean => {
  if (!enteredName || !verifiedName) return false;

  const enteredTokens = normalizeName(enteredName);
  const verifiedTokens = new Set(normalizeName(verifiedName));

  if (enteredTokens.length < 2 || verifiedTokens.size < 2) return false;

  let overlap = 0;
  for (const token of enteredTokens) {
    if (verifiedTokens.has(token)) {
      overlap += 1;
    } else {
      return false; // an entered token is absent from the verified name
    }
  }

  return overlap >= 2;
};

/**
 * Exact name equality after normalization: same tokens, same order, no extras.
 * Accent, case and punctuation variance is still tolerated (that is spelling, not
 * identity), but a reordered name or an extra middle name is a mismatch.
 * Returns false if either name is missing/empty.
 */
export const exactNamesMatch = (
  enteredName: string | null | undefined,
  verifiedName: string | null | undefined,
): boolean => {
  if (!enteredName || !verifiedName) return false;

  const entered = normalizeName(enteredName);
  const verified = normalizeName(verifiedName);

  if (entered.length === 0 || verified.length === 0) return false;

  return entered.join(' ') === verified.join(' ');
};

/** Normalize any accepted DOB form to a `YYYY-MM-DD` string (UTC), or null. */
const toYmd = (input: DateInput | DobParts): string | null => {
  if (!input) return null;

  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) return null;
    return input.toISOString().slice(0, 10);
  }

  if (typeof input === 'string') {
    const match = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
    const parsed = new Date(input);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  // { day, month, year } (e.g. Stripe individual.dob)
  const { year, month, day } = input;
  if (!year || !month || !day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

/**
 * Compare two dates of birth (day precision, UTC).
 * Returns null when either side is missing/unparseable (not comparable).
 */
export const datesOfBirthMatch = (
  entered: DateInput | DobParts,
  verified: DateInput | DobParts,
): boolean | null => {
  const a = toYmd(entered);
  const b = toYmd(verified);
  if (!a || !b) return null;
  return a === b;
};

/** Normalize a gender value to MALE / FEMALE, or null when not a binary/known value. */
export const normalizeGender = (input: string | null | undefined): 'MALE' | 'FEMALE' | null => {
  if (!input) return null;
  const value = input.trim().toUpperCase();
  if (value === 'M' || value === 'MALE') return 'MALE';
  if (value === 'F' || value === 'FEMALE') return 'FEMALE';
  return null; // NON_BINARY / OTHER / PREFER_NOT_TO_SAY / unknown → not comparable
};

/**
 * Compare gender. Returns null when either side is not a comparable binary value
 * (providers typically only assert M/F; our enum also has non-binary options).
 */
export const gendersMatch = (
  entered: string | null | undefined,
  verified: string | null | undefined,
): boolean | null => {
  const a = normalizeGender(entered);
  const b = normalizeGender(verified);
  if (!a || !b) return null;
  return a === b;
};

export interface IdentityFields {
  name?: string | null;
  dob?: DateInput | DobParts;
  gender?: string | null;
}

export interface IdentityMatchResult {
  nameMatch: boolean;
  dobMatch: boolean | null;
  genderMatch: boolean | null;
  /** Overall pass: name matches AND no comparable field explicitly mismatches. */
  overall: boolean;
}

/**
 * Match a verified identity against the entered profile across name, DOB and
 * gender. `overall` requires the name to match and no comparable field (DOB,
 * gender) to be an explicit mismatch; fields absent on either side are skipped.
 */
export const matchIdentity = (entered: IdentityFields, verified: IdentityFields): IdentityMatchResult => {
  const nameMatch = namesMatch(entered.name, verified.name);
  const dobMatch = datesOfBirthMatch(entered.dob, verified.dob);
  const genderMatch = gendersMatch(entered.gender, verified.gender);
  const overall = nameMatch && dobMatch !== false && genderMatch !== false;
  return { nameMatch, dobMatch, genderMatch, overall };
};

/**
 * KYC-grade match, used for driving-licence verification: the name must match
 * exactly and DOB and gender must both be present on both sides and equal. Unlike
 * `matchIdentity`, a field missing on either side is a mismatch, not "not
 * comparable" — a KYC gate must never pass on a partial comparison.
 */
export const matchIdentityStrict = (
  entered: IdentityFields,
  verified: IdentityFields,
): IdentityMatchResult => {
  const nameMatch = exactNamesMatch(entered.name, verified.name);
  const dobMatch = datesOfBirthMatch(entered.dob, verified.dob) === true;
  const genderMatch = gendersMatch(entered.gender, verified.gender) === true;
  return { nameMatch, dobMatch, genderMatch, overall: nameMatch && dobMatch && genderMatch };
};
