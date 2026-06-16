'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Car,
  Loader2,
  AlertCircle,
  ArrowRight,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { bookingsApi, publishRideApi, Booking, PublishedRide } from '@/lib/api';
import { getSocket, onSocketEvent, NotificationPayload, BookingUpdatedPayload, RideUpdatedPayload } from '@/lib/socket';
import { useAuth } from '@/lib/auth-context';

type Tab = 'booked' | 'published';
type BookingView = 'all' | 'active' | 'pending' | 'completed' | 'cancelled';
type PublishedView = 'all' | 'pending' | 'active' | 'completed' | 'cancelled';

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'Pending', className: 'bg-yellow-50 text-yellow-700 border border-yellow-200' },
  ACCEPTED: { label: 'Accepted', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  CONFIRMED: { label: 'Confirmed', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  PUBLISHED: { label: 'Upcoming', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  WAITING_FOR_PICKUP: { label: 'Pickup Soon', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  DRIVER_ARRIVED: { label: 'Driver Arrived', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  IN_PROGRESS: { label: 'In Progress', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  ONBOARD: { label: 'Onboard', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  DROP_PENDING: { label: 'Drop-off Pending', className: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  COMPLETED: { label: 'Completed', className: 'bg-green-50 text-green-700 border border-green-200' },
  CANCELLED: { label: 'Cancelled', className: 'bg-red-50 text-red-500 border border-red-200' },
  NO_SHOW: { label: 'No-show', className: 'bg-red-50 text-red-700 border border-red-200' },
  DRIVER_MISSED_PICKUP: { label: 'Missed Pickup', className: 'bg-red-50 text-red-700 border border-red-200' },
  DISPUTED: { label: 'Disputed', className: 'bg-purple-50 text-purple-700 border border-purple-200' },
  WITHDRAWN: { label: 'Withdrawn', className: 'bg-gray-50 text-gray-600 border border-gray-200' },
  REJECTED: { label: 'Rejected', className: 'bg-red-50 text-red-500 border border-red-200' },
  EXPIRED: { label: 'Expired', className: 'bg-gray-50 text-gray-500 border border-gray-200' },
};

const BOOKING_VIEW_FILTERS: Array<{
  id: BookingView;
  label: string;
  statuses: string[];
}> = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'active', label: 'Active', statuses: ['ACCEPTED', 'CONFIRMED', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED', 'IN_PROGRESS', 'ONBOARD', 'DROP_PENDING'] },
  { id: 'pending', label: 'Pending', statuses: ['PENDING', 'PAYMENT_PENDING', 'DRIVER_PENDING'] },
  { id: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['CANCELLED', 'WITHDRAWN', 'REJECTED', 'EXPIRED', 'NO_SHOW', 'DRIVER_MISSED_PICKUP', 'DISPUTED'] },
];

const PUBLISHED_VIEW_FILTERS: Array<{
  id: PublishedView;
  label: string;
  statuses: string[];
}> = [
  { id: 'all', label: 'All', statuses: [] },
  { id: 'pending', label: 'Pending', statuses: ['PUBLISHED'] },
  { id: 'active', label: 'Active', statuses: ['IN_PROGRESS'] },
  { id: 'completed', label: 'Completed', statuses: ['COMPLETED'] },
  { id: 'cancelled', label: 'Cancelled', statuses: ['CANCELLED'] },
];

function matchesBookingView(status: string, view: BookingView) {
  const filter = BOOKING_VIEW_FILTERS.find((item) => item.id === view);
  if (!filter || filter.id === 'all') return true;
  return filter.statuses.includes(status);
}

function matchesPublishedView(status: string, view: PublishedView) {
  const filter = PUBLISHED_VIEW_FILTERS.find((item) => item.id === view);
  if (!filter || filter.id === 'all') return true;
  return filter.statuses.includes(status);
}

function BookingCard({ booking, onAction }: { booking: Booking; onAction: () => void }) {
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
    const reason = window.prompt('Optional reason for cancelling this request', 'I no longer need this booking');
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
              {booking.seatsBooked} seat{booking.seatsBooked > 1 ? 's' : ''} booked
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.className}`}>{status.label}</span>
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
              {booking.totalPrice > 0 ? `EUR ${booking.totalPrice.toFixed(2)}` : 'Free'}
            </span>
          </div>
        </>
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-500">
          Ride details are not loaded yet, but the booking record is available.
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-2">
        <Link
          href={`/rides/${booking.rideId}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          Open details
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
                {acting ? 'Cancelling...' : 'Cancel request'}
              </button>
            )}
            {canCancel && (
              <button
                onClick={handleCancel}
                disabled={acting}
                className="inline-flex flex-1 items-center justify-center rounded-xl border border-red-200 px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50 transition-colors"
              >
                {acting ? 'Cancelling...' : 'Cancel'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PublishedRideCard({ ride }: { ride: PublishedRide }) {
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
          <p className="text-sm font-semibold text-gray-900">You (driver)</p>
          <p className="text-xs text-deliivo-gray">
            {ride.availableSeats}/{ride.totalSeats} seats available
          </p>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${status.className}`}>{status.label}</span>
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
          <Users className="w-3.5 h-3.5" /> {ride.totalSeats - ride.availableSeats}/{ride.totalSeats} booked
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
          {canManage ? 'Manage ride' : 'Open details'}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

function RidesContent() {
  const [tab, setTab] = useState<Tab>('booked');
  const [bookingView, setBookingView] = useState<BookingView>('all');
  const [publishedView, setPublishedView] = useState<PublishedView>('all');
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [publishedRides, setPublishedRides] = useState<PublishedRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    loadData();
  }, [tab]);

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
        const res = await bookingsApi.list();
        setBookings(res.data.bookings || []);
      } else {
        const res = await publishRideApi.getUserRides();
        setPublishedRides(res.data?.rides || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load rides');
    } finally {
      setLoading(false);
    }
  }

  const visibleBookings = bookings.filter((booking) => matchesBookingView(booking.status, bookingView));
  const visiblePublishedRides = publishedRides.filter((ride) => matchesPublishedView(ride.status, publishedView));

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-3">
        <Link href="/" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
          <ChevronLeft className="w-4 h-4" /> Home
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">My Rides</h1>
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
            Booked rides
          </button>
          <button
            type="button"
            onClick={() => setTab('published')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-xl transition-all ${
              tab === 'published' ? 'bg-deliivo-orange text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Published rides
          </button>
        </div>

        {tab === 'booked' && (
          <div className="flex flex-wrap gap-2">
            {BOOKING_VIEW_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setBookingView(filter.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  bookingView === filter.id
                    ? 'bg-deliivo-orange text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {filter.label}
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
                onClick={() => setPublishedView(filter.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  publishedView === filter.id
                    ? 'bg-deliivo-orange text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {filter.label}
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

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
          </div>
        ) : tab === 'booked' ? (
          bookings.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
              <Car className="w-12 h-12 text-orange-200" />
              <p className="text-gray-500 text-sm">No booked rides yet.</p>
              <Link
                href="/search"
                className="mt-2 text-sm font-semibold text-white bg-deliivo-orange px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
              >
                Search rides
              </Link>
            </div>
          ) : visibleBookings.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
              <Car className="w-12 h-12 text-orange-200" />
              <p className="text-gray-500 text-sm">No booked rides in this view.</p>
              <p className="text-xs text-gray-400">Try a different status filter or open a ride from search.</p>
              <Link
                href="/search"
                className="mt-2 text-sm font-semibold text-white bg-deliivo-orange px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
              >
                Search rides
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {visibleBookings.map((b) => (
                <BookingCard key={b.id} booking={b} onAction={loadData} />
              ))}
            </div>
          )
        ) : publishedRides.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
            <Car className="w-12 h-12 text-orange-200" />
            <p className="text-gray-500 text-sm">No published rides yet.</p>
            <Link
              href="/publish"
              className="mt-2 text-sm font-semibold text-white bg-deliivo-orange px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
            >
              Publish a ride
            </Link>
          </div>
        ) : visiblePublishedRides.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
            <Car className="w-12 h-12 text-orange-200" />
            <p className="text-gray-500 text-sm">No published rides in this view.</p>
            <p className="text-xs text-gray-400">Try a different status filter or open the ride details page.</p>
            <Link
              href="/publish"
              className="mt-2 text-sm font-semibold text-white bg-deliivo-orange px-5 py-2.5 rounded-xl hover:bg-orange-600 transition-colors"
            >
              Publish a ride
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {visiblePublishedRides.map((r) => (
              <PublishedRideCard key={r.id} ride={r} />
            ))}
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
