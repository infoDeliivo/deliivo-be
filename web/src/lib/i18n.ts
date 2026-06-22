export const SUPPORTED_LOCALES = [
  { code: 'en', label: 'English', shortLabel: 'EN' },
  { code: 'et', label: 'Eesti', shortLabel: 'ET' },
  { code: 'ru', label: 'Русский', shortLabel: 'RU' },
] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]['code'];

const configuredDefaultLocale = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;

export const DEFAULT_LOCALE: SupportedLocale = isSupportedLocale(configuredDefaultLocale)
  ? configuredDefaultLocale
  : 'en';
export const LOCALE_STORAGE_KEY = 'deliivo.locale';
export const LOCALE_COOKIE_NAME = 'deliivo_locale';
export const LOCALE_CHANGE_EVENT = 'deliivo:locale-change';

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return SUPPORTED_LOCALES.some((locale) => locale.code === value);
}

export function getBrowserLocale(): SupportedLocale {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;

  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  if (isSupportedLocale(stored)) return stored;

  const browserLocale = window.navigator.language?.split('-')[0];
  if (isSupportedLocale(browserLocale)) return browserLocale;

  return DEFAULT_LOCALE;
}

export function persistLocale(locale: SupportedLocale) {
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  document.cookie = `${LOCALE_COOKIE_NAME}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
  document.documentElement.lang = locale;
  window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: locale }));
}
