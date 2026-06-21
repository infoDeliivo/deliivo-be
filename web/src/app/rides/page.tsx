'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  ChevronRight,
  MapPin,
  Calendar,
  Clock,
  Users,
  Car,
  Loader2,
  ArrowRight,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import LoadFailureCard from '@/components/LoadFailureCard';
import { bookingsApi, publishRideApi, Booking, PublishedRide, Pagination, getApiErrorMessage } from '@/lib/api';
import { getSocket, onSocketEvent, NotificationPayload, BookingUpdatedPayload, RideUpdatedPayload } from '@/lib/socket';
import { useAuth } from '@/lib/auth-context';
import { useTranslation } from '@/lib/i18n-context';

type Tab = 'booked' | 'published';
type BookingView = 'all' | 'active' | 'pending' | 'completed' | 'cancelled';
type PublishedView = 'all' | 'pending' | 'active' | 'completed' | 'cancelled';
const PAGE_SIZE = 10;

const STATUS_CONFIG: Record<string, { labelKey: string; className: string }> = {
  PENDING: { labelKey: 'rides.pending', className: 'bg-yellow-50 text-yellow-700 border border-yellow-200' },
  ACCEPTED: { labelKey: 'rides.accepted', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  CONFIRMED: { labelKey: 'rides.confirmed', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  PUBLISHED: { labelKey: 'rides.upcoming', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  WAITING_FOR_PICKUP: { labelKey: 'rides.pickupSoon', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  DRIVER_ARRIVED: { labelKey: 'rides.driverArrived', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  IN_PROGRESS: { labelKey: 'rides.inProgress', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  ONBOARD: { labelKey: 'rides.onboard', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  DROP_PENDING: { labelKey: 'rides.dropoffPending', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  COMPLETED: { labelKey: 'rides.completed', className: 'bg-green-50 text-green-700 border border-green-200' },
  CANCELLED: { labelKey: 'rides.cancelled', className: 'bg-red-50 text-red-500 border border-red-200' },
  NO_SHOW: { labelKey: 'rides.noShow', className: 'bg-red-50 text-red-700 border border-red-200' },
  DRIVER_MISSED_PICKUP: { labelKey: 'rides.missedPickup', className: 'bg-red-50 text-red-700 border border-red-200' },
  DISPUTED: { labelKey: 'rides.disputed', className: 'bg-purple-50 text-purple-700 border border-purple-200' },
  WITHDRAWN: { labelKey: 'rides.withdrawn', className: 'bg-gray-50 text-gray-600 border border-gray-200' },
  REJECTED: { labelKey: 'rides.rejected', className: 'bg-red-50 text-red-500 border border-red-200' },
  EXPIRED: { labelKey: 'rides.expired', className: 'bg-gray-50 text-gray-500 border border-gray-200' },
};

const BOOKING_VIEW_FILTERS: Array<{
  id: BookingView;
  labelKey: string;
  statuses: string[];
}> = [
  { id: 'all', labelKey: 'rides.all', statuses: [] },
  { id: 'active', labelKey: 'rides.active', statuses: ['ACCEPTED', 'CONFIRMED', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'ONBOARD', 'DROP_PENDING'] },
  { id: 'pending', labelKey: 'rides.pending', statuses: ['PENDING', 'PAYMENT_PENDING', 'DRIVER_PENDING'] },
  { id: 'completed', labelKey: 'rides.completed', statuses: ['COMPLETED'] },
  { id: 'cancelled', labelKey: 'rides.cancelled', statuses: ['CANCELLED', 'WITHDRAWN', 'REJECTED', 'EXPIRED', 'NO_SHOW', 'DRIVER_MISSED_PICKUP', 'DISPUTED'] },
];

const PUBLISHED_VIEW_FILTERS: Array<{
  id: PublishedView;
  labelKey: string;
  statuses: string[];
}> = [
  { id: 'all', labelKey: 'rides.all', statuses: [] },
  { id: 'pending', labelKey: 'rides.pending', statuses: ['PUBLISHED'] },
  { id: 'active', labelKey: 'rides.active', statuses: ['IN_PROGRESS'] },
  { id: 'completed', labelKey: 'rides.completed', statuses: ['COMPLETED'] },
  { id: 'cancelled', labelKey: 'rides.cancelled', statuses: ['CANCELLED'] },
];

function getBookingStatuses(view: BookingView) {
  const filter = BOOKING_VIEW_FILTERS.find((item) => item.id === view);
  return filter?.statuses || [];
}

function getPublishedStatuses(view: PublishedView) {
  const filter = PUBLISHED_VIEW_FILTERS.find((item) => item.id === view);
  return filter?.statuses || [];
}

function PaginationControls({
  pagination,
  onPageChange,
}: {
  pagination: Pagination | null;
  onPageChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (!pagination || pagination.totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between rounded-2xl bg-white px-4 py-3 shadow-sm">
      <p className="text-xs text-gray-500">
        {t('common.pageOf', { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total })}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
          disabled={pagination.page <= 1}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          aria-label={t('common.previousPage')}
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(Math.min(pagination.totalPages, pagination.page + 1))}
          disabled={pagination.page >= pagination.totalPages}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
          aria-label={t('common.nextPage')}
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function BookingCard({ booking, onAction }: { booking: Booking; onAction: () => void }) {
  const { t } = useTranslation();
  const ride = booking.ride;
  const status = STATUS_CONFIG[booking.status] || STATUS_CONFIG.PENDING;
  const dateLabel = ride
    ? new Date(ride.departureDate).toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
    : '';
  const driverName = ride?.driver?.name || 'Driver';
  const initials = driverName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const [acting, setActing] = useState(false);

  const canWithdraw = ['PENDING', 'PAYMENT_PENDING', 'DRIVER_PENDING'].includes(booking.status);
  const canCancel = ['ACCEPTED', 'CONFIRMED'].includes(booking.status);

  async function handleWithdraw(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const reason = window.prompt(t('rides.cancelReasonPrompt'), t('rides.cancelReasonDefault'));
    if (reason === null) return;
    setActing(true);
    try {
      await bookingsApi.cancel(booking.id, reason.trim() || undefined);
      onAction();
    } catch {
      // ignore
    } finally {
      setActing(false);
    }
  }

  async function handleCancel(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setActing(true);
    try {
      await bookingsApi.cancel(booking.id);
      onAction();
    } catch {
      // ignore
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-sm font-bold text-primary-600 shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{driverName}</p>
            <p className="text-xs text-deliivo-gray">
              {t('rides.seatsBooked', { count: booking.seatsBooked, plural: booking.seatsBooked > 1 ? 's' : '' })}
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.className}`}>{t(status.labelKey)}</span>
      </div>

      {ride ? (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-sm text-gray-700">
              <MapPin className="w-4 h-4 text-deliivo-orange shrink-0" />
              <span className="font-medium truncate">{ride.originAddress.split(',')[0]}</span>
              <span className="text-gray-300 mx-1">-&gt;</span>
              <span className="font-medium truncate">{ride.destinationAddress.split(',')[0]}</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-400 ml-6">
              <span className="flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> {dateLabel}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {ride.departureTime}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-gray-50 gap-3">
            <div className="flex items-center gap-3 text-xs text-gray-500 min-w-0">
              {ride.vehicle && (
                <span className="flex items-center gap-1 truncate">
                  <Car className="w-3.5 h-3.5 shrink-0" />
                  {[ride.vehicle.brand, ride.vehicle.model_name].filter(Boolean).join(' ')}
                </span>
              )}
            </div>
            <span className="text-sm font-bold text-deliivo-orange">
              {booking.totalPrice > 0 ? `EUR ${booking.totalPrice.toFixed(2)}` : t('rides.free')}
            </span>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          {t('rides.detailsUnavailable')}
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Link
          href={`/rides/${booking.rideId}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          {t('rides.openDetails')}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>

        {(canWithdraw || canCancel) && (
          <>
            {canWithdraw && (
              <button
                onClick={handleWithdraw}
                disabled={acting}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                {acting ? t('rides.cancelling') : t('rides.cancelRequest')}
              </button>
            )}
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={acting}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-red-200 px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {acting ? t('rides.cancelling') : t('rides.cancel')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PublishedRideCard({ ride }: { ride: PublishedRide }) {
  const { t } = useTranslation();
  const status = STATUS_CONFIG[ride.status] || STATUS_CONFIG.PUBLISHED;
  const dateLabel = new Date(ride.departureDate).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const canManage = ['PUBLISHED', 'IN_PROGRESS'].includes(ride.status);

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{t('rides.youDriver')}</p>
          <p className="text-xs text-deliivo-gray">
            {t('rides.seatsAvailable', { available: ride.availableSeats, total: ride.totalSeats })}
          </p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.className}`}>{t(status.labelKey)}</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-sm text-gray-700">
          <MapPin className="w-4 h-4 text-deliivo-orange shrink-0" />
          <span className="font-medium truncate">{ride.originAddress.split(',')[0]}</span>
          <span className="text-gray-300 mx-1">-&gt;</span>
          <span className="font-medium truncate">{ride.destinationAddress.split(',')[0]}</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-gray-400 ml-6">
          <span className="flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5" /> {dateLabel}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" /> {ride.departureTime}
          </span>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 border-t border-gray-50 gap-3">
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Users className="w-3.5 h-3.5" /> {t('ride.seatsBooked', { booked: ride.totalSeats - ride.availableSeats, total: ride.totalSeats })}
        </span>
        <span className="text-sm font-bold text-deliivo-orange">
          {ride.currency} {ride.basePricePerSeat.toFixed(2)}/seat
        </span>
      </div>

      <div className="pt-2">
        <Link
          href={canManage ? `/rides/${ride.id}/manage` : `/rides/${ride.id}`}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          {canManage ? t('rides.manageRide') : t('rides.openDetails')}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

function RidesContent() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('booked');
  const [bookingView, setBookingView] = useState<BookingView>('all');
  const [publishedView, setPublishedView] = useState<PublishedView>('all');
  const [bookedPage, setBookedPage] = useState(1);
  const [publishedPage, setPublishedPage] = useState(1);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [publishedRides, setPublishedRides] = useState<PublishedRide[]>([]);
  const [bookingsPagination, setBookingsPagination] = useState<Pagination | null>(null);
  const [publishedPagination, setPublishedPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    loadData();
  }, [tab, bookingView, publishedView, bookedPage, publishedPage]);

  useEffect(() => {
    if (!user) return;

    getSocket();

    const unsub = onSocketEvent<NotificationPayload>('notification:new', (payload) => {
      const data = payload.data.data || {};
      if (data.rideId || data.bookingId) {
        loadData();
      }
    });

    return unsub;
  }, [tab, user?.id]);

  useEffect(() => {
    if (!user) return;
    getSocket();

    const unsubBooking = onSocketEvent<BookingUpdatedPayload>('booking:updated', (payload) => {
      setBookings((prev) =>
        prev.map((booking) =>
          booking.id === payload.bookingId
            ? {
                ...booking,
                status: payload.status,
                displayStatus: payload.status,
                updatedAt: payload.updatedAt,
                ride: booking.ride ? { ...booking.ride, id: payload.rideId } : booking.ride,
              }
            : booking
        )
      );
    });

    const unsubRide = onSocketEvent<RideUpdatedPayload>('ride:updated', (payload) => {
      setBookings((prev) =>
        prev.map((booking) =>
          booking.rideId === payload.rideId
            ? {
                ...booking,
                ride: booking.ride ? { ...booking.ride, status: payload.status } : booking.ride,
              }
            : booking
        )
      );
      setPublishedRides((prev) =>
        prev.map((ride) =>
          ride.id === payload.rideId ? { ...ride, status: payload.status } : ride
        )
      );
    });

    return () => {
      unsubBooking();
      unsubRide();
    };
  }, [user?.id]);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      if (tab === 'booked') {
        const res = await bookingsApi.list(getBookingStatuses(bookingView), bookedPage, PAGE_SIZE);
        setBookings(res.data.bookings || []);
        setBookingsPagination(res.data.pagination || null);
      } else {
        const res = await publishRideApi.getUserRides(getPublishedStatuses(publishedView), publishedPage, PAGE_SIZE);
        setPublishedRides(res.data?.rides || []);
        setPublishedPagination(res.data?.pagination || null);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, t('rides.loadFailed')));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
          <ChevronLeft className="w-4 h-4" /> {t('common.home')}
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">{t('rides.myRides')}</h1>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
        <div className="bg-white rounded-2xl p-1.5 shadow-sm flex">
          <button
            type="button"
            onClick={() => setTab('booked')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              tab === 'booked' ? 'bg-deliivo-orange text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('rides.booked')}
          </button>
          <button
            type="button"
            onClick={() => setTab('published')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              tab === 'published' ? 'bg-deliivo-orange text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t('rides.published')}
          </button>
        </div>

        {tab === 'booked' && (
          <div className="flex flex-wrap gap-2">
            {BOOKING_VIEW_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => {
                  setBookingView(filter.id);
                  setBookedPage(1);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  bookingView === filter.id
                    ? 'bg-deliivo-orange text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {t(filter.labelKey)}
              </button>
            ))}
          </div>
        )}

        {tab === 'published' && (
          <div className="flex flex-wrap gap-2">
            {PUBLISHED_VIEW_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => {
                  setPublishedView(filter.id);
                  setPublishedPage(1);
                }}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  publishedView === filter.id
                    ? 'bg-deliivo-orange text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {t(filter.labelKey)}
              </button>
            ))}
          </div>
        )}

        {error && (
          <LoadFailureCard
            title={t('rides.loadFailed')}
            message={error}
            onRetry={loadData}
          />
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
          </div>
        ) : tab === 'booked' ? (
          bookings.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
              <Car className="w-12 h-12 text-orange-200" />
              <p className="text-gray-500 text-sm">
                {bookingView === 'all' ? t('rides.noBookedAll') : t('rides.noBookedFiltered')}
              </p>
              {bookingView !== 'all' && (
                <>
                  <p className="text-xs text-gray-400">{t('rides.tryDifferentBooking')}</p>
                  <button
                    type="button"
                    onClick={() => { setBookingView('all'); setBookedPage(1); }}
                    className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    {t('rides.all')}
                  </button>
                </>
              )}
              <Link
                href="/search"
                className="mt-2 text-sm font-semibold text-white bg-deliivo-orange px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
              >
                {t('search.submit')}
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {bookings.map((b) => (
                <BookingCard key={b.id} booking={b} onAction={loadData} />
              ))}
              <PaginationControls pagination={bookingsPagination} onPageChange={setBookedPage} />
            </div>
          )
        ) : publishedRides.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
            <Car className="w-12 h-12 text-orange-200" />
            <p className="text-gray-500 text-sm">
              {publishedView === 'all' ? t('rides.noPublishedAll') : t('rides.noPublishedFiltered')}
            </p>
            {publishedView !== 'all' && (
              <>
                <p className="text-xs text-gray-400">{t('rides.tryDifferentPublished')}</p>
                <button
                  type="button"
                  onClick={() => { setPublishedView('all'); setPublishedPage(1); }}
                  className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                >
                  {t('rides.all')}
                </button>
              </>
            )}
            <Link
              href="/publish"
              className="mt-2 text-sm font-semibold text-white bg-deliivo-orange px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
            >
              {t('rides.publishRide')}
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {publishedRides.map((r) => (
              <PublishedRideCard key={r.id} ride={r} />
            ))}
            <PaginationControls pagination={publishedPagination} onPageChange={setPublishedPage} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function RidesPage() {
  return (
    <ProtectedRoute>
      <RidesContent />
    </ProtectedRoute>
  );
}
