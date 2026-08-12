import {
  normalizeName,
  namesMatch,
  exactNamesMatch,
  datesOfBirthMatch,
  gendersMatch,
  matchIdentity,
  matchIdentityStrict,
} from './nameMatch';

describe('normalizeName', () => {
  it('lowercases, strips diacritics and punctuation, drops single initials', () => {
    expect(normalizeName('Jón S. Smith')).toEqual(['jon', 'smith']);
    expect(normalizeName('SMITH, John')).toEqual(['smith', 'john']);
    expect(normalizeName('  Anna-María  ')).toEqual(['anna', 'maria']);
  });
});

describe('namesMatch', () => {
  it('matches ignoring case, accents, punctuation', () => {
    expect(namesMatch('jon smith', 'Jón S. Smith')).toBe(true);
  });

  it('matches regardless of token order', () => {
    expect(namesMatch('John Smith', 'Smith, John')).toBe(true);
  });

  it('allows extra middle names on the verified side', () => {
    expect(namesMatch('John Smith', 'John Michael Smith')).toBe(true);
  });

  it('rejects genuinely different names', () => {
    expect(namesMatch('Jane Doe', 'John Smith')).toBe(false);
  });

  it('rejects when an entered token is absent from the verified name', () => {
    expect(namesMatch('John Adam Smith', 'John Smith')).toBe(false);
  });

  it('rejects a single shared token (surname only)', () => {
    expect(namesMatch('Alice Smith', 'Bob Smith')).toBe(false);
  });

  it('returns false for missing or single-token names', () => {
    expect(namesMatch(null, 'John Smith')).toBe(false);
    expect(namesMatch('John Smith', null)).toBe(false);
    expect(namesMatch('', 'John Smith')).toBe(false);
    expect(namesMatch('Cher', 'Cher')).toBe(false);
  });
});

describe('datesOfBirthMatch', () => {
  it('matches a Date against a YYYY-MM-DD string (UTC, day precision)', () => {
    expect(datesOfBirthMatch(new Date('1990-05-15T00:00:00Z'), '1990-05-15')).toBe(true);
    expect(datesOfBirthMatch(new Date('1990-05-15T00:00:00Z'), '1990-05-16')).toBe(false);
  });

  it('matches Stripe { day, month, year } parts', () => {
    expect(datesOfBirthMatch('1990-05-15', { day: 15, month: 5, year: 1990 })).toBe(true);
    expect(datesOfBirthMatch('1990-05-15', { day: 1, month: 5, year: 1990 })).toBe(false);
  });

  it('returns null when either side is missing or unparseable', () => {
    expect(datesOfBirthMatch(null, '1990-05-15')).toBeNull();
    expect(datesOfBirthMatch('1990-05-15', undefined)).toBeNull();
    expect(datesOfBirthMatch('1990-05-15', { day: null, month: 5, year: 1990 })).toBeNull();
  });
});

describe('gendersMatch', () => {
  it('matches across M/F and MALE/FEMALE encodings', () => {
    expect(gendersMatch('MALE', 'M')).toBe(true);
    expect(gendersMatch('FEMALE', 'f')).toBe(true);
    expect(gendersMatch('MALE', 'F')).toBe(false);
  });

  it('returns null for non-binary/unknown/missing values (not comparable)', () => {
    expect(gendersMatch('NON_BINARY', 'M')).toBeNull();
    expect(gendersMatch('MALE', null)).toBeNull();
    expect(gendersMatch('PREFER_NOT_TO_SAY', 'F')).toBeNull();
  });
});

