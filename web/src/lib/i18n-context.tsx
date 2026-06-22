'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { dictionaries } from './i18n-dictionaries';
import {
  DEFAULT_LOCALE,
  getBrowserLocale,
  isSupportedLocale,
  LOCALE_CHANGE_EVENT,
  persistLocale,
  type SupportedLocale,
} from './i18n';

type TranslationParams = Record<string, string | number>;

type I18nContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, params?: TranslationParams) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(value: string, params?: TranslationParams) {
  if (!params) return value;
  return Object.entries(params).reduce(
    (text, [key, replacement]) => text.replaceAll(`{${key}}`, String(replacement)),
    value
  );
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    const resolved = getBrowserLocale();
    setLocaleState(resolved);
    document.documentElement.lang = resolved;

    const handleLocaleChange = (event: Event) => {
      const nextLocale = (event as CustomEvent<string>).detail;
      if (isSupportedLocale(nextLocale)) setLocaleState(nextLocale);
    };

    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      persistLocale(nextLocale);
      setLocaleState(nextLocale);
    },
    t(key, params) {
      const translated = dictionaries[locale]?.[key] || dictionaries.en[key] || key;
      return interpolate(translated, params);
    },
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useTranslation() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useTranslation must be used inside I18nProvider');
  }
  return context;
}
