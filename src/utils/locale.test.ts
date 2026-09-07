import {
  localeLookupValues,
  matchSupportedLocale,
  normalizeLocale,
  resolveRequestLocale,
} from './locale.js';

describe('normalizeLocale', () => {
  it('resolves aliases to the supported language', () => {
    expect(normalizeLocale('et')).toBe('et');
    expect(normalizeLocale('eesti')).toBe('et');
    expect(normalizeLocale('ESTONIAN')).toBe('et');
    expect(normalizeLocale('russian')).toBe('ru');
  });

  it('keeps the language of a full tag', () => {
    expect(normalizeLocale('et-EE')).toBe('et');
    expect(normalizeLocale('ru_RU')).toBe('ru');
  });

  it('falls back to en so a content row always has a language', () => {
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale('')).toBe('en');
    expect(normalizeLocale('  ')).toBe('en');
    expect(normalizeLocale('de-DE')).toBe('en');
  });
});

describe('localeLookupValues', () => {
  it('includes every stored spelling of the language', () => {
    expect(localeLookupValues('et').sort()).toEqual(
      ['ee', 'eesti', 'est', 'estonian', 'et'].sort(),
    );
  });

  it('resolves an alias before expanding it', () => {
    expect(localeLookupValues('russian').sort()).toEqual(['ru', 'rus', 'russian'].sort());
  });
});

describe('the five website languages', () => {
    it('accepts every locale the webapp can be viewed in', () => {
        // Mirrors SUPPORTED_LOCALES in the webapp's src/lib/i18n.ts. If the site gains a language
        // and this list does not, that user's choice is silently stored as null.
        expect(resolveRequestLocale('en')).toBe('en');
        expect(resolveRequestLocale('et')).toBe('et');
        expect(resolveRequestLocale('lv')).toBe('lv');
        expect(resolveRequestLocale('lt')).toBe('lt');
        expect(resolveRequestLocale('ru')).toBe('ru');
    });

    it('accepts the URL codes the site uses in paths', () => {
        // The webapp routes Estonian under /ee/, so that spelling has to resolve too.
        expect(resolveRequestLocale('ee')).toBe('et');
        expect(resolveRequestLocale('lv-LV')).toBe('lv');
        expect(resolveRequestLocale('lt-LT')).toBe('lt');
    });
});

describe('matchSupportedLocale', () => {
  it('returns null rather than defaulting for an unsupported language', () => {
    expect(matchSupportedLocale('de')).toBeNull();
    expect(matchSupportedLocale('de-DE')).toBeNull();
    expect(matchSupportedLocale(undefined)).toBeNull();
    expect(matchSupportedLocale('')).toBeNull();
  });
});

describe('resolveRequestLocale', () => {
  it('uses the locale the website sent', () => {
    expect(resolveRequestLocale('et')).toBe('et');
    expect(resolveRequestLocale('ru')).toBe('ru');
    expect(resolveRequestLocale('english')).toBe('en');
  });

  it('keeps only the language of a full tag', () => {
    expect(resolveRequestLocale('et-EE')).toBe('et');
    expect(resolveRequestLocale('ru_RU')).toBe('ru');
  });

  it('falls back to the first Accept-Language tag, weights stripped', () => {
    expect(resolveRequestLocale(undefined, 'ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(resolveRequestLocale(undefined, 'et;q=1.0')).toBe('et');
  });

  it('prefers the explicit locale over the header', () => {
    expect(resolveRequestLocale('et', 'ru-RU,ru;q=0.9')).toBe('et');
  });

  it('falls through to the header when the explicit locale is unsupported', () => {
    expect(resolveRequestLocale('de-DE', 'et-EE')).toBe('et');
  });

  it('returns null when nothing names a supported language', () => {
    expect(resolveRequestLocale()).toBeNull();
    expect(resolveRequestLocale(undefined, '')).toBeNull();
    expect(resolveRequestLocale('de-DE', 'fr-FR')).toBeNull();
  });

  it('never throws on junk input', () => {
    expect(resolveRequestLocale('!!!', ';;;')).toBeNull();
    expect(resolveRequestLocale('-', ',')).toBeNull();
  });
});
