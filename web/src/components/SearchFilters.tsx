'use client';

import { useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n-context';

export interface Filters {
  maxPrice: number;
  timeOfDay: string;
  femaleOnly: boolean;
  minRating: number;
}

interface SearchFiltersProps {
  initialFilters: Filters;
  /** Render only the desktop sticky sidebar (hides mobile trigger). */
  desktopOnly?: boolean;
  /** Render only the mobile trigger button + drawer (hides desktop sidebar). */
  mobileOnly?: boolean;
}

const timeOptions = [
  { value: '', label: 'Any time' },
  { value: 'morning', label: 'Morning (6am – 12pm)' },
  { value: 'afternoon', label: 'Afternoon (12pm – 6pm)' },
  { value: 'evening', label: 'Evening (6pm+)' },
];

export default function SearchFilters({
  initialFilters,
  desktopOnly = false,
  mobileOnly = false,
}: SearchFiltersProps) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function applyFilters(updated: Filters) {
    setFilters(updated);
    const params = new URLSearchParams(searchParams.toString());
    params.set('maxPrice', String(updated.maxPrice));
    if (updated.timeOfDay) {
      params.set('timeOfDay', updated.timeOfDay);
    } else {
      params.delete('timeOfDay');
    }
    if (updated.femaleOnly) {
      params.set('femaleOnly', '1');
    } else {
      params.delete('femaleOnly');
    }
    if (updated.minRating > 0) {
      params.set('minRating', String(updated.minRating));
    } else {
      params.delete('minRating');
    }
    router.replace(pathname + '?' + params.toString(), { scroll: false });
  }

  function reset() {
    applyFilters({ maxPrice: 200, timeOfDay: '', femaleOnly: false, minRating: 0 });
  }

  const filtersPanel = (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-deliivo-dark flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-primary-500" />
          {t('common.filters')}
        </h2>
        <button
          onClick={reset}
          className="text-xs text-primary-500 hover:text-primary-600 font-medium"
        >
          {t('common.resetAll')}
        </button>
      </div>

      {/* Max price */}
      <div>
        <div className="flex justify-between mb-2">
          <label className="text-sm font-medium text-deliivo-dark">
            {t('search.maxPriceSeat')}
          </label>
          <span className="text-sm font-bold text-primary-500">
            EUR {filters.maxPrice === 200 ? '200+' : filters.maxPrice}
          </span>
        </div>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          value={filters.maxPrice}
          onChange={(e) =>
            applyFilters({ ...filters, maxPrice: Number(e.target.value) })
          }
          className="w-full accent-primary-500"
        />
        <div className="flex justify-between text-xs text-deliivo-gray mt-1">
          <span>EUR 5</span>
          <span>EUR 200+</span>
        </div>
      </div>

      {/* Time of day */}
      <div>
        <label className="block text-sm font-medium text-deliivo-dark mb-2">
          {t('search.departureTime')}
        </label>
        <div className="flex flex-col gap-1.5">
          {timeOptions.map((opt) => (
            <label
              key={opt.value}
              className="flex items-center gap-2 cursor-pointer"
            >
              <input
                type="radio"
                name="timeOfDay"
                value={opt.value}
                checked={filters.timeOfDay === opt.value}
                onChange={() =>
                  applyFilters({ ...filters, timeOfDay: opt.value })
                }
                className="accent-primary-500"
              />
              <span className="text-sm text-deliivo-dark">
                {t(opt.value === '' ? 'common.anyTime' : opt.value === 'morning' ? 'common.morning' : opt.value === 'afternoon' ? 'common.afternoon' : 'common.evening')}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Women only */}
      <div className="flex items-center justify-between">
        <label
          htmlFor="filter-female"
          className="text-sm font-medium text-deliivo-dark cursor-pointer"
        >
          {t('search.womenOnly')}
        </label>
        <button
          id="filter-female"
          type="button"
          role="switch"
          aria-checked={filters.femaleOnly}
          onClick={() =>
            applyFilters({ ...filters, femaleOnly: !filters.femaleOnly })
          }
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
            filters.femaleOnly ? 'bg-primary-500' : 'bg-gray-200'
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              filters.femaleOnly ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Min rating */}
      <div>
        <label className="block text-sm font-medium text-deliivo-dark mb-2">
          {t('search.minDriverRating')}
        </label>
        <div className="flex gap-2">
          {([0, 3, 4, 4.5] as const).map((r) => (
            <button
              key={r}
              onClick={() => applyFilters({ ...filters, minRating: r })}
              className={`flex-1 rounded-full border py-1.5 text-xs font-medium transition-colors ${
                filters.minRating === r
                  ? 'border-primary-500 bg-primary-500 text-white'
                  : 'border-gray-200 bg-white text-deliivo-gray hover:border-primary-300'
              }`}
            >
              {r === 0 ? t('common.any') : `${r}+`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  // ── Desktop sidebar only ──
  if (desktopOnly) {
    return (
      <div className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-24 rounded-2xl bg-white p-6 shadow-sm">
          {filtersPanel}
        </div>
      </div>
    );
  }

  // ── Mobile trigger + drawer only ──
  if (mobileOnly) {
    return (
      <div className="lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-deliivo-dark shadow-sm hover:border-primary-300 transition-colors"
        >
          <SlidersHorizontal size={14} className="text-primary-500" />
          {t('common.filters')}
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative ml-auto h-full w-80 max-w-full overflow-y-auto bg-white p-6 shadow-xl">
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute right-4 top-4 text-deliivo-gray hover:text-deliivo-dark"
                aria-label={t('common.filters')}
              >
                <X size={20} />
              </button>
              {filtersPanel}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Default: both (legacy use) ──
  return (
    <>
      {/* Mobile trigger */}
      <div className="lg:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-deliivo-dark shadow-sm hover:border-primary-300 transition-colors"
        >
          <SlidersHorizontal size={14} className="text-primary-500" />
          {t('common.filters')}
        </button>

        {mobileOpen && (
          <div className="fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setMobileOpen(false)}
            />
            <div className="relative ml-auto h-full w-80 max-w-full overflow-y-auto bg-white p-6 shadow-xl">
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute right-4 top-4 text-deliivo-gray hover:text-deliivo-dark"
                aria-label={t('common.filters')}
              >
                <X size={20} />
              </button>
              {filtersPanel}
            </div>
          </div>
        )}
      </div>

      {/* Desktop sidebar */}
      <div className="hidden lg:block w-64 shrink-0">
        <div className="sticky top-24 rounded-2xl bg-white p-6 shadow-sm">
          {filtersPanel}
        </div>
      </div>
    </>
  );
}
