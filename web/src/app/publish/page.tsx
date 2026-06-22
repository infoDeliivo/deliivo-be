'use client';

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useTranslation } from "@/lib/i18n-context";
import {
  MapPin,
  Calendar,
  Users,
  DollarSign,
  CheckCircle,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Luggage,
  Clock,
  Loader2,
  Search,
  Route,
  AlertCircle,
  Wallet,
  ExternalLink,
  CigaretteOff,
  Bike,
  Baby,
} from "lucide-react";
import StepIndicator from "@/components/StepIndicator";
import ProtectedRoute from "@/components/ProtectedRoute";
import GoogleMap from "@/components/GoogleMap";
import {
  mapsApi,
  publishRideApi,
  vehicleApi,
  authApi,
  paymentsApi,
  PlacePrediction,
  RouteOption,
  PriceRecommendation,
  LocationInput,
  StopoverSuggestion,
  Vehicle,
  ConnectStatus,
} from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlaceSelection {
  placeId: string;
  address: string;
  lat: number;
  lng: number;
}

interface WizardState {
  // Step 1 — Route
  origin: PlaceSelection | null;
  destination: PlaceSelection | null;
  // Routes computed
  routes: RouteOption[];
  selectedRouteIndex: number | null;
  // Stopovers
  stopovers: LocationInput[];
  // Step 2 — Date / Time
  date: string;
  hour: number;
  minute: number;
  // Step 3 — Seats
  seats: number;
  maxLuggage: number;
  backSeatOnly: boolean;
  femaleOnly: boolean;
  noSmoking: boolean;
  noBicycles: boolean;
  childSeatAvailable: boolean;
  vehicleId: string;
  // Step 4 — Price
  basePricePerSeat: number;
  recommendation: PriceRecommendation | null;
  // Step 5 — Notes
  notes: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6;
const LOCAL_DRAFT_KEY = 'deliivo_publish_wizard_snapshot_v1';

// ─── Helper: calendar grid ────────────────────────────────────────────────────

function buildCalendarDays(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  return cells;
}

// ─── Place Autocomplete Input ─────────────────────────────────────────────────

function PlaceInput({
  value,
  onChange,
  placeholder,
  icon,
}: {
  value: PlaceSelection | null;
  onChange: (place: PlaceSelection) => void;
  placeholder: string;
  icon: React.ReactNode;
}) {
  const [query, setQuery] = useState(value?.address || '');
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (value?.address) setQuery(value.address);
  }, [value]);

  const search = useCallback((input: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (input.length < 2) {
      setPredictions([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await mapsApi.autocomplete(input);
        setPredictions(res.data || []);
        setOpen(true);
      } catch {
        setPredictions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }, []);

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
      // Fallback: use description without coords (will fail later)
      onChange({
        placeId: prediction.placeId,
        address: prediction.description,
        lat: 0,
        lng: 0,
      });
    }
  }

  return (
    <div className="relative">
      <div className="pointer-events-none absolute inset-y-0 left-4 flex items-center">
        {icon}
      </div>
      <input
        type="text"
        value={query}
        onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
        onFocus={() => predictions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder={placeholder}
        className="input-field pl-10"
      />
      {loading && (
        <div className="absolute inset-y-0 right-4 flex items-center">
          <Loader2 className="h-4 w-4 animate-spin text-deliivo-gray" />
        </div>
      )}
      {open && predictions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-xl border border-gray-100 bg-white shadow-lg max-h-60 overflow-y-auto">
          {predictions.map((p) => (
            <button
              key={p.placeId}
              type="button"
              onMouseDown={() => selectPlace(p)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-primary-50 transition-colors"
            >
              <Search className="h-4 w-4 shrink-0 text-deliivo-gray" />
              <span className="truncate text-deliivo-dark">{p.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 1: Route ────────────────────────────────────────────────────────────

function StepRoute({
  state,
  onChange,
  error,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  error: string;
}) {
  const { t, locale } = useTranslation();
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-deliivo-dark">{t('publish.whatsYourRoute')}</h2>
        <p className="mt-1 text-sm text-deliivo-gray">{t('publish.searchDepartureDestination')}</p>
      </div>

      {/* Map visualization */}
      {state.routes.length > 0 && state.selectedRouteIndex !== null && state.routes[state.selectedRouteIndex]?.polyline ? (
        <GoogleMap
          polyline={state.routes[state.selectedRouteIndex].polyline}
          markers={[
            ...(state.origin ? [{ lat: state.origin.lat, lng: state.origin.lng, color: 'green' as const }] : []),
            ...(state.destination ? [{ lat: state.destination.lat, lng: state.destination.lng, color: 'red' as const }] : []),
            ...state.stopovers.map(s => ({ lat: s.lat, lng: s.lng, color: 'blue' as const })),
          ]}
          className="h-56 w-full rounded-2xl"
        />
      ) : (
        <div className="relative h-44 w-full overflow-hidden rounded-2xl bg-gradient-to-br from-primary-50 to-deliivo-orange-light flex items-center justify-center border border-primary-100">
          <div className="flex flex-col items-center gap-2 text-primary-400">
            <MapPin className="h-8 w-8 opacity-60" />
            <span className="text-xs font-medium">{t('publish.mapPreview')}</span>
          </div>
        </div>
      )}

      {/* Location inputs */}
      <div className="space-y-3">
        <PlaceInput
          value={state.origin}
          onChange={(place) => onChange({ origin: place })}
          placeholder={t('publish.leavingFrom')}
          icon={<div className="h-2.5 w-2.5 rounded-full bg-deliivo-orange" />}
        />

        <div className="flex items-center px-4">
          <div className="ml-[7px] h-4 w-0.5 bg-gray-200" />
        </div>

        <PlaceInput
          value={state.destination}
          onChange={(place) => onChange({ destination: place })}
          placeholder={t('publish.goingTo')}
          icon={<MapPin className="h-4 w-4 text-deliivo-orange-dark" />}
        />
      </div>

      {/* Route options (shown after both places selected) */}
      {state.routes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
            {t('publish.selectRoute')}
          </p>
          {state.routes.map((route) => (
            <button
              key={route.index}
              type="button"
              onClick={() => onChange({ selectedRouteIndex: route.index })}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-all ${
                state.selectedRouteIndex === route.index
                  ? 'border-deliivo-orange bg-deliivo-orange-light'
                  : 'border-gray-100 bg-white hover:border-primary-200'
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-deliivo-dark">
                  {t('publish.routeNumber', { index: route.index + 1 })}
                </p>
                <p className="text-xs text-deliivo-gray">
                  {route.distanceText} &middot; {route.durationText}
                </p>
              </div>
              {state.selectedRouteIndex === route.index && (
                <CheckCircle className="h-5 w-5 text-deliivo-orange" />
              )}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Stopovers ───────────────────────────────────────────────────────

function StepStopovers({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const { t, locale } = useTranslation();
  const [suggestions, setSuggestions] = useState<StopoverSuggestion[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!loaded) {
      setLoadingSuggestions(true);
      publishRideApi.getStopoverSuggestions()
        .then(res => { setSuggestions(res.data.suggestions || []); })
        .catch(() => {})
        .finally(() => { setLoadingSuggestions(false); setLoaded(true); });
    }
  }, [loaded]);

  const selectedPolyline = state.selectedRouteIndex !== null ? state.routes[state.selectedRouteIndex]?.polyline : undefined;

  function toggleStopover(suggestion: StopoverSuggestion) {
    const exists = state.stopovers.find(s => s.placeId === suggestion.placeId);
    if (exists) {
      onChange({ stopovers: state.stopovers.filter(s => s.placeId !== suggestion.placeId) });
    } else {
      onChange({ stopovers: [...state.stopovers, { placeId: suggestion.placeId, address: suggestion.address, lat: suggestion.lat, lng: suggestion.lng }] });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-deliivo-dark">{t('publish.addStopovers')}</h2>
        <p className="mt-1 text-sm text-deliivo-gray">{t('publish.stopoversCopy')}</p>
      </div>

      {/* Map with route + stopovers */}
      {selectedPolyline && (
        <GoogleMap
          polyline={selectedPolyline}
          markers={[
            ...(state.origin ? [{ lat: state.origin.lat, lng: state.origin.lng, color: 'green' as const }] : []),
            ...(state.destination ? [{ lat: state.destination.lat, lng: state.destination.lng, color: 'red' as const }] : []),
            ...state.stopovers.map(s => ({ lat: s.lat, lng: s.lng, color: 'blue' as const })),
          ]}
          className="h-48 w-full rounded-2xl"
        />
      )}

      {loadingSuggestions ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-deliivo-orange" />
          <span className="ml-2 text-sm text-deliivo-gray">{t('publish.findingPlaces')}</span>
        </div>
      ) : suggestions.length === 0 ? (
        <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
          <MapPin className="h-8 w-8 text-gray-200 mx-auto mb-2" />
          <p className="text-sm text-deliivo-gray">{t('publish.noStopovers')}</p>
          <p className="text-xs text-deliivo-gray mt-1">{t('publish.skipStep')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
            {t('publish.suggestedStops', { count: suggestions.length })}
          </p>
          {suggestions.map(s => {
            const selected = state.stopovers.some(st => st.placeId === s.placeId);
            return (
              <button
                key={s.placeId}
                type="button"
                onClick={() => toggleStopover(s)}
                className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${
                  selected ? 'border-deliivo-orange bg-deliivo-orange-light' : 'border-gray-100 bg-white hover:border-primary-200'
                }`}
              >
                <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${selected ? 'bg-deliivo-orange text-white' : 'bg-gray-100 text-deliivo-gray'}`}>
                  <MapPin className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-deliivo-dark truncate">{s.name}</p>
                  <p className="text-xs text-deliivo-gray truncate">{s.address}</p>
                  <p className="text-xs text-deliivo-gray">{s.distanceFromOriginKm.toFixed(1)} km from origin</p>
                </div>
                {selected && <CheckCircle className="h-5 w-5 text-deliivo-orange shrink-0" />}
              </button>
            );
          })}
        </div>
      )}

      {state.stopovers.length > 0 && (
        <div className="rounded-2xl border border-primary-100 bg-primary-50 p-4">
          <p className="text-xs font-semibold text-deliivo-dark mb-2">{t('publish.selectedStopovers', { count: state.stopovers.length })}</p>
          {state.stopovers.map((s, i) => (
            <div key={s.placeId} className="flex items-center gap-2 text-sm text-deliivo-dark">
              <span className="text-xs font-bold text-deliivo-orange">{i + 1}.</span>
              <span className="truncate">{s.address}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Step 3: Date & Time ──────────────────────────────────────────────────────

function StepDateTime({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const { t, locale } = useTranslation();
  const today = new Date();
  const [viewYear, setViewYear] = useState(
    state.date ? parseInt(state.date.split("-")[0]) : today.getFullYear()
  );
  const [viewMonth, setViewMonth] = useState(
    state.date ? parseInt(state.date.split("-")[1]) - 1 : today.getMonth()
  );

  const calDays = buildCalendarDays(viewYear, viewMonth);

  const selectedDate = state.date ? new Date(state.date + "T00:00:00") : null;

  function selectDay(day: number | null) {
    if (!day) return;
    const d = new Date(viewYear, viewMonth, day);
    if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) return;
    onChange({
      date: `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    });
  }

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1); }
    else setViewMonth(m => m - 1);
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1); }
    else setViewMonth(m => m + 1);
  }

  const todayNum = today.getDate();
  const todayMonth = today.getMonth();
  const todayYear = today.getFullYear();

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 15, 30, 45];
  const monthLabel = new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(viewYear, viewMonth, 1));
  const dayFormatter = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const dayLabels = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(2024, 0, 7 + index);
    return dayFormatter.format(date);
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-deliivo-dark">{t('publish.selectTravelDate')}</h2>
        <p className="mt-1 text-sm text-deliivo-gray">{t('publish.pickDateTime')}</p>
      </div>

      {/* Calendar */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <button type="button" onClick={prevMonth} className="flex h-8 w-8 items-center justify-center rounded-full text-deliivo-gray hover:bg-primary-50 hover:text-deliivo-orange transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-deliivo-dark">{monthLabel} {viewYear}</span>
          <button type="button" onClick={nextMonth} className="flex h-8 w-8 items-center justify-center rounded-full text-deliivo-gray hover:bg-primary-50 hover:text-deliivo-orange transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-1 grid grid-cols-7 text-center">
          {dayLabels.map((d) => (
            <div key={d} className="py-1 text-[11px] font-semibold uppercase tracking-wide text-deliivo-gray">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-1 text-center">
          {calDays.map((day, idx) => {
            if (!day) return <div key={`empty-${idx}`} />;
            const cellDate = new Date(viewYear, viewMonth, day);
            const isPast = cellDate < new Date(todayYear, todayMonth, todayNum);
            const isToday = day === todayNum && viewMonth === todayMonth && viewYear === todayYear;
            const isSelected = selectedDate && day === selectedDate.getDate() && viewMonth === selectedDate.getMonth() && viewYear === selectedDate.getFullYear();

            return (
              <button
                key={day}
                type="button"
                disabled={isPast}
                onClick={() => selectDay(day)}
                className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-all duration-150 ${
                  isSelected ? "bg-deliivo-orange text-white shadow-sm shadow-deliivo-orange/30"
                    : isToday ? "border border-deliivo-orange text-deliivo-orange"
                    : isPast ? "cursor-not-allowed text-gray-300"
                    : "text-deliivo-dark hover:bg-primary-50 hover:text-deliivo-orange"
                }`}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {/* Time picker */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-deliivo-dark">
          <Clock className="h-4 w-4 text-deliivo-orange" />
          {t('publish.departureTime')}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('publish.hour')}</label>
            <select value={state.hour} onChange={(e) => onChange({ hour: parseInt(e.target.value) })} className="input-field pr-8">
              {hours.map((h) => (<option key={h} value={h}>{String(h).padStart(2, "0")}</option>))}
            </select>
          </div>
          <span className="mt-5 text-xl font-bold text-deliivo-dark">:</span>
          <div className="flex-1">
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('publish.minute')}</label>
            <select value={state.minute} onChange={(e) => onChange({ minute: parseInt(e.target.value) })} className="input-field pr-8">
              {minutes.map((m) => (<option key={m} value={m}>{String(m).padStart(2, "0")}</option>))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Seats & Preferences ──────────────────────────────────────────────

function StepSeats({
  state,
  onChange,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
}) {
  const { t, locale } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);

  useEffect(() => {
    vehicleApi.list()
      .then(res => { setVehicles(res.data?.vehicles || []); })
      .catch(() => {})
      .finally(() => setVehiclesLoading(false));
  }, []);
  function counter(label: string, value: number, min: number, max: number, onInc: () => void, onDec: () => void, sublabel?: string) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-deliivo-dark">{label}</p>
          {sublabel && <p className="text-xs text-deliivo-gray">{sublabel}</p>}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" disabled={value <= min} onClick={onDec} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 text-deliivo-gray transition-colors hover:border-deliivo-orange hover:text-deliivo-orange disabled:opacity-30 disabled:cursor-not-allowed">
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="w-5 text-center text-base font-bold text-deliivo-dark">{value}</span>
          <button type="button" disabled={value >= max} onClick={onInc} className="flex h-8 w-8 items-center justify-center rounded-full border border-deliivo-orange bg-deliivo-orange-light text-deliivo-orange transition-colors hover:bg-deliivo-orange hover:text-white disabled:opacity-30 disabled:cursor-not-allowed">
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  function toggle(label: string, checked: boolean, onToggle: () => void, sublabel?: string) {
    return (
      <button type="button" onClick={onToggle} className={`flex w-full items-center justify-between rounded-2xl border px-4 py-4 shadow-sm text-left transition-all duration-150 ${checked ? "border-deliivo-orange bg-deliivo-orange-light" : "border-gray-100 bg-white"}`}>
        <div>
          <p className="text-sm font-semibold text-deliivo-dark">{label}</p>
          {sublabel && <p className="text-xs text-deliivo-gray">{sublabel}</p>}
        </div>
        <div className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${checked ? "bg-deliivo-orange" : "bg-gray-200"}`}>
          <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`} />
        </div>
      </button>
    );
  }

  const luggageLabels = [
    t('publish.luggageNone'),
    t('publish.luggageSmall'),
    t('publish.luggageMedium'),
    t('publish.luggageLarge'),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-deliivo-dark">{t('publish.offerSeats')}</h2>
        <p className="mt-1 text-sm text-deliivo-gray">{t('publish.configureSeats')}</p>
      </div>

      <div className="space-y-3">
        {counter(t('publish.passengers'), state.seats, 1, 8, () => onChange({ seats: state.seats + 1 }), () => onChange({ seats: state.seats - 1 }), t('publish.seatsAvailableForRiders'))}
        {counter(t('publish.maxLuggage'), state.maxLuggage, 0, 3, () => onChange({ maxLuggage: state.maxLuggage + 1 }), () => onChange({ maxLuggage: state.maxLuggage - 1 }), luggageLabels[state.maxLuggage])}
      </div>

      {/* Vehicle display */}
      {vehiclesLoading ? (
        <div className="flex items-center gap-2 text-sm text-deliivo-gray"><Loader2 className="h-4 w-4 animate-spin" /> {t('publish.loadingVehicles')}</div>
      ) : vehicles.length > 0 ? (
        <div>
          <p className="text-sm font-semibold text-deliivo-dark mb-2">{t('publish.yourVehicle')}</p>
          <div className="flex items-center gap-3 rounded-2xl border border-deliivo-orange bg-deliivo-orange-light px-4 py-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              {vehicles[0].imageUrl ? <img src={vehicles[0].imageUrl} alt="" className="w-10 h-10 rounded-xl object-cover" /> : <Luggage className="w-5 h-5 text-gray-400" />}
            </div>
            <div>
              <p className="text-sm font-medium text-deliivo-dark">{[vehicles[0].brand, vehicles[0].model_name].filter(Boolean).join(' ') || t('publish.vehicleFallback')}</p>
              <p className="text-xs text-deliivo-gray">{[vehicles[0].color, vehicles[0].year].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-xs text-yellow-700">{t('publish.noVehicleFound')} <a href="/profile/vehicle" className="font-semibold underline">{t('publish.addOne')}</a> {t('publish.forBetterVisibility')}</p>
        </div>
      )}

      <div className="space-y-3">
        {toggle(t('publish.womenOnly'), state.femaleOnly, () => onChange({ femaleOnly: !state.femaleOnly }), t('publish.womenOnlyCopy'))}
        {toggle(t('publish.noSmoking'), state.noSmoking, () => onChange({ noSmoking: !state.noSmoking }), t('publish.noSmokingCopy'))}
        {toggle(t('publish.noBicycles'), state.noBicycles, () => onChange({ noBicycles: !state.noBicycles }), t('publish.noBicyclesCopy'))}
        {toggle(t('publish.childSeatAvailable'), state.childSeatAvailable, () => onChange({ childSeatAvailable: !state.childSeatAvailable }), t('publish.childSeatAvailableCopy'))}
      </div>
    </div>
  );
}

// ─── Step 4: Price ────────────────────────────────────────────────────────────

function StepPrice({
  state,
  onChange,
  loading,
}: {
  state: WizardState;
  onChange: (patch: Partial<WizardState>) => void;
  loading: boolean;
}) {
  const { t, locale } = useTranslation();
  const rec = state.recommendation;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-deliivo-dark">{t('publish.setPricePerSeat')}</h2>
        <p className="mt-1 text-sm text-deliivo-gray">{t('publish.fairPrice')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-deliivo-orange" />
          <span className="ml-2 text-sm text-deliivo-gray">{t('publish.calculatingRecommendedPrice')}</span>
        </div>
      ) : rec ? (
        <div className="rounded-2xl bg-primary-50 border border-primary-100 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-deliivo-orange" />
            <span className="text-sm font-semibold text-deliivo-dark">{t('publish.recommended', { currency: rec.currency, price: rec.recommendedPrice.toFixed(2) })}</span>
          </div>
          <p className="text-xs text-deliivo-gray">
            {t('publish.basedOnDistance', { distance: rec.breakdown.distanceKm.toFixed(1), currency: rec.currency, minPrice: rec.minPrice.toFixed(2), maxPrice: rec.maxPrice.toFixed(2) })}
          </p>
        </div>
      ) : null}

      {/* Price input */}
      <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
        <label className="mb-2 block text-sm font-semibold text-deliivo-dark">{t('publish.pricePerSeat', { currency: rec?.currency || 'EUR' })}</label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onChange({ basePricePerSeat: Math.max(1, state.basePricePerSeat - 1) })}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 text-deliivo-gray hover:border-deliivo-orange hover:text-deliivo-orange"
          >
            <Minus className="h-4 w-4" />
          </button>
          <input
            type="number"
            min={0}
            step={0.5}
            value={state.basePricePerSeat}
            onChange={(e) => onChange({ basePricePerSeat: parseFloat(e.target.value) || 0 })}
            className="w-28 rounded-xl border border-gray-200 bg-deliivo-orange-light px-4 py-2.5 text-center text-lg font-bold text-deliivo-orange focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
          />
          <button
            type="button"
            onClick={() => onChange({ basePricePerSeat: state.basePricePerSeat + 1 })}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-deliivo-orange bg-deliivo-orange-light text-deliivo-orange hover:bg-deliivo-orange hover:text-white"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <label className="mb-2 block text-sm font-semibold text-deliivo-dark">{t('publish.notesOptional')}</label>
        <textarea
          value={state.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder={t('publish.anySpecialInstructions')}
          maxLength={150}
          rows={3}
          className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-deliivo-dark placeholder:text-deliivo-gray focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20 resize-none"
        />
        <p className="mt-1 text-xs text-deliivo-gray text-right">{state.notes.length}/150</p>
      </div>
    </div>
  );
}

// ─── Step 5: Confirm ──────────────────────────────────────────────────────────

function StepConfirm({
  state,
  onPublish,
  publishing,
  error,
  payoutStatus,
  payoutLoading,
  onStartPayoutSetup,
  payoutSetupLoading,
}: {
  state: WizardState;
  onPublish: (tosAccepted: boolean) => void;
  publishing: boolean;
  error: string;
  payoutStatus: ConnectStatus | null;
  payoutLoading: boolean;
  onStartPayoutSetup: () => void;
  payoutSetupLoading: boolean;
}) {
  const { t, locale } = useTranslation();
  const [tosChecked, setTosChecked] = useState(false);
  const payoutsReady = Boolean(payoutStatus?.onboardingComplete && payoutStatus?.payoutsEnabled);
  const dateLabel = state.date
    ? new Date(state.date + "T00:00:00").toLocaleDateString(locale, { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : t('publish.notSet');
  const timeLabel = `${String(state.hour).padStart(2, "0")}:${String(state.minute).padStart(2, "0")}`;
  const routeInfo = state.selectedRouteIndex !== null && state.routes[state.selectedRouteIndex]
    ? `${state.routes[state.selectedRouteIndex].distanceText} · ${state.routes[state.selectedRouteIndex].durationText}`
    : '';

  const rows: { icon: React.ReactNode; label: string; value: string }[] = [
    { icon: <MapPin className="h-4 w-4 text-deliivo-orange" />, label: t('publish.from'), value: state.origin?.address || "—" },
    { icon: <MapPin className="h-4 w-4 text-deliivo-orange-dark" />, label: t('publish.to'), value: state.destination?.address || "—" },
    { icon: <Route className="h-4 w-4 text-deliivo-orange" />, label: t('publish.route'), value: routeInfo || "—" },
    { icon: <Calendar className="h-4 w-4 text-deliivo-orange" />, label: t('publish.date'), value: dateLabel },
    { icon: <Clock className="h-4 w-4 text-deliivo-orange" />, label: t('publish.time'), value: timeLabel },
    { icon: <Users className="h-4 w-4 text-deliivo-orange" />, label: t('publish.seats'), value: `${state.seats} ${t('publish.passengerWord', { count: state.seats })}` },
    { icon: <Luggage className="h-4 w-4 text-deliivo-orange" />, label: t('publish.luggage'), value: t('publish.maxLuggageValue', { max: state.maxLuggage }) },
    { icon: <DollarSign className="h-4 w-4 text-deliivo-orange" />, label: t('publish.pricePerSeatLabel'), value: state.basePricePerSeat > 0 ? `${state.recommendation?.currency || 'EUR'} ${state.basePricePerSeat.toFixed(2)}` : t('publish.free') },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-deliivo-dark">{t('publish.reviewYourRide')}</h2>
        <p className="mt-1 text-sm text-deliivo-gray">{t('publish.allGoodPublish')}</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
        <div className="bg-gradient-to-r from-deliivo-orange to-primary-600 px-5 py-4">
          <p className="text-sm font-semibold text-white/80">{t('publish.yourRideSummary')}</p>
          <p className="text-lg font-bold text-white mt-0.5">
            {state.origin?.address?.split(',')[0] || t('publish.origin')} → {state.destination?.address?.split(',')[0] || t('publish.destination')}
          </p>
        </div>

        <ul className="divide-y divide-gray-50">
          {rows.map(({ icon, label, value }) => (
            <li key={label} className="flex items-center gap-3 px-5 py-3">
              <span className="shrink-0">{icon}</span>
              <span className="w-20 shrink-0 text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{label}</span>
              <span className="text-sm font-medium text-deliivo-dark truncate">{value}</span>
            </li>
          ))}
        </ul>

        {(state.femaleOnly || state.noSmoking || state.noBicycles || state.childSeatAvailable) && (
          <div className="flex flex-wrap gap-2 px-5 py-3 border-t border-gray-50">
            {state.femaleOnly && (
              <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-600">
                <CheckCircle className="h-3 w-3" /> {t('publish.womenOnly')}
              </span>
            )}
            {state.noSmoking && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-deliivo-orange">
                <CigaretteOff className="h-3 w-3" /> {t('publish.noSmoking')}
              </span>
            )}
            {state.noBicycles && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-deliivo-orange">
                <Bike className="h-3 w-3" /> {t('publish.noBicycles')}
              </span>
            )}
            {state.childSeatAvailable && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
                <Baby className="h-3 w-3" /> {t('publish.childSeat')}
              </span>
            )}
          </div>
        )}

        {state.notes && (
          <div className="px-5 py-3 border-t border-gray-50">
            <p className="text-xs font-semibold uppercase tracking-wide text-deliivo-gray mb-1">{t('publish.notes')}</p>
            <p className="text-sm text-deliivo-dark">{state.notes}</p>
          </div>
        )}
      </div>

      {/* Terms & Conditions checkbox */}
      <label className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-4 shadow-sm cursor-pointer">
        <input
          type="checkbox"
          checked={tosChecked}
          onChange={(e) => setTosChecked(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-gray-300 text-deliivo-orange focus:ring-deliivo-orange"
        />
        <span className="text-sm text-deliivo-dark">
          {t('publish.agreeTermsPrefix')}{' '}
          <a href="/terms" target="_blank" className="font-semibold text-deliivo-orange underline hover:text-deliivo-orange-dark">
            {t('publish.termsOfService')}
          </a>{' '}
          {t('publish.and')}{' '}
          <a href="/privacy" target="_blank" className="font-semibold text-deliivo-orange underline hover:text-deliivo-orange-dark">
            {t('publish.privacyPolicy')}
          </a>
        </span>
      </label>

      <div className={`rounded-2xl border px-4 py-4 shadow-sm ${
        payoutsReady ? 'border-green-100 bg-green-50' : 'border-amber-200 bg-amber-50'
      }`}>
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            payoutsReady ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            <Wallet className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className={`text-sm font-semibold ${payoutsReady ? 'text-green-900' : 'text-amber-900'}`}>
              {payoutsReady ? t('publish.payoutDetailsReady') : t('publish.payoutDetailsRequired')}
            </p>
            <p className={`mt-1 text-xs ${payoutsReady ? 'text-green-800' : 'text-amber-800'}`}>
              {payoutsReady ? t('publish.stripePayoutReadyCopy') : t('publish.payoutRequiredCopy')}
            </p>
            {!payoutsReady && (
              <button
                type="button"
                onClick={onStartPayoutSetup}
                disabled={payoutLoading || payoutSetupLoading}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2 text-sm font-semibold text-white hover:bg-deliivo-orange-dark disabled:opacity-50"
              >
                {payoutSetupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                {payoutSetupLoading ? t('publish.redirecting') : t('publish.setUpPayouts')}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <button
        type="button"
        onClick={() => onPublish(tosChecked)}
        disabled={publishing || !tosChecked || !payoutsReady}
        className="btn-primary w-full gap-2 py-4 text-base disabled:opacity-60"
      >
        {publishing ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
        {publishing ? t('publish.publishing') : t('publish.publishRide')}
      </button>

      <p className="text-center text-xs text-deliivo-gray leading-relaxed">
        {t('publish.oncePublished')}
      </p>
    </div>
  );
}

// ─── Main wizard ──────────────────────────────────────────────────────────────

const INITIAL_STATE: WizardState = {
  origin: null,
  destination: null,
  routes: [],
  selectedRouteIndex: null,
  stopovers: [],
  date: "",
  hour: 8,
  minute: 0,
  seats: 2,
  maxLuggage: 2,
  backSeatOnly: false,
  femaleOnly: false,
  noSmoking: true,
  noBicycles: false,
  childSeatAvailable: false,
  vehicleId: '',
  basePricePerSeat: 0,
  recommendation: null,
  notes: "",
};

function PublishRideWizard() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [published, setPublished] = useState(false);
  const [recoveredDraft, setRecoveredDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payoutStatus, setPayoutStatus] = useState<ConnectStatus | null>(null);
  const [payoutStatusLoading, setPayoutStatusLoading] = useState(false);
  const [payoutSetupLoading, setPayoutSetupLoading] = useState(false);

  function patch(update: Partial<WizardState>) {
    setState((prev) => ({ ...prev, ...update }));
    setError('');
  }

  useEffect(() => {
    loadPayoutStatus();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw) as { step?: number; state?: WizardState };
      if (snapshot.state) {
        setState({
          ...INITIAL_STATE,
          ...snapshot.state,
          routes: snapshot.state.routes || [],
          stopovers: snapshot.state.stopovers || [],
        });
      }
      if (snapshot.step && snapshot.step >= 1 && snapshot.step <= TOTAL_STEPS) {
        setStep(snapshot.step);
      }
      setRecoveredDraft(true);
    } catch {
      window.localStorage.removeItem(LOCAL_DRAFT_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || published) return;
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({ step, state }));
  }, [step, state, published]);

  useEffect(() => {
    if (typeof window === 'undefined' || !published) return;
    window.localStorage.removeItem(LOCAL_DRAFT_KEY);
  }, [published]);

  async function loadPayoutStatus() {
    setPayoutStatusLoading(true);
    try {
      const res = await paymentsApi.connectStatus();
      setPayoutStatus(res.data);
    } catch {
      setPayoutStatus(null);
    } finally {
      setPayoutStatusLoading(false);
    }
  }

  async function handleStartPayoutSetup() {
    setPayoutSetupLoading(true);
    setError('');
    try {
      const res = await paymentsApi.connectOnboard();
      window.location.href = res.data.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start payout setup');
      setPayoutSetupLoading(false);
    }
  }

  function canContinue(): boolean {
    if (step === 1) return state.origin !== null && state.destination !== null && state.selectedRouteIndex !== null;
    if (step === 2) return true; // stopovers are optional
    if (step === 3) return state.date.length > 0;
    if (step === 4) return state.seats >= 1;
    if (step === 5) return state.basePricePerSeat > 0;
    return true;
  }

  // Step 1: After selecting both origin and destination, auto-compute routes
  // Also re-compute if origin or destination changes
  useEffect(() => {
    if (state.origin && state.destination) {
      handleComputeRoutes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.origin?.placeId, state.destination?.placeId]);

  async function handleComputeRoutes() {
    if (!state.origin || !state.destination) return;
    setLoading(true);
    setError('');
    // Clear previous routes so map updates
    setState(prev => ({ ...prev, routes: [], selectedRouteIndex: null }));
    try {
      // Step 1: Create draft with origin
      await publishRideApi.createWithOrigin({
        originPlaceId: state.origin.placeId,
        originAddress: state.origin.address,
        originLat: state.origin.lat,
        originLng: state.origin.lng,
      });

      // Step 2: Set destination
      await publishRideApi.updateDestination({
        destinationPlaceId: state.destination.placeId,
        destinationAddress: state.destination.address,
        destinationLat: state.destination.lat,
        destinationLng: state.destination.lng,
      });

      // Step 3: Compute routes
      const res = await publishRideApi.computeRoutes();
      const routes = res.data.routes || [];
      setState(prev => ({
        ...prev,
        routes,
        selectedRouteIndex: routes.length > 0 ? 0 : null,
      }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to compute routes';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    if (step >= TOTAL_STEPS) return;
    setLoading(true);
    setError('');

    try {
      if (step === 1) {
        // Select route on backend
        if (state.selectedRouteIndex !== null) {
          await publishRideApi.selectRoute(state.selectedRouteIndex);
        }
      } else if (step === 2) {
        // Save stopovers to backend (even if empty — clears previous)
        if (state.stopovers.length > 0) {
          await publishRideApi.updateStopovers(state.stopovers);
        }
      } else if (step === 3) {
        // Save schedule to backend
        const departureTime = `${String(state.hour).padStart(2, "0")}:${String(state.minute).padStart(2, "0")}`;
        await publishRideApi.updateSchedule(state.date, departureTime);
      } else if (step === 4) {
        // Save capacity to backend
        await publishRideApi.updateCapacity(state.seats, state.maxLuggage, false, {
          noSmoking: state.noSmoking,
          noBicycles: state.noBicycles,
          childSeatAvailable: state.childSeatAvailable,
        });
        // Fetch recommended price
        try {
          const priceRes = await publishRideApi.getRecommendedPrice();
          const rec = priceRes.data;
          setState(prev => ({
            ...prev,
            recommendation: rec,
            basePricePerSeat: prev.basePricePerSeat || rec.recommendedPrice,
          }));
        } catch {
          // Price recommendation is optional; user can still set manually
        }
      }

      setStep((s) => s + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Something went wrong';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  function handleBack() {
    if (step > 1) setStep((s) => s - 1);
    setError('');
  }

  async function handlePublish(tosAccepted: boolean) {
    setLoading(true);
    setError('');
    try {
      const latestPayoutStatus = payoutStatus ?? (await paymentsApi.connectStatus()).data;
      setPayoutStatus(latestPayoutStatus);
      if (!latestPayoutStatus.onboardingComplete || !latestPayoutStatus.payoutsEnabled) {
        throw new Error('Payout details are required before publishing a ride.');
      }

      // Accept Terms of Service
      if (tosAccepted) {
        await authApi.acceptTos('1.0', '1.0');
      }

      // Save pricing
      await publishRideApi.updatePricing(state.basePricePerSeat);

      // Save notes if any
      if (state.notes || state.femaleOnly) {
        await publishRideApi.updateNotes(state.notes || ' ', state.femaleOnly || undefined);
      }

      // Publish
      await publishRideApi.publish();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(LOCAL_DRAFT_KEY);
      }
      setPublished(true);
    } catch (err: unknown) {
      let message = err instanceof Error ? err.message : 'Failed to publish ride';
      if (message.includes('TOS_NOT_ACCEPTED')) message = 'Please accept the Terms of Service to continue.';
      if (message.includes('DRIVER_NOT_VERIFIED')) message = 'Your driving license must be verified before publishing a ride.';
      if (message.includes('NO_STRIPE_ACCOUNT') || message.includes('PAYOUT')) message = 'Set up your payout details before publishing a ride.';
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  // ── Published success screen ──
  if (published) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deliivo-cream px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-deliivo-orange shadow-xl shadow-deliivo-orange/30">
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-deliivo-dark">{t('publish.publishedTitle')}</h1>
          <p className="mb-8 text-deliivo-gray">{t('publish.publishedCopy')}</p>
          <div className="flex flex-col gap-3">
            <Link href="/rides" className="btn-primary w-full py-3 text-base">{t('publish.viewMyRides')}</Link>
            <button
              type="button"
              onClick={() => { setState(INITIAL_STATE); setStep(1); setPublished(false); setRecoveredDraft(false); setError(''); }}
              className="btn-outline w-full py-3 text-base"
            >
              {t('publish.publishAnotherRide')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-deliivo-cream">
      {/* Top bar */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          {step === 1 ? (
            <Link href="/" className="flex items-center gap-1.5 text-sm font-medium text-deliivo-gray hover:text-deliivo-dark transition-colors">
              <ArrowLeft className="h-4 w-4" /> {t('publish.back')}
            </Link>
          ) : (
            <button type="button" onClick={handleBack} className="flex items-center gap-1.5 text-sm font-medium text-deliivo-gray hover:text-deliivo-dark transition-colors">
              <ArrowLeft className="h-4 w-4" /> {t('publish.back')}
            </button>
          )}
          <span className="text-sm font-semibold text-deliivo-dark">{t('publish.title')}</span>
          <div className="w-16" />
        </div>
      </div>

      {/* Step indicator */}
      <div className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="mx-auto max-w-lg">
          <StepIndicator steps={TOTAL_STEPS} current={step} labels={[t('publish.route'), t('publish.stops'), t('publish.date'), t('publish.seats'), t('publish.price'), t('publish.confirm')]} />
        </div>
      </div>

      {/* Step icons row */}
      <div className="bg-white border-b border-gray-100 px-4 pb-3">
        <div className="mx-auto flex max-w-lg justify-center gap-6">
          {[
            { icon: <MapPin className="h-4 w-4" />, label: t('publish.route') },
            { icon: <Route className="h-4 w-4" />, label: t('publish.stops') },
            { icon: <Calendar className="h-4 w-4" />, label: t('publish.date') },
            { icon: <Users className="h-4 w-4" />, label: t('publish.seats') },
            { icon: <DollarSign className="h-4 w-4" />, label: t('publish.price') },
            { icon: <CheckCircle className="h-4 w-4" />, label: t('publish.done') },
          ].map(({ icon, label }, i) => {
            const n = i + 1;
            const active = n === step;
            const done = n < step;
            return (
              <div key={label} className={`flex flex-col items-center gap-0.5 text-xs font-medium transition-colors ${active ? "text-deliivo-orange" : done ? "text-deliivo-orange/60" : "text-gray-300"}`}>
                {icon}
                <span className="hidden sm:block">{label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 px-4 py-6">
        <div className="mx-auto max-w-lg">
          {recoveredDraft && !published && (
            <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-sm">
              Draft restored from this browser. You can continue from where you left off.
            </div>
          )}
          {step === 1 && <StepRoute state={state} onChange={patch} error={error} />}
          {step === 2 && <StepStopovers state={state} onChange={patch} />}
          {step === 3 && <StepDateTime state={state} onChange={patch} />}
          {step === 4 && <StepSeats state={state} onChange={patch} />}
          {step === 5 && <StepPrice state={state} onChange={patch} loading={loading} />}
          {step === 6 && (
            <StepConfirm
              state={state}
              onPublish={handlePublish}
              publishing={loading}
              error={error}
              payoutStatus={payoutStatus}
              payoutLoading={payoutStatusLoading}
              onStartPayoutSetup={handleStartPayoutSetup}
              payoutSetupLoading={payoutSetupLoading}
            />
          )}
        </div>
      </main>

      {/* Bottom navigation (not shown on step 5) */}
      {step < 6 && (
        <div className="sticky bottom-0 border-t border-gray-100 bg-white/90 backdrop-blur-sm px-4 py-4">
          <div className="mx-auto max-w-lg">
            <button
              type="button"
              onClick={handleContinue}
              disabled={!canContinue() || loading}
              className="btn-primary w-full py-3.5 text-base gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t('publish.processing')}</>
              ) : (
                <>{step === 5 ? t('publish.reviewRide') : t('publish.continue')}<ChevronRight className="h-4 w-4" /></>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PublishRidePage() {
  return (
    <ProtectedRoute>
      <PublishRideWizard />
    </ProtectedRoute>
  );
}
