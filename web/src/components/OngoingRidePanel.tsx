'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ArrowRight, Calendar, Clock, Loader2, MapPin, Navigation } from 'lucide-react';
import { Booking, bookingsApi, PublishedRide, publishRideApi } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { getSocket, onSocketEvent, BookingUpdatedPayload, RideUpdatedPayload, NotificationPayload } from '@/lib/socket';

type PanelRide = {
  id: string;
  role: 'rider' | 'driver';
  status: string;
  href: string;
  originAddress: string;
  destinationAddress: string;
  departureDate: string;
  departureTime: string;
};

const ACTIVE_BOOKING_STATUSES = [
  'CONFIRMED',
  'WAITING_FOR_PICKUP',
  'DRIVER_ARRIVED',
  'OTP_PENDING',
  'IN_PROGRESS',
  'ONBOARD',
  'DROP_PENDING',
  'DRIVER_DROPPED',
];

const ACTIVE_RIDE_STATUSES = ['IN_PROGRESS'];
const UPCOMING_BOOKING_STATUSES = ['CONFIRMED', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED'];
const UPCOMING_RIDE_STATUSES = ['PUBLISHED', 'READY_TO_START'];

const HIDDEN_ROUTE_PREFIXES = ['/auth', '/onboarding', '/admin', '/tracking', '/rides/'];

function getDepartureTimeMs(date: string, time: string) {
  const [hours = '0', minutes = '0'] = time.split(':');
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return Number.MAX_SAFE_INTEGER;
  parsed.setHours(Number(hours), Number(minutes), 0, 0);
  return parsed.getTime();
}

function isWithinNext24Hours(date: string, time: string) {
  const departureMs = getDepartureTimeMs(date, time);
  const now = Date.now();
  return departureMs >= now && departureMs <= now + 24 * 60 * 60 * 1000;
}

function statusLabel(status: string) {
  switch (status) {
    case 'IN_PROGRESS':
      return 'Ride active';
    case 'WAITING_FOR_PICKUP':
      return 'Waiting for pickup';
    case 'DRIVER_ARRIVED':
      return 'Driver arrived';
    case 'ONBOARD':
      return 'Onboard';
    case 'DROP_PENDING':
      return 'Drop-off pending';
    case 'READY_TO_START':
      return 'Ready to start';
    case 'PUBLISHED':
      return 'Upcoming';
    case 'CONFIRMED':
      return 'Confirmed';
    default:
      return status.replaceAll('_', ' ').toLowerCase();
  }
}

function mapBooking(booking: Booking): PanelRide | null {
  if (!booking.ride) return null;
  return {
    id: booking.rideId,
    role: 'rider',
    status: booking.status,
    href: `/rides/${booking.rideId}`,
    originAddress: booking.segmentRide?.originAddress || booking.ride.originAddress,
    destinationAddress: booking.segmentRide?.destinationAddress || booking.ride.destinationAddress,
    departureDate: booking.ride.departureDate,
    departureTime: booking.ride.departureTime,
  };
}

function mapPublishedRide(ride: PublishedRide): PanelRide {
  return {
    id: ride.id,
    role: 'driver',
    status: ride.status,
    href: `/rides/${ride.id}/manage`,
    originAddress: ride.originAddress,
    destinationAddress: ride.destinationAddress,
    departureDate: ride.departureDate,
    departureTime: ride.departureTime,
  };
}

function pickBestRide(rides: PanelRide[]) {
  const active = rides.filter((ride) =>
    ride.role === 'driver'
      ? ACTIVE_RIDE_STATUSES.includes(ride.status)
      : ACTIVE_BOOKING_STATUSES.includes(ride.status)
  );
  if (active.length > 0) {
    return active.sort((a, b) => getDepartureTimeMs(a.departureDate, a.departureTime) - getDepartureTimeMs(b.departureDate, b.departureTime))[0];
  }

  const upcoming = rides.filter((ride) => {
    const statusMatch = ride.role === 'driver'
      ? UPCOMING_RIDE_STATUSES.includes(ride.status)
      : UPCOMING_BOOKING_STATUSES.includes(ride.status);
    return statusMatch && isWithinNext24Hours(ride.departureDate, ride.departureTime);
  });

  return upcoming.sort((a, b) => getDepartureTimeMs(a.departureDate, a.departureTime) - getDepartureTimeMs(b.departureDate, b.departureTime))[0] || null;
}

export default function OngoingRidePanel() {
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const [ride, setRide] = useState<PanelRide | null>(null);
  const [loading, setLoading] = useState(false);

  const hidden = useMemo(() => {
    if (!pathname) return true;
    return HIDDEN_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  }, [pathname]);

  const loadRide = useCallback(async () => {
    if (!user || hidden) return;
    setLoading(true);
    try {
      const [bookedRes, publishedRes] = await Promise.all([
        bookingsApi.list(undefined, 1, 20),
        publishRideApi.getUserRides(undefined, 1, 20),
      ]);
      const booked = (bookedRes.data.bookings || []).map(mapBooking).filter(Boolean) as PanelRide[];
      const published = (publishedRes.data?.rides || []).map(mapPublishedRide);
      setRide(pickBestRide([...booked, ...published]));
    } catch {
      setRide(null);
    } finally {
      setLoading(false);
    }
  }, [hidden, user]);

  useEffect(() => {
    loadRide();
  }, [loadRide]);

  useEffect(() => {
    if (!user || hidden) return;
    getSocket();

    const reload = () => loadRide();
    const unsubBooking = onSocketEvent<BookingUpdatedPayload>('booking:updated', reload);
    const unsubRide = onSocketEvent<RideUpdatedPayload>('ride:updated', reload);
    const unsubNotification = onSocketEvent<NotificationPayload>('notification:new', reload);

    window.addEventListener('focus', reload);
    window.addEventListener('online', reload);
    document.addEventListener('visibilitychange', reload);
    return () => {
      unsubBooking();
      unsubRide();
      unsubNotification();
      window.removeEventListener('focus', reload);
      window.removeEventListener('online', reload);
      document.removeEventListener('visibilitychange', reload);
    };
  }, [hidden, loadRide, user]);

  if (authLoading || !user || hidden || !ride) return null;

  const dateLabel = new Date(ride.departureDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="fixed inset-x-0 bottom-20 z-40 px-3 pointer-events-none md:bottom-auto md:left-auto md:right-5 md:top-20 md:w-[420px] md:px-0">
      <div className="mx-auto max-w-xl pointer-events-auto md:mx-0 md:max-w-none">
        <Link
          href={ride.href}
          className="flex items-center gap-3 rounded-xl border border-orange-100 bg-white px-3 py-2.5 shadow-lg transition hover:border-deliivo-orange hover:shadow-xl md:px-4 md:py-3"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-deliivo-orange md:h-10 md:w-10">
            <Navigation className="h-4 w-4 md:h-5 md:w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-semibold text-deliivo-gray md:text-xs">
              <span className="text-deliivo-orange">{ride.role === 'driver' ? 'Driving' : 'Riding'}</span>
              <span>{statusLabel(ride.status)}</span>
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3 w-3" /> {dateLabel}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {ride.departureTime}
              </span>
            </span>
            <span className="mt-1 flex min-w-0 items-center gap-1 text-sm font-semibold text-deliivo-dark">
              <MapPin className="h-4 w-4 shrink-0 text-deliivo-orange" />
              <span className="truncate">{ride.originAddress.split(',')[0]} to {ride.destinationAddress.split(',')[0]}</span>
            </span>
          </span>
          {loading ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-deliivo-gray" /> : <ArrowRight className="h-4 w-4 shrink-0 text-deliivo-orange" />}
        </Link>
      </div>
    </div>
  );
}