describe('matchIdentity', () => {
  const entered = { name: 'John Smith', dob: new Date('1990-05-15T00:00:00Z'), gender: 'MALE' };

  it('passes overall when name, dob and gender all match', () => {
    const r = matchIdentity(entered, { name: 'John Michael Smith', dob: '1990-05-15', gender: 'M' });
    expect(r).toEqual({ nameMatch: true, dobMatch: true, genderMatch: true, overall: true });
  });

  it('fails overall on a DOB mismatch even when name matches', () => {
    const r = matchIdentity(entered, { name: 'John Smith', dob: '1991-05-15', gender: 'M' });
    expect(r.dobMatch).toBe(false);
    expect(r.overall).toBe(false);
  });

  it('fails overall on a gender mismatch', () => {
    const r = matchIdentity(entered, { name: 'John Smith', dob: '1990-05-15', gender: 'F' });
    expect(r.genderMatch).toBe(false);
    expect(r.overall).toBe(false);
  });

  it('passes overall when dob/gender are not provided but the name matches', () => {
    const r = matchIdentity(entered, { name: 'John Smith' });
    expect(r).toEqual({ nameMatch: true, dobMatch: null, genderMatch: null, overall: true });
  });

  it('fails overall when the name does not match regardless of other fields', () => {
    const r = matchIdentity(entered, { name: 'Jane Doe', dob: '1990-05-15', gender: 'M' });
    expect(r.overall).toBe(false);
  });
});

describe('exactNamesMatch', () => {
  it('ignores case, accents and punctuation — that is spelling, not identity', () => {
    expect(exactNamesMatch('jon smith', 'Jón  Smith')).toBe(true);
    expect(exactNamesMatch('John Smith', 'John, Smith')).toBe(true);
  });

  it('rejects a reordered name that the fuzzy matcher accepts', () => {
    expect(namesMatch('John Smith', 'Smith John')).toBe(true);
    expect(exactNamesMatch('John Smith', 'Smith John')).toBe(false);
  });

  it('rejects an extra middle name that the fuzzy matcher accepts', () => {
    expect(namesMatch('John Smith', 'John Michael Smith')).toBe(true);
    expect(exactNamesMatch('John Smith', 'John Michael Smith')).toBe(false);
  });

  it('rejects a different name', () => {
    expect(exactNamesMatch('Jane Doe', 'John Smith')).toBe(false);
  });

  it('returns false when either side is missing', () => {
    expect(exactNamesMatch(null, 'John Smith')).toBe(false);
    expect(exactNamesMatch('John Smith', '')).toBe(false);
  });
});

describe('matchIdentityStrict', () => {
  const entered = { name: 'John Smith', dob: new Date('1990-05-15T00:00:00Z'), gender: 'MALE' };

  it('passes only when name, dob and gender all match exactly', () => {
    const r = matchIdentityStrict(entered, { name: 'John Smith', dob: '1990-05-15', gender: 'M' });
    expect(r).toEqual({ nameMatch: true, dobMatch: true, genderMatch: true, overall: true });
  });

  it('treats a missing DOB as a mismatch rather than "not comparable"', () => {
    const r = matchIdentityStrict(entered, { name: 'John Smith', gender: 'M' });
    expect(r.dobMatch).toBe(false);
    expect(r.overall).toBe(false);
  });

  it('treats a missing gender as a mismatch rather than "not comparable"', () => {
    const r = matchIdentityStrict(entered, { name: 'John Smith', dob: '1990-05-15' });
    expect(r.genderMatch).toBe(false);
    expect(r.overall).toBe(false);
  });

  // The profile side can also be non-comparable: NON_BINARY has no Veriff counterpart.
  it('fails when the entered gender is not a binary value', () => {
    const r = matchIdentityStrict(
      { ...entered, gender: 'NON_BINARY' },
      { name: 'John Smith', dob: '1990-05-15', gender: 'M' },
    );
    expect(r.genderMatch).toBe(false);
    expect(r.overall).toBe(false);
  });

  it('fails on an extra middle name that matchIdentity would let through', () => {
    const verified = { name: 'John Michael Smith', dob: '1990-05-15', gender: 'M' };
    expect(matchIdentity(entered, verified).overall).toBe(true);
    expect(matchIdentityStrict(entered, verified).overall).toBe(false);
  });
});
