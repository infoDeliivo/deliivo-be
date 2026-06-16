'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Calendar, ArrowLeftRight } from 'lucide-react';

export default function SearchForm() {
  const router = useRouter();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [date, setDate] = useState('');
  const [femaleOnly, setFemaleOnly] = useState(false);

  function swap() {
    setFrom(to);
    setTo(from);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (date) params.set('date', date);
    if (femaleOnly) params.set('femaleOnly', '1');
    router.push('/search?' + params.toString());
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="w-full rounded-2xl bg-white p-6 shadow-xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Leaving from */}
        <div className="relative flex-1">
          <MapPin
            className="absolute left-3 top-1/2 -translate-y-1/2 text-primary-500"
            size={18}
          />
          <input
            type="text"
            placeholder="Leaving from, e.g. Tallinn"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="input-field pl-9"
          />
        </div>

        {/* Swap button */}
        <button
          type="button"
          onClick={swap}
          aria-label="Swap from and to"
          className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-primary-500 transition-colors hover:bg-primary-50 sm:mx-0"
        >
          <ArrowLeftRight size={16} />
        </button>

        {/* Going to */}
        <div className="relative flex-1">
          <MapPin
            className="absolute left-3 top-1/2 -translate-y-1/2 text-deliivo-gray"
            size={18}
          />
          <input
            type="text"
            placeholder="Going to, e.g. Riga"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="input-field pl-9"
          />
        </div>

        {/* Date */}
        <div className="relative flex-1">
          <Calendar
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-deliivo-gray"
            size={18}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="input-field pl-9"
          />
        </div>
      </div>

      {/* Second row: women-only toggle + search button */}
      <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        {/* Women-only toggle */}
        <label className="flex cursor-pointer items-center gap-2 select-none">
          <button
            type="button"
            role="switch"
            aria-checked={femaleOnly}
            onClick={() => setFemaleOnly((v) => !v)}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 ${
              femaleOnly ? 'bg-primary-500' : 'bg-gray-200'
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition-transform ${
                femaleOnly ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
          <span className="text-sm font-medium text-deliivo-dark">
            Women only
          </span>
        </label>

        {/* Search button */}
        <button type="submit" className="btn-primary w-full px-10 py-3 text-base sm:w-auto">
          Search rides
        </button>
      </div>
    </form>
  );
}
