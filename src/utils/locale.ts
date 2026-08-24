/**
 * Locale handling shared by the blog content module and the auth signup path.
 *
 * These are the five languages the website ships in (see SUPPORTED_LOCALES in the webapp's
 * src/lib/i18n.ts — the two lists must stay in step, or a user's language is silently dropped).
 * Anything else is not a language we can serve, and is treated as unknown rather than coerced.
 */
export const SUPPORTED_LOCALES = ['en', 'et', 'lv', 'lt', 'ru'] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Every spelling seen in the wild that maps onto a supported language — two-letter tags, ISO 639-2
 * codes, and the endonym/English names editors type by hand into the CMS.
 */
const LOCALE_ALIASES: Record<string, SupportedLocale> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  et: 'et',
  ee: 'et',
  est: 'et',
  eesti: 'et',
  estonian: 'et',
  lv: 'lv',
  lav: 'lv',
  latvian: 'lv',
  latviesu: 'lv',
  lt: 'lt',
  lit: 'lt',
  lithuanian: 'lt',
  lietuviu: 'lt',
  ru: 'ru',
  rus: 'ru',
  russian: 'ru',
};

const ALIASES_BY_LOCALE: Record<SupportedLocale, string[]> = {
  en: ['en', 'eng', 'english'],
  et: ['et', 'ee', 'est', 'eesti', 'estonian'],
  lv: ['lv', 'lav', 'latvian', 'latviesu'],
  lt: ['lt', 'lit', 'lithuanian', 'lietuviu'],
  ru: ['ru', 'rus', 'russian'],
};

/**
 * Resolve any locale spelling to a supported language, falling back to `en`.
 *
 * Content rows must always carry a language, so an unrecognised value becomes `en` here. Callers
 * that need to distinguish "unsupported" from "English" must use {@link matchSupportedLocale}.
 */
export const normalizeLocale = (input?: string): SupportedLocale =>
  matchSupportedLocale(input) ?? 'en';

/**
 * Like {@link normalizeLocale}, but returns `null` instead of defaulting when the input names no
 * supported language. A full tag (`et-EE`, `ru_RU`) resolves on its language part.
 */
export const matchSupportedLocale = (input?: string): SupportedLocale | null => {
  if (!input) return null;

  const normalized = input.trim().toLowerCase().replace('_', '-');
  if (!normalized) return null;

  const primary = normalized.split('-')[0];
  return LOCALE_ALIASES[normalized] ?? LOCALE_ALIASES[primary] ?? null;
};

/**
 * All stored spellings that should match a given locale, so a query for `et` still finds rows
 * an editor saved as `eesti`.
 */
export const localeLookupValues = (locale: string): string[] => {
  const normalizedLocale = normalizeLocale(locale);
  return Array.from(new Set([normalizedLocale, ...ALIASES_BY_LOCALE[normalizedLocale]]));
};

/** First language tag of an `Accept-Language` header, with any `;q=` weight stripped. */
const firstAcceptLanguageTag = (header: string): string | undefined =>
  header.split(',')[0]?.split(';')[0]?.trim() || undefined;

/**
 * The language the request is being made in: what the website explicitly sent, else what the
 * browser asked for, else nothing.
 *
 * Returns `null` rather than `en` when neither names a supported language — a stored `null` means
 * "never learned", which is a different fact from "chose English".
 */
export const resolveRequestLocale = (
  explicit?: string,
  acceptLanguage?: string,
): SupportedLocale | null => {
  const fromExplicit = matchSupportedLocale(explicit);
  if (fromExplicit) return fromExplicit;

  if (!acceptLanguage) return null;
  return matchSupportedLocale(firstAcceptLanguageTag(acceptLanguage));
};
