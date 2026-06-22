'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Search,
  MapPin,
  Calendar,
  Users,
  Car,
  Star,
  Loader2,
  SlidersHorizontal,
  ArrowLeftRight,
  Clock,
  AlertCircle,
  Bell,
  CheckCircle,
  History,
} from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import {
  mapsApi,
  searchRidesApi,
  PlacePrediction,
  SearchRideResult,
  SearchRidesParams,
  RecentSearch,
} from '@/lib/api';
import { useTranslation } from '@/lib/i18n-context';

// ─── Place Input (reusable autocomplete) ──────────────────────────────────────

interface PlaceSelection {
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

function PlaceInput({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: PlaceSelection | null;
  onChange: (place: PlaceSelection | null) => void;
  placeholder: string;
  icon: React.ReactNode;
}) {
  const [query, setQuery] = useState(value?.address || '');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (value?.address && value.address !== query) setQuery(value.address);
  }, [value]);

  function search(input: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (input.length < 2) { setPredictions([]); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await mapsApi.autocomplete(input);
        setPredictions(res.data || []);
        setOpen(true);
      } catch { setPredictions([]); }
      finally { setLoading(false); }
    }, 300);
  }

  async function selectPlace(prediction: PlacePrediction) {
    setOpen(false);
    setQuery(prediction.description);
    try {
      const res = await mapsApi.placeDetails(prediction.placeId);
      onChange({
        placeId: prediction.placeId,
        address: prediction.description,
        lat: res.data.location.lat,
        lng: res.data.location.lng,
      });
    } catch {
      onChange({ placeId: prediction.placeId, address: prediction.description, lat: 0, lng: 0 });
    }
  }

  return (
    <div className="relative flex-1">
      <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center">{icon}</div>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); onChange(null); }}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className="input-field pl-9"
      />
      {loading && <div className="absolute inset-y-0 right-3 flex items-center"><Loader2 className="h-4 w-4 animate-spin text-deliivo-gray" /></div>}
      {open && predictions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-100 bg-white shadow-lg max-h-60 overflow-y-auto">
          {predictions.map((p) => (
            <button key={p.placeId} type="button" onMouseDown={() => selectPlace(p)} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-primary-50 transition-colors">
              <MapPin className="h-4 w-4 shrink-0 text-deliivo-gray" />
              <span className="truncate text-deliivo-dark">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Ride Result Card ─────────────────────────────────────────────────────────

function RideResultCard({ ride }: { ride: SearchRideResult }) {
  const { t } = useTranslation();
  const seatsLeft = ride.availableSeats;
  const driverName = ride.driver?.name || 'Driver';
  const initials = driverName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const vehicleLabel = ride.vehicle ? [ride.vehicle.brand, ride.vehicle.model_name].filter(Boolean).join(' ') : null;
  const price = ride.segment?.segmentFare ?? ride.basePricePerSeat;
  const dateLabel = new Date(ride.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  return (
      <article className="card flex flex-col gap-4 transition-shadow hover:shadow-md sm:flex-row sm:items-start">
        {/* Driver */}
        <div className="flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 sm:w-24 sm:shrink-0 sm:text-center">
          <Link href={`/profile/users/${ride.driverId}`} className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full bg-primary-100 sm:h-14 sm:w-14">
            {ride.driver?.avatarUrl ? (
              <img src={ride.driver.avatarUrl} alt={driverName} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-primary-600">{initials}</div>
            )}
          </Link>
          <div>
            <Link href={`/profile/users/${ride.driverId}`} className="text-sm font-semibold text-deliivo-dark leading-tight hover:text-deliivo-orange">
              {driverName}
            </Link>
            {ride.driver?.rating ? (
              <div className="mt-0.5 flex items-center gap-1 sm:justify-center">
                <Star size={13} className="fill-amber-400 text-amber-400" />
                <span className="text-xs text-deliivo-gray">{ride.driver.rating.toFixed(1)} ({ride.driver.ratingCount || 0})</span>
              </div>
            ) : <p className="mt-0.5 text-xs text-deliivo-gray">{t('ride.noRatings')}</p>}
            <p className="mt-1 text-[11px] text-deliivo-gray">
              {ride.driver?.successfulPublishedRides || 0} driven • {ride.driver?.successfulCompletedRides || 0} ridden
            </p>
            <div className="mt-2 grid grid-cols-1 gap-1 text-center sm:grid-cols-2 sm:w-full">
              <div className="rounded-lg bg-gray-50 px-2 py-1">
                <p className="text-[11px] font-semibold text-deliivo-dark">{ride.driver?.successfulPublishedRides || 0}</p>
                <p className="text-[10px] text-deliivo-gray">{t('ride.driverTrips')}</p>
              </div>
              <div className="rounded-lg bg-gray-50 px-2 py-1">
                <p className="text-[11px] font-semibold text-deliivo-dark">{ride.driver?.successfulCompletedRides || 0}</p>
                <p className="text-[10px] text-deliivo-gray">{t('ride.riderTrips')}</p>
              </div>
            </div>
            <Link href={`/profile/users/${ride.driverId}`} className="mt-1 inline-flex text-[11px] font-semibold text-deliivo-orange hover:underline">
              {t('ride.viewProfile')}
            </Link>
          </div>
        </div>

        {/* Ride details */}
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex items-center gap-2 text-sm text-deliivo-gray">
            <span className="font-semibold text-deliivo-dark">{ride.departureTime}</span>
            <span>&middot;</span>
            <span>{dateLabel}</span>
            {ride.femaleOnly && (
              <span className="ml-1 rounded-full bg-pink-100 px-2 py-0.5 text-xs font-medium text-pink-600">{t('ride.womenOnly')}</span>
            )}
          </div>
          {(ride.noSmoking || ride.noBicycles || ride.childSeatAvailable) && (
            <div className="flex flex-wrap gap-1.5">
              {ride.noSmoking && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-deliivo-orange">{t('ride.noSmoking')}</span>}
              {ride.noBicycles && <span className="rounded-full bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-deliivo-orange">{t('ride.noBicycles')}</span>}
              {ride.childSeatAvailable && <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">{t('ride.childSeat')}</span>}
            </div>
          )}

          {/* Route */}
          <div className="flex items-stretch gap-3">
            <div className="flex flex-col items-center gap-1 pt-1">
              <span className="h-2.5 w-2.5 rounded-full border-2 border-primary-500 bg-white" />
              <span className="w-0.5 flex-1 bg-primary-200" />
              <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
            </div>
            <div className="flex flex-1 flex-col gap-2">
              <p className="text-sm font-medium text-deliivo-dark truncate">{ride.originAddress}</p>
              <p className="text-sm font-medium text-deliivo-dark truncate">{ride.destinationAddress}</p>
            </div>
          </div>

          {/* Vehicle + seats */}
          <div className="flex flex-wrap items-center gap-3 text-xs text-deliivo-gray">
            {vehicleLabel && (
              <span className="flex items-center gap-1">
                <Car size={13} /> {vehicleLabel}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Users size={13} /> {t('ride.seatsLeft', { count: seatsLeft, plural: seatsLeft !== 1 ? 's' : '' })}
            </span>
            {ride.routeDurationSeconds && (
              <span className="flex items-center gap-1">
                <Clock size={13} /> {Math.round(ride.routeDurationSeconds / 60)} min
              </span>
            )}
          </div>
        </div>

        {/* Price */}
        <div className="flex shrink-0 flex-row items-center justify-between gap-3 sm:flex-col sm:items-end sm:justify-start">
          <div className="text-right">
            <p className="text-xl font-bold text-primary-500">{ride.currency} {price.toFixed(2)}</p>
            <p className="text-xs text-deliivo-gray">{t('ride.perSeat')}</p>
          </div>
          <Link href={`/rides/${ride.id}${ride.segmentId ? `?segmentId=${ride.segmentId}` : ''}`} className="btn-primary py-2 px-5 text-sm">{t('ride.view')}</Link>
        </div>
      </article>
  );
}

// ─── Main Search Page ─────────────────────────────────────────────────────────

function SearchPageContent() {
  const { t } = useTranslation();
  const searchParams = useSearchParams();

  const [origin, setOrigin] = useState<PlaceSelection | null>(null);
  const [destination, setDestination] = useState<PlaceSelection | null>(null);
  const [date, setDate] = useState(searchParams.get('date') || '');
  const [seats, setSeats] = useState(() => {
    const parsed = Number(searchParams.get('seats') || '1');
    return Number.isInteger(parsed) && parsed >= 1 && parsed <= 4 ? parsed : 1;
  });
  const [femaleOnly, setFemaleOnly] = useState(false);

  const [results, setResults] = useState<SearchRideResult[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');

  // Filters
  const [showFilters, setShowFilters] = useState(false);
  const [maxPrice, setMaxPrice] = useState<number | ''>('');
  const [sortBy, setSortBy] = useState<'departure' | 'price' | 'distance'>('departure');

  // Recent searches
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const hydratedQueryRef = useRef(false);

  // Ride alert
  const [alertCreating, setAlertCreating] = useState(false);
  const [alertCreated, setAlertCreated] = useState(false);

  useEffect(() => {
    searchRidesApi.getRecent(5).then(res => {
      setRecentSearches(res.data || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (hydratedQueryRef.current) return;
    hydratedQueryRef.current = true;

    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const female = searchParams.get('femaleOnly');
    const querySeats = Number(searchParams.get('seats') || '1');
    const hydratedSeats = Number.isInteger(querySeats) && querySeats >= 1 && querySeats <= 4 ? querySeats : 1;
    setSeats(hydratedSeats);
    if (female === '1' || female === 'true') setFemaleOnly(true);
    if (!from && !to) return;

    async function resolvePlace(input: string | null): Promise<PlaceSelection | null> {
      if (!input) return null;
      try {
        const predictions = await mapsApi.autocomplete(input);
        const first = predictions.data?.[0];
        if (!first) {
          return { placeId: '', address: input, lat: 0, lng: 0 };
        }
        const details = await mapsApi.placeDetails(first.placeId);
        return {
          placeId: first.placeId,
          address: first.description,
          lat: details.data.location.lat,
          lng: details.data.location.lng,
        };
      } catch {
        return { placeId: '', address: input, lat: 0, lng: 0 };
      }
    }

    Promise.all([resolvePlace(from), resolvePlace(to)]).then(async ([resolvedFrom, resolvedTo]) => {
      if (resolvedFrom) setOrigin(resolvedFrom);
      if (resolvedTo) setDestination(resolvedTo);
      if (resolvedFrom?.lat && resolvedTo?.lat && date) {
        setLoading(true);
        setError('');
        setSearched(true);
        try {
          const params: SearchRidesParams = {
            originLat: resolvedFrom.lat,
            originLng: resolvedFrom.lng,
            destinationLat: resolvedTo.lat,
            destinationLng: resolvedTo.lng,
            departureDate: date,
            seatsRequired: hydratedSeats,
            femaleOnly: female === '1' || female === 'true' || undefined,
            sortBy,
            limit: 20,
          };
          const res = await searchRidesApi.search(params);
          setResults(res.data.rides || []);
          setTotal(res.data.pagination?.total || 0);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : t('search.failed'));
          setResults([]);
        } finally {
          setLoading(false);
        }
      }
    });
  }, [searchParams]);

  async function handleCreateAlert() {
    if (!origin || !destination || !date) return;
    setAlertCreating(true);
    try {
      await searchRidesApi.createAlert({
        originLat: origin.lat,
        originLng: origin.lng,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        departureDate: date,
        originAddress: origin.address,
        destinationAddress: destination.address,
      });
      setAlertCreated(true);
    } catch { /* ignore */ }
    finally { setAlertCreating(false); }
  }

  function useRecentSearch(recent: RecentSearch) {
    setOrigin({ placeId: '', address: recent.originAddress, lat: recent.originLat, lng: recent.originLng });
    setDestination({ placeId: '', address: recent.destinationAddress, lat: recent.destinationLat, lng: recent.destinationLng });
  }

  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!origin || !destination || !date) {
      setError(t('search.requiredError'));
      return;
    }

    setLoading(true);
    setError('');
    setSearched(true);

    try {
      const params: SearchRidesParams = {
        originLat: origin.lat,
        originLng: origin.lng,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        departureDate: date,
        seatsRequired: seats,
        femaleOnly: femaleOnly || undefined,
        maxPrice: maxPrice || undefined,
        sortBy,
        limit: 20,
      };
      const res = await searchRidesApi.search(params);
      setResults(res.data.rides || []);
      setTotal(res.data.pagination?.total || 0);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('search.failed');
      setError(message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  function swap() {
    const temp = origin;
    setOrigin(destination);
    setDestination(temp);
  }

  return (
    <div className="flex flex-col min-h-full bg-deliivo-cream">
      <Navbar />

      <main className="flex-1 px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-5xl">
          <Link href="/" className="mb-5 inline-flex items-center gap-1.5 text-sm text-deliivo-gray hover:text-deliivo-dark transition-colors">
            <ArrowLeft size={15} /> {t('common.backHome')}
          </Link>

          {/* Search form */}
          <form onSubmit={handleSearch} className="w-full rounded-2xl bg-white p-6 shadow-xl mb-8">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <PlaceInput
                value={origin}
                onChange={setOrigin}
                placeholder={t('search.fromPlaceholder')}
                icon={<MapPin size={18} className="text-primary-500" />}
              />
              <button type="button" onClick={swap} aria-label={t('search.swap')} className="mx-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 bg-white text-primary-500 hover:bg-primary-50 sm:mx-0">
                <ArrowLeftRight size={16} />
              </button>
              <PlaceInput
                value={destination}
                onChange={setDestination}
                placeholder={t('search.toPlaceholder')}
                icon={<MapPin size={18} className="text-deliivo-gray" />}
              />
              <div className="relative flex-1">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-deliivo-gray" size={18} />
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input-field pl-9" />
              </div>
            </div>

            <div className="mt-4 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-4">
                {/* Seats */}
                <div className="flex items-center gap-2">
                  <Users size={16} className="text-deliivo-gray" />
                  <select value={seats} onChange={(e) => setSeats(Number(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5">
                    {[1,2,3,4].map(n => <option key={n} value={n}>{n} {n > 1 ? t('search.seatsPlural') : t('search.seat')}</option>)}
                  </select>
                </div>
                {/* Women only */}
                <label className="flex cursor-pointer items-center gap-2 select-none">
                  <button type="button" role="switch" aria-checked={femaleOnly} onClick={() => setFemaleOnly(v => !v)}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${femaleOnly ? 'bg-primary-500' : 'bg-gray-200'}`}>
                    <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${femaleOnly ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  <span className="text-sm font-medium text-deliivo-dark">{t('search.womenOnly')}</span>
                </label>
                {/* Filters toggle */}
                <button type="button" onClick={() => setShowFilters(v => !v)} className="flex items-center gap-1 text-sm text-deliivo-gray hover:text-deliivo-orange">
                  <SlidersHorizontal size={14} /> {t('common.filters')}
                </button>
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full px-10 py-3 text-base sm:w-auto disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('search.submit')}
              </button>
            </div>

            {/* Expanded filters */}
            {showFilters && (
              <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap gap-4 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-deliivo-gray">{t('search.maxPrice')}:</label>
                  <input type="number" min={0} value={maxPrice} onChange={(e) => setMaxPrice(e.target.value ? Number(e.target.value) : '')} placeholder={t('common.any')} className="w-20 text-sm border border-gray-200 rounded-lg px-2 py-1.5" />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs font-medium text-deliivo-gray">{t('search.sortBy')}:</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value as 'departure' | 'price' | 'distance')} className="text-sm border border-gray-200 rounded-lg px-2 py-1.5">
                    <option value="departure">{t('search.sortDeparture')}</option>
                    <option value="price">{t('search.sortPrice')}</option>
                    <option value="distance">{t('search.sortDistance')}</option>
                  </select>
                </div>
              </div>
            )}
          </form>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3 mb-6">
              <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Results */}
          {searched && (
            <div>
              <div className="mb-5 flex items-center justify-between">
                <div>
                  <h1 className="text-xl font-bold text-deliivo-dark">
                    {origin?.address?.split(',')[0]} to {destination?.address?.split(',')[0]}
                  </h1>
                  <p className="mt-0.5 text-sm text-deliivo-gray">
                    {loading ? t('common.searching') : t('search.resultsFound', { total, plural: total !== 1 ? 's' : '' })}
                  </p>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
                </div>
              ) : results.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl bg-white py-20 px-6 text-center shadow-sm">
                  <Search size={48} className="text-gray-200 mb-4" />
                  <h2 className="text-lg font-semibold text-deliivo-dark">{t('search.noResultsTitle')}</h2>
                  <p className="mt-2 text-sm text-deliivo-gray max-w-xs">
                    {t('search.noResultsCopy')}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {results.map((ride) => (
                    <RideResultCard key={ride.id + (ride.segmentId || '')} ride={ride} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Ride alert — shown after search with no results */}
          {searched && !loading && results.length === 0 && origin && destination && date && (
            <div className="rounded-2xl bg-white shadow-sm p-5 mb-6">
              {alertCreated ? (
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-green-600 shrink-0" />
                  <p className="text-sm text-green-700 font-medium">{t('search.alertCreated')}</p>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-deliivo-dark">{t('search.noRidesFoundPrompt')}</p>
                    <p className="text-xs text-deliivo-gray mt-0.5">{t('search.alertPrompt')}</p>
                  </div>
                  <button
                    onClick={handleCreateAlert}
                    disabled={alertCreating}
                    className="shrink-0 flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-deliivo-orange/90 disabled:opacity-50 transition-colors"
                  >
                    {alertCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
                    {t('search.setAlert')}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Pre-search state */}
          {!searched && (
            <div className="space-y-6">
              <div className="flex flex-col items-center justify-center rounded-2xl bg-white py-20 px-6 text-center shadow-sm">
                <Search size={48} className="text-gray-200 mb-4" />
                <h2 className="text-lg font-semibold text-deliivo-dark">{t('search.title')}</h2>
                <p className="mt-2 text-sm text-deliivo-gray max-w-xs">
                  {t('search.emptyCopy')}
                </p>
              </div>

              {/* Recent searches */}
              {recentSearches.length > 0 && (
                <div className="rounded-2xl bg-white shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <History className="w-4 h-4 text-deliivo-orange" />
                    <h3 className="text-sm font-semibold text-deliivo-dark">{t('search.recentSearches')}</h3>
                  </div>
                  <div className="flex flex-col gap-2">
                    {recentSearches.map(rs => (
                      <button
                        key={rs.id}
                        type="button"
                        onClick={() => useRecentSearch(rs)}
                        className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-primary-50 transition-colors"
                      >
                        <MapPin className="w-4 h-4 text-deliivo-gray shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-deliivo-dark truncate">
                            {rs.originAddress.split(',')[0]} &rarr; {rs.destinationAddress.split(',')[0]}
                          </p>
                          <p className="text-xs text-deliivo-gray">
                            {new Date(rs.searchedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      <Footer />
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-500" /></div>}>
      <SearchPageContent />
    </Suspense>
  );
}
