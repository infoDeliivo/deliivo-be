'use client';

import { Languages } from 'lucide-react';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@/lib/i18n';
import { useTranslation } from '@/lib/i18n-context';

type LanguageSwitcherProps = {
  compact?: boolean;
};

export default function LanguageSwitcher({ compact = false }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useTranslation();

  function handleChange(value: SupportedLocale) {
    setLocale(value);
  }

  return (
    <label
      className={`inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white text-sm text-deliivo-dark shadow-sm ${
        compact ? 'px-2 py-1.5' : 'px-3 py-1.5'
      }`}
      title={t('language.label')}
    >
      <Languages size={15} className="text-deliivo-gray" aria-hidden="true" />
      <select
        value={locale}
        onChange={(event) => handleChange(event.target.value as SupportedLocale)}
        className="bg-transparent text-sm font-medium outline-none"
        aria-label={t('language.label')}
      >
        {SUPPORTED_LOCALES.map((option) => (
          <option key={option.code} value={option.code}>
            {compact ? option.shortLabel : option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
