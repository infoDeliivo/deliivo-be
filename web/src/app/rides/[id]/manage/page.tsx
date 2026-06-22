'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  AlertCircle,
  KeyRound,
  UserCheck,
  Navigation,
  Trash2,
  TestTube2,
  Sparkles,
  Share2,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import EmergencySosButton from '@/components/EmergencySosButton';
import SupportOverrideCard from '@/components/SupportOverrideCard';
import { driverBookingApi, rideOpsApi, publishRideApi, disputesApi, DriverPublishedRide, DriverRideBooking, getApiErrorMessage } from '@/lib/api';
import { getSocket, emitSocketEvent, onSocketEvent, LocationUpdate, NotificationPayload, BookingUpdatedPayload, RideUpdatedPayload } from '@/lib/socket';
import { useAuth } from '@/lib/auth-context';
import { showError, showSuccess } from '@/lib/app-feedback';
import { useTranslation } from '@/lib/i18n-context';

type RidePhase = 'loading' | 'published' | 'in_progress' | 'completed' | 'cancelled' | 'error';

function ManageRideContent() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t, locale } = useTranslation();

  const [ride, setRide] = useState<DriverPublishedRide | null>(null);
  const [bookings, setBookings] = useState<DriverRideBooking[]>([]);
  const [phase, setPhase] = useState<RidePhase>('loading');
const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');
  const [rejectTarget, setRejectTarget] = useState<DriverRideBooking | null>(null);
  const [rejectReasonPreset, setRejectReasonPreset] = useState('NO_SEATS');
  const [rejectCustomReason, setRejectCustomReason] = useState('');
  const allowRideSimulation = process.env.NEXT_PUBLIC_ALLOW_RIDE_SIMULATION === 'true';
  const allowManualOverride = process.env.NEXT_PUBLIC_ALLOW_RIDE_MANUAL_OVERRIDE === 'true';
  const [devBusy, setDevBusy] = useState<string | null>(null);

  // Live location tracking
  const [driverLocation, setDriverLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [tracking, setTracking] = useState(false);
  const watchIdRef = useRef<number | null>(null);

  const startTracking = useCallback(() => {
    if (!navigator.geolocation || tracking) return;
    setTracking(true);

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setDriverLocation({ lat, lng });
        // Submit to backend
        rideOpsApi.submitLocation(id, lat, lng).catch(() => {});
        // Emit via socket for real-time
        const socket = getSocket();
        if (socket) {
          socket.emit('driver:location', { rideId: id, lat, lng });
        }
      },
      () => { /* geolocation error */ },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
    );
  }, [id, tracking]);

  const stopTracking = useCallback(() => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setTracking(false);
  }, []);

  // Auto-start tracking when ride is in progress
  useEffect(() => {
    if (phase === 'in_progress') {
      startTracking();
    } else {
      stopTracking();
    }
    return () => stopTracking();
  }, [phase, startTracking, stopTracking]);

  // Listen for location updates via socket (if viewing as passenger would)
  useEffect(() => {
    const unsub = onSocketEvent<LocationUpdate>('ride:location', (data) => {
      if (data.rideId === id) {
        setDriverLocation({ lat: data.lat, lng: data.lng });
      }
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    if (!id || !user) return;

    const unsub = onSocketEvent<NotificationPayload>('notification:new', (payload) => {
      const rideId = payload.data.data?.rideId;
      if (rideId === id) {
        loadData();
      }
    });

    return unsub;
  }, [id, user?.id]);

  useEffect(() => {
    if (!id || !user) return;
    getSocket();

    const unsubBooking = onSocketEvent<BookingUpdatedPayload>('booking:updated', (payload) => {
      if (payload.rideId !== id) return;
      setBookings((prev) =>
        prev.map((booking) =>
          booking.id === payload.bookingId
            ? {
                ...booking,
                status: payload.status,
                displayStatus: payload.status,
              }
            : booking
        )
      );
    });

    const unsubRide = onSocketEvent<RideUpdatedPayload>('ride:updated', (payload) => {
      if (payload.rideId !== id) return;

      setRide((prev) => (prev ? { ...prev, status: payload.status } : prev));
      if (payload.status === 'IN_PROGRESS') setPhase('in_progress');
      else if (payload.status === 'COMPLETED') setPhase('completed');
      else if (payload.status === 'CANCELLED') setPhase('cancelled');
      else setPhase('published');
    });

    return () => {
      unsubBooking();
      unsubRide();
    };
  }, [id, user?.id]);

  useEffect(() => { if (id) loadData(); }, [id]);

  useEffect(() => {
    if (!id || !user) return;
    const joinRideRoom = () => getSocket()?.emit('ride:join', { rideId: id });
    joinRideRoom();
    const socket = getSocket();
    socket?.on('connect', joinRideRoom);
    return () => {
      socket?.off('connect', joinRideRoom);
      emitSocketEvent('ride:leave', { rideId: id });
    };
  }, [id, user?.id]);

  async function loadData() {
    setPhase('loading');
    try {
      const rideRes = await publishRideApi.getRideById(id);
      setRide(rideRes.data);
      setBookings(rideRes.data.bookings || []);

      // Determine phase from status
      const status = rideRes.data.status;
      if (status === 'COMPLETED') setPhase('completed');
      else if (status === 'CANCELLED') setPhase('cancelled');
      else if (status === 'IN_PROGRESS') setPhase('in_progress');
      else setPhase('published');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('manageRide.failedLoadRide'));
      setPhase('error');
    }
  }

  async function handleStartRide() {
    const overrideReason = allowManualOverride
      ? promptManualOverride('Start ride manually', 'Use only when the ride should start but the normal guard is blocking progress.')
      : undefined;
    if (allowManualOverride && overrideReason === null) return;
    setActionLoading('start');
    try {
      await rideOpsApi.startRide(id, overrideReason || undefined);
      setPhase('in_progress');
      if (ride) setRide({ ...ride, status: 'IN_PROGRESS' });
      await loadData();
      showSuccess(t('manageRide.rideStarted'), t('manageRide.rideStartedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedStartRide'));
      setError(message);
      showError(t('manageRide.couldNotStartRide'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleFinishRide() {
    const overrideReason = allowManualOverride
      ? promptManualOverride('Finish ride manually', 'Use only when the ride is complete but the remaining state is blocking closure.')
      : undefined;
    if (allowManualOverride && overrideReason === null) return;
    setActionLoading('finish');
    try {
      await rideOpsApi.finishRide(id, overrideReason || undefined);
      setPhase('completed');
      if (ride) setRide({ ...ride, status: 'COMPLETED' });
      await loadData();
      showSuccess(t('manageRide.rideFinished'), t('manageRide.rideFinishedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedFinishRide'));
      setError(message);
      showError(t('manageRide.couldNotFinishRide'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleCancelRide() {
    const ok = window.confirm(t('manageRide.cancelRideConfirm'));
    if (!ok) return;
    setActionLoading('cancel-ride');
    try {
      await publishRideApi.cancelRide(id);
      setPhase('cancelled');
      setRide((prev) => (prev ? { ...prev, status: 'CANCELLED' } : prev));
      setBookings((prev) => prev.map((b) => ({ ...b, status: 'CANCELLED' })));
      showSuccess(t('manageRide.rideCancelledToast'), t('manageRide.rideCancelledToastCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedCancelRide'));
      setError(message);
      showError(t('manageRide.couldNotCancelRide'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleAcceptBooking(bookingId: string) {
    const current = bookings.find((booking) => booking.id === bookingId);
    if (current && current.status !== 'DRIVER_PENDING' && current.status !== 'PENDING') {
      showError(t('manageRide.requestAlreadyUpdated'), t('manageRide.requestAlreadyUpdatedCopy', { status: current.status.replace(/_/g, ' ').toLowerCase() }));
      return;
    }
    setActionLoading(`accept-${bookingId}`);
    try {
      await driverBookingApi.accept(bookingId);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'CONFIRMED' } : b));
      await loadData();
      showSuccess(t('manageRide.requestAccepted'), t('manageRide.riderNotified'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedAccept'));
      setError(message);
      showError(t('manageRide.couldNotAcceptRequest'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleRejectBooking(bookingId: string, reason: string) {
    setActionLoading(`reject-${bookingId}`);
    try {
      await driverBookingApi.reject(bookingId, reason);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'REJECTED' } : b));
      setRejectTarget(null);
      setRejectCustomReason('');
      await loadData();
      showSuccess(t('manageRide.requestRejected'), t('manageRide.riderNotified'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedReject'));
      setError(message);
      showError(t('manageRide.couldNotRejectRequest'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleDriverArrived(booking: DriverRideBooking, overrideReason?: string) {
    const bookingId = booking.id;
    setActionLoading(`arrived-${bookingId}`);
    try {
      const location = driverLocation || getBookingPoint(booking, 'pickup');
        await rideOpsApi.driverArrived(bookingId, location?.lat, location?.lng, overrideReason);
      if (location?.lat != null && location?.lng != null) {
        setDriverLocation({ lat: location.lat, lng: location.lng });
      }
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'DRIVER_ARRIVED' } : b));
      await loadData();
      showSuccess(t('manageRide.arrivalMarked'), t('manageRide.arrivalMarkedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedMarkArrival'));
      setError(message);
      showError(t('manageRide.couldNotMarkArrival'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleMarkNoShow(bookingId: string, overrideReason?: string) {
    setActionLoading(`noshow-${bookingId}`);
    try {
        await rideOpsApi.markNoShow(bookingId, driverLocation?.lat, driverLocation?.lng, overrideReason);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'NO_SHOW' } : b));
      await loadData();
      showSuccess(t('manageRide.noShowMarked'), t('manageRide.noShowMarkedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedMarkNoShow'));
      setError(message);
      showError(t('manageRide.couldNotMarkNoShow'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function handleReportPassengerIssue(booking: DriverRideBooking) {
    const reason = window.prompt(t('manageRide.reasonForReport'), booking.status === 'NO_SHOW' ? 'NO_SHOW' : 'OTHER');
    if (!reason) return;
    const description = window.prompt(t('manageRide.addDetailsForSupport'), '') || undefined;
    setActionLoading(`report-${booking.id}`);
    setError('');
    try {
      await disputesApi.create({
        rideId: id,
        bookingId: booking.id,
        reason,
        description,
      });
      await loadData();
      showSuccess(t('manageRide.issueReported'), t('manageRide.issueReportedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedReportIssue'));
      setError(message);
      showError(t('manageRide.couldNotReportIssue'), message);
    } finally {
      setActionLoading('');
    }
  }

  async function submitSimulatedLocation(point?: { lat?: number; lng?: number } | null) {
    if (point?.lat == null || point?.lng == null) return;
    setDriverLocation({ lat: point.lat, lng: point.lng });
    await rideOpsApi.submitLocation(id, point.lat, point.lng);
  }

  function getBookingPoint(booking: DriverRideBooking, type: 'pickup' | 'dropoff') {
    return type === 'pickup' ? booking.pickupLocation : booking.dropoffLocation;
  }

  async function handleDevDriverArrived(booking: DriverRideBooking) {
    setDevBusy(`arrived-${booking.id}`);
    try {
      const point = getBookingPoint(booking, 'pickup');
      await submitSimulatedLocation(point);
      await rideOpsApi.driverArrived(booking.id, point?.lat, point?.lng);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('manageRide.failedSimulateDriverArrival'));
    } finally {
      setDevBusy(null);
    }
  }

  async function handleDevPickup(booking: DriverRideBooking) {
    setDevBusy(`pickup-${booking.id}`);
    try {
      const point = getBookingPoint(booking, 'pickup');
      await submitSimulatedLocation(point);
      await rideOpsApi.devSimulatePickup(booking.id, point?.lat, point?.lng);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('manageRide.failedSimulatePickup'));
    } finally {
      setDevBusy(null);
    }
  }

  async function handleDevDropoff(booking: DriverRideBooking) {
    setDevBusy(`dropoff-${booking.id}`);
    try {
      const point = getBookingPoint(booking, 'dropoff');
      await submitSimulatedLocation(point);
      await rideOpsApi.devSimulateDropoff(booking.id, point?.lat, point?.lng);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('manageRide.failedSimulateDropoff'));
    } finally {
      setDevBusy(null);
    }
  }

  async function handleConfirmDropoff(booking: DriverRideBooking, overrideReason?: string) {
    const bookingId = booking.id;
    setActionLoading(`dropoff-${bookingId}`);
    try {
      const point = getBookingPoint(booking, 'dropoff');
        await rideOpsApi.confirmDropoff(bookingId, point?.lat, point?.lng, overrideReason);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'DROP_PENDING' } : b));
      await loadData();
      showSuccess(t('manageRide.dropoffMarked'), t('manageRide.dropoffMarkedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('manageRide.failedConfirmDropoff'));
      setError(message);
      showError(t('manageRide.couldNotConfirmDropoff'), message);
    } finally {
      setActionLoading('');
    }
  }

  function openRejectDialog(booking: DriverRideBooking) {
    setRejectTarget(booking);
    setRejectReasonPreset('NO_SEATS');
    setRejectCustomReason('');
  }

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deliivo-cream">
        <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
      </div>
    );
  }

  if (phase === 'error' || !ride) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-deliivo-cream px-4">
        <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
        <p className="text-lg font-semibold text-deliivo-dark">{error || t('rideDetail.notFound')}</p>
        <Link href="/rides" className="btn-primary mt-6 py-2.5 px-8 text-sm">{t('rideDetail.backToRides')}</Link>
      </div>
    );
  }

  const dateLabel = new Date(ride.departureDate).toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  const pendingBookings = bookings.filter(b => b.status === 'PENDING' || b.status === 'DRIVER_PENDING');
  const confirmedBookings = bookings.filter(b => [
    'CONFIRMED',
    'ACCEPTED',
    'WAITING_FOR_PICKUP',
    'DRIVER_ARRIVED',
    'ONBOARD',
    'DROP_PENDING',
    'NO_SHOW',
    'DRIVER_MISSED_PICKUP',
    'COMPLETED',
  ].includes(b.status));
  const pickupOtpBookings = confirmedBookings.filter(b => ['WAITING_FOR_PICKUP', 'DRIVER_ARRIVED'].includes(b.status));
  const requestCount = pendingBookings.length;
  const passengerCount = confirmedBookings.length;

  return (
    <div className="min-h-screen bg-deliivo-cream">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center px-4">
          <Link href="/rides" className="flex items-center gap-1.5 text-sm font-medium text-deliivo-gray hover:text-deliivo-dark">
            <ArrowLeft className="h-4 w-4" /> {t('rides.myRides')}
          </Link>
          <span className="ml-4 text-sm font-semibold text-deliivo-dark">{t('manageRide.title')}</span>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
        {/* Ride status card */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className={`px-5 py-4 ${phase === 'in_progress' ? 'bg-gradient-to-r from-green-500 to-green-600' : phase === 'completed' ? 'bg-gradient-to-r from-gray-500 to-gray-600' : phase === 'cancelled' ? 'bg-gradient-to-r from-red-500 to-red-600' : 'bg-gradient-to-r from-deliivo-orange to-primary-600'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/80">{t('manageRide.dateAtTime', { date: dateLabel, time: ride.departureTime })}</p>
                <p className="text-lg font-bold text-white mt-0.5">
                  {ride.originAddress.split(',')[0]} → {ride.destinationAddress.split(',')[0]}
                </p>
              </div>
              <span className={`text-xs font-bold px-3 py-1.5 rounded-full bg-white/20 text-white`}>
                {phase === 'in_progress' ? t('rides.inProgress') : phase === 'completed' ? t('rides.completed') : phase === 'cancelled' ? t('rides.cancelled') : t('rides.published')}
              </span>
            </div>
          </div>

          <div className="p-5">
            <div className="grid grid-cols-1 gap-3 text-xs text-deliivo-gray sm:grid-cols-2 lg:grid-cols-4">
              <span className="flex items-center gap-1"><Calendar size={13} /> {dateLabel}</span>
              <span className="flex items-center gap-1"><Clock size={13} /> {ride.departureTime}</span>
              <span className="flex items-center gap-1"><Users size={13} /> {t('manageRide.availableSeats', { available: ride.availableSeats, total: ride.totalSeats })}</span>
              <span className="flex items-center gap-1"><MapPin size={13} /> {ride.currency} {ride.basePricePerSeat.toFixed(2)}{t('rideDetail.perSeatShort')}</span>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-[11px] text-deliivo-gray">{t('manageRide.requests')}</p>
                <p className="text-sm font-semibold text-deliivo-dark">{requestCount}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-[11px] text-deliivo-gray">{t('manageRide.passengers')}</p>
                <p className="text-sm font-semibold text-deliivo-dark">{passengerCount}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-[11px] text-deliivo-gray">{t('manageRide.status')}</p>
                <p className="text-sm font-semibold text-deliivo-dark">{phase === 'in_progress' ? t('rides.inProgress') : phase === 'completed' ? t('rides.completed') : phase === 'cancelled' ? t('rides.cancelled') : t('rides.published')}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-3 py-2">
                <p className="text-[11px] text-deliivo-gray">{t('manageRide.rideId')}</p>
                <p className="text-sm font-semibold text-deliivo-dark truncate">{ride.id.slice(0, 8)}</p>
              </div>
            </div>
          </div>
        </div>

        {requestCount > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">{t('manageRide.requestsWaiting')}</p>
            <p className="text-xs text-amber-800 mt-1">
              {t('manageRide.requestsWaitingCopy', { count: requestCount, plural: requestCount > 1 ? 's' : '' })}
            </p>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}

        {phase !== 'completed' && phase !== 'cancelled' && (
          <EmergencySosButton rideId={ride.id} role="DRIVER" className="w-full" />
        )}

          {/* Pickup OTP verification is a primary ride-day action. */}
          {phase === 'in_progress' && pickupOtpBookings.length > 0 && (
          <div className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
                <KeyRound size={16} className="text-deliivo-orange" /> {t('manageRide.pickupOtpTitle')}
              </h3>
              <p className="mt-1 text-xs text-deliivo-gray">
                {t('manageRide.pickupOtpCopy')}
              </p>
            </div>
            {pickupOtpBookings.map(booking => (
              <OtpVerifySection key={booking.id} booking={booking} onVerified={loadData} />
            ))}
          </div>
        )}

        {/* Ride actions */}
        {phase === 'in_progress' && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <Navigation size={16} className="text-green-500" /> {t('manageRide.inProgressTitle')}
            </h3>
            <p className="text-xs text-deliivo-gray">{t('manageRide.inProgressCopy')}</p>
            <button
              type="button"
              onClick={handleFinishRide}
              disabled={actionLoading === 'finish'}
              className="btn-primary w-full py-3 text-base gap-2 disabled:opacity-60"
            >
              {actionLoading === 'finish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
              {t('manageRide.finishRide')}
            </button>
          </div>
        )}

        {phase === 'completed' && (
          <div className="rounded-2xl bg-green-50 border border-green-200 p-5 text-center">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
            <p className="text-base font-semibold text-green-800">{t('manageRide.completedTitle')}</p>
            <p className="text-sm text-green-600 mt-1">{t('manageRide.completedCopy')}</p>
          </div>
        )}

        {phase === 'cancelled' && (
          <div className="rounded-2xl bg-red-50 border border-red-200 p-5 text-center">
            <XCircle className="h-10 w-10 text-red-500 mx-auto mb-2" />
            <p className="text-base font-semibold text-red-800">{t('manageRide.cancelledTitle')}</p>
            <p className="text-sm text-red-600 mt-1">{t('manageRide.cancelledCopy')}</p>
          </div>
        )}

        {/* Pending booking requests */}
        {pendingBookings.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-500" /> {t('manageRide.pendingRequests', { count: pendingBookings.length })}
            </h3>
            <div className="space-y-3">
              {pendingBookings.map(booking => (
                <BookingRequestCard
                  key={booking.id}
                  booking={booking}
                  onAccept={() => handleAcceptBooking(booking.id)}
                  onReject={() => openRejectDialog(booking)}
                  loading={actionLoading === `accept-${booking.id}` || actionLoading === `reject-${booking.id}`}
                />
              ))}
            </div>
          </div>
        )}
        {pendingBookings.length === 0 && phase === 'published' && (
          <div className="rounded-2xl bg-white shadow-sm p-5">
            <p className="text-sm font-semibold text-deliivo-dark">{t('manageRide.noPendingTitle')}</p>
            <p className="mt-1 text-xs text-deliivo-gray">
              {t('manageRide.noPendingCopy')}
            </p>
          </div>
        )}

        {/* Confirmed passengers */}
        {confirmedBookings.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <UserCheck size={16} className="text-green-500" /> {t('manageRide.passengerCount', { count: confirmedBookings.length })}
            </h3>
            <div className="space-y-3">
              {confirmedBookings.map(booking => (
                <PassengerCard
                  key={booking.id}
                  booking={booking}
                  ridePhase={phase}
                  onDriverArrived={() => handleDriverArrived(booking)}
                  onMarkNoShow={() => handleMarkNoShow(booking.id)}
                  onReportIssue={() => handleReportPassengerIssue(booking)}
                  onConfirmDropoff={() => handleConfirmDropoff(booking)}
                  arrivedLoading={actionLoading === `arrived-${booking.id}`}
                  noShowLoading={actionLoading === `noshow-${booking.id}`}
                  reportLoading={actionLoading === `report-${booking.id}`}
                  dropoffLoading={actionLoading === `dropoff-${booking.id}`}
                />
              ))}
            </div>
            <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-deliivo-gray">Support context</p>
              <p className="mt-1 text-sm text-deliivo-dark">
                Share the booking ID, passenger name, pickup status, and ride ID when a manual override or dispute review is needed.
              </p>
            </div>
          </div>
        )}
        {confirmedBookings.length === 0 && phase !== 'completed' && (
          <div className="rounded-2xl bg-white shadow-sm p-5">
            <p className="text-sm font-semibold text-deliivo-dark">{t('manageRide.noPassengersTitle')}</p>
            <p className="mt-1 text-xs text-deliivo-gray">
              {t('manageRide.noPassengersCopy')}
            </p>
          </div>
        )}

        {phase === 'published' && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <Navigation size={16} className="text-deliivo-orange" /> {t('manageRide.driverActions')}
            </h3>
            <p className="text-xs text-deliivo-gray">
              {t('manageRide.driverActionsCopy')}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleStartRide}
                disabled={actionLoading === 'start'}
                className="btn-primary w-full py-3 text-base gap-2 disabled:opacity-60"
              >
                {actionLoading === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-5 w-5" />}
                {t('manageRide.startRide')}
              </button>
              <button
                type="button"
                onClick={handleCancelRide}
                disabled={actionLoading === 'cancel-ride'}
                className="w-full rounded-xl border border-red-200 px-4 py-3 text-base font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {actionLoading === 'cancel-ride' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-5 w-5" />}
                {t('manageRide.cancelRide')}
              </button>
            </div>
          </div>
        )}

        {allowRideSimulation && confirmedBookings.length > 0 && (
          <div className="rounded-2xl border border-dashed border-deliivo-orange/30 bg-orange-50/40 p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <TestTube2 size={16} className="text-deliivo-orange" /> {t('manageRide.devSimulator')}
            </h3>
            <p className="text-xs text-deliivo-gray">
              {t('manageRide.devSimulatorCopy')}
            </p>
            <div className="space-y-3">
              {confirmedBookings.map((booking) => {
                const pickupOtp = (booking as unknown as { pickupOtp?: string }).pickupOtp;
                const isWaiting = booking.status === 'WAITING_FOR_PICKUP';
                const isArrived = booking.status === 'DRIVER_ARRIVED';
                const isOnboard = booking.status === 'ONBOARD';
                const isDropPending = booking.status === 'DROP_PENDING';

                return (
                  <div key={booking.id} className="rounded-xl bg-white p-4 shadow-sm space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-deliivo-dark">
                          {booking.passenger?.name || t('manageRide.passenger')} <span className="text-xs font-normal text-deliivo-gray">#{booking.id.slice(0, 8)}</span>
                        </p>
                        <p className="text-xs text-deliivo-gray">
                          {t('manageRide.status')}: {booking.status}
                          {pickupOtp ? ` | ${t('manageRide.pickupOtpShort')}: ${pickupOtp}` : ''}
                        </p>
                      </div>
                      <Sparkles className="h-4 w-4 text-deliivo-orange" />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {isWaiting && (
                        <button
                          type="button"
                          onClick={() => handleDevDriverArrived(booking)}
                          disabled={devBusy === `arrived-${booking.id}`}
                          className="rounded-full border border-deliivo-orange px-3 py-1.5 text-xs font-semibold text-deliivo-orange hover:bg-orange-50 disabled:opacity-40"
                        >
                          {devBusy === `arrived-${booking.id}` ? t('common.working') : t('manageRide.simulateDriverArrived')}
                        </button>
                      )}
                      {isArrived && (
                        <button
                          type="button"
                          onClick={() => handleDevPickup(booking)}
                          disabled={devBusy === `pickup-${booking.id}`}
                          className="rounded-full bg-deliivo-orange px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
                        >
                          {devBusy === `pickup-${booking.id}` ? t('common.working') : t('manageRide.simulatePickup')}
                        </button>
                      )}
                      {isOnboard && (
                        <button
                          type="button"
                          onClick={() => handleDevDropoff(booking)}
                          disabled={devBusy === `dropoff-${booking.id}`}
                          className="rounded-full border border-green-200 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40"
                        >
                          {devBusy === `dropoff-${booking.id}` ? t('common.working') : t('manageRide.simulateDropoff')}
                        </button>
                      )}
                      {isDropPending && (
                        <span className="rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 border border-green-200">
                          {t('manageRide.dropoffPending')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Location updates continue in the background; only live sharing is shown here. */}
          {phase === 'in_progress' && (
            <div className="rounded-2xl border border-orange-100 bg-orange-50 p-5">
              <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
                <Share2 size={14} className="text-deliivo-orange" />
                {t('rideDetail.liveSharing')}
              </h3>
              {tracking ? (
                <span className="text-xs font-medium text-green-700">{t('rideDetail.sharingActive')}</span>
              ) : (
                <button onClick={startTracking} className="text-xs font-medium text-deliivo-orange hover:underline">
                  {t('rideDetail.startSharingLocation')}
                </button>
              )}
            </div>
              <p className="mt-2 text-xs text-deliivo-gray">
                {t('manageRide.liveSharingCopy')}
              </p>
            </div>
          )}

          <SupportOverrideCard
            title="Driver support and override path"
            copy="Use this when OTP verification, no-show marking, cancellation, or passenger state does not move as expected. Support should work from the ride and booking IDs below and use admin tools only after checking payment and dispute context."
            identifiers={[
              { label: 'Ride ID', value: ride.id },
              { label: 'Driver ID', value: user?.id },
            ]}
            supportTopicHref="/contact"
          />

          {phase !== 'completed' && phase !== 'cancelled' && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-amber-950">Manual recovery</h3>
                  <p className="mt-1 text-xs text-amber-900">
                    Use these only when the normal ride-day control is blocked. Every action is written into the dispute evidence trail.
                  </p>
                  {!allowManualOverride && (
                    <p className="mt-1 text-[11px] font-medium text-amber-800">
                      Manual override is disabled until `NEXT_PUBLIC_ALLOW_RIDE_MANUAL_OVERRIDE=true`.
                    </p>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={handleStartRide} disabled={!allowManualOverride} className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40">
                  Manual start ride
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const target = pickupOtpBookings[0];
                    if (!target) return;
                    const overrideReason = promptManualOverride('Manual OTP verification', 'Use when the pickup OTP cannot be used but the passenger should still be onboarded.');
                    if (overrideReason === null) return;
                    setActionLoading(`manual-pickup-${target.id}`);
                    try {
                      await rideOpsApi.verifyPickupOtp(target.id, '000000', overrideReason || undefined);
                      await loadData();
                    } catch (err: unknown) {
                      const message = getApiErrorMessage(err, t('manageRide.failedSimulatePickup'));
                      setError(message);
                      showError(t('manageRide.couldNotAcceptRequest'), message);
                    } finally {
                      setActionLoading('');
                    }
                  }}
                  disabled={Boolean(actionLoading) || !allowManualOverride}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                >
                  Manual pickup approval
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const target = confirmedBookings.find((booking) => booking.status === 'ONBOARD');
                    if (!target) return;
                    const overrideReason = promptManualOverride('Manual drop-off confirmation', 'Use when drop-off needs to be completed because the normal confirmation path is blocked.');
                    if (overrideReason === null) return;
                    handleConfirmDropoff(target, overrideReason);
                  }}
                  disabled={!allowManualOverride}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40"
                >
                  Manual drop-off
                </button>
                <button type="button" onClick={handleFinishRide} disabled={!allowManualOverride} className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-40">
                  Manual finish ride
                </button>
              </div>
            </div>
          )}

          {rejectTarget && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-deliivo-dark">{t('manageRide.rejectTitle')}</h3>
                  <p className="mt-1 text-sm text-deliivo-gray">
                    {t('manageRide.rejectCopy')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="rounded-full p-2 text-deliivo-gray hover:bg-gray-100 hover:text-deliivo-dark"
                  aria-label={t('manageRide.closeRejectDialog')}
                >
                  <XCircle className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                <div className="grid gap-2 sm:grid-cols-2">
                  {[
                    ['NO_SEATS', t('manageRide.rejectNoSeats')],
                    ['ROUTE_CHANGED', t('manageRide.rejectRouteChanged')],
                    ['TRIP_TOO_FULL', t('manageRide.rejectTripFull')],
                    ['NOT_A_GOOD_FIT', t('manageRide.rejectNotFit')],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setRejectReasonPreset(value)}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium text-left transition-colors ${
                        rejectReasonPreset === value
                          ? 'border-deliivo-orange bg-deliivo-orange-light text-deliivo-dark'
                          : 'border-gray-200 bg-white text-deliivo-dark hover:bg-gray-50'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <label className="block">
                  <span className="text-xs font-medium text-deliivo-gray">{t('manageRide.customReason')}</span>
                  <textarea
                    value={rejectCustomReason}
                    onChange={(e) => setRejectCustomReason(e.target.value)}
                    placeholder={t('manageRide.customReasonPlaceholder')}
                    rows={3}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20 resize-none"
                  />
                </label>
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejectTarget(null)}
                  className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-deliivo-dark hover:bg-gray-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const selectedReason = rejectCustomReason.trim() || {
                      NO_SEATS: t('manageRide.rejectNoSeats'),
                      ROUTE_CHANGED: t('manageRide.rejectRouteChanged'),
                      TRIP_TOO_FULL: t('manageRide.rejectTripFull'),
                      NOT_A_GOOD_FIT: t('manageRide.rejectNotFit'),
                    }[rejectReasonPreset] || t('manageRide.driverRejected');
                    handleRejectBooking(rejectTarget.id, selectedReason);
                  }}
                  disabled={actionLoading === `reject-${rejectTarget.id}`}
                  className="flex-1 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                >
                  {actionLoading === `reject-${rejectTarget.id}` ? t('manageRide.rejecting') : t('manageRide.rejectBooking')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Booking Request Card ─────────────────────────────────────────────────────

function BookingRequestCard({
  booking,
  onAccept,
  onReject,
  loading,
}: {
  booking: DriverRideBooking;
  onAccept: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const statusLabel = booking.displayStatus || booking.status;
  const deadlineLabel = booking.decisionDeadline && !booking.decisionDeadline.isExpired
    ? formatCountdown(booking.decisionDeadline.timeRemainingSeconds, t)
    : null;
  return (
    <div className="rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-deliivo-dark">
            {booking.passenger?.name || t('manageRide.passengerRequest')}
          </p>
          <p className="text-xs text-deliivo-gray">
            {t('manageRide.seatsRequested', { count: booking.seatsBooked, plural: booking.seatsBooked > 1 ? 's' : '' })}
            {booking.totalPrice ? ` • ${booking.totalPrice.toFixed(2)}` : ''}
          </p>
          <p className="text-[11px] text-deliivo-gray">{t('manageRide.bookingNumber', { id: booking.id.slice(0, 8) })} • {statusLabel}</p>
        </div>
        <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
          {t('rides.pending')}
        </span>
      </div>
      <div className="grid gap-2 text-xs text-deliivo-gray sm:grid-cols-2">
        <p><span className="font-medium text-deliivo-dark">{t('rideDetail.pickup')}:</span> {booking.pickupLocation?.address || t('manageRide.fullRoutePickup')}</p>
        <p><span className="font-medium text-deliivo-dark">{t('rideDetail.dropoff')}:</span> {booking.dropoffLocation?.address || t('manageRide.fullRouteDropoff')}</p>
        {deadlineLabel && <p className="sm:col-span-2"><span className="font-medium text-deliivo-dark">{t('manageRide.respondIn')}:</span> {deadlineLabel}</p>}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onReject}
          disabled={loading}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-red-200 text-red-500 hover:bg-red-50 disabled:opacity-40"
        >
          <XCircle className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onAccept}
          disabled={loading}
          className="flex h-9 items-center gap-1.5 rounded-full bg-green-500 px-4 text-sm font-medium text-white hover:bg-green-600 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          {t('manageRide.accept')}
        </button>
      </div>
    </div>
  );
}

// ─── Passenger Card ───────────────────────────────────────────────────────────

function PassengerCard({
  booking,
  ridePhase,
  onDriverArrived,
  onMarkNoShow,
  onReportIssue,
  onConfirmDropoff,
  arrivedLoading,
  noShowLoading,
  reportLoading,
  dropoffLoading,
}: {
  booking: DriverRideBooking;
  ridePhase: RidePhase;
  onDriverArrived: () => void;
  onMarkNoShow: () => void;
  onReportIssue: () => void;
  onConfirmDropoff: () => void;
  arrivedLoading: boolean;
  noShowLoading: boolean;
  reportLoading: boolean;
  dropoffLoading: boolean;
}) {
  const { t } = useTranslation();
  const statusLabel: Record<string, string> = {
    CONFIRMED: t('rides.confirmed'),
    ACCEPTED: t('rides.accepted'),
    WAITING_FOR_PICKUP: t('rides.pickupSoon'),
    DRIVER_ARRIVED: t('rides.driverArrived'),
    ONBOARD: t('rides.onboard'),
    DROP_PENDING: t('rides.dropoffPending'),
    NO_SHOW: t('rides.noShow'),
    DRIVER_MISSED_PICKUP: t('rides.missedPickup'),
    COMPLETED: t('rides.completed'),
  };

  return (
    <>
    <div className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
      <div>
        <p className="text-sm font-semibold text-deliivo-dark">
          {booking.passenger?.name || t('manageRide.passenger')}
        </p>
        <p className="text-xs text-deliivo-gray">
          {t('ride.seatsCount', { count: booking.seatsBooked, plural: booking.seatsBooked > 1 ? 's' : '' })} &middot; {statusLabel[booking.status] || booking.status}
        </p>
        <p className="text-[11px] text-deliivo-gray">
          {booking.pickupLocation?.address || t('manageRide.pickupNotSet')} → {booking.dropoffLocation?.address || t('manageRide.dropoffNotSet')}
        </p>
      </div>
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
        booking.status === 'ONBOARD' || booking.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border border-green-200'
        : booking.status === 'NO_SHOW' || booking.status === 'DRIVER_MISSED_PICKUP' ? 'bg-red-50 text-red-700 border border-red-200'
        : booking.status === 'DROP_PENDING' ? 'bg-purple-50 text-purple-700 border border-purple-200'
        : booking.status === 'DRIVER_ARRIVED' ? 'bg-amber-50 text-amber-700 border border-amber-200'
        : 'bg-blue-50 text-blue-700 border border-blue-200'
      }`}>
        {statusLabel[booking.status] || booking.status}
      </span>
    </div>

    {ridePhase === 'in_progress' && ['WAITING_FOR_PICKUP', 'DRIVER_ARRIVED'].includes(booking.status) && (
      <div className="mt-3 flex flex-wrap gap-2">
        {booking.status === 'WAITING_FOR_PICKUP' && (
          <button
            type="button"
            onClick={onDriverArrived}
            disabled={arrivedLoading}
            className="inline-flex items-center gap-2 rounded-full border border-deliivo-orange px-4 py-2 text-sm font-semibold text-deliivo-orange hover:bg-orange-50 disabled:opacity-40"
          >
            {arrivedLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Navigation className="h-3.5 w-3.5" />}
            {t('manageRide.driverArrived')}
          </button>
        )}
        {booking.status === 'DRIVER_ARRIVED' && (
          <button
            type="button"
            onClick={onMarkNoShow}
            disabled={noShowLoading}
            className="inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            {noShowLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
            {t('manageRide.markNoShow')}
          </button>
        )}
      </div>
    )}

    {ridePhase === 'in_progress' && booking.status === 'ONBOARD' && (
      <div className="mt-3">
        <button
          type="button"
          onClick={onConfirmDropoff}
          disabled={dropoffLoading}
          className="inline-flex items-center gap-2 rounded-full border border-green-200 px-4 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-40"
        >
          {dropoffLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
          {t('manageRide.confirmDropoff')}
        </button>
      </div>
    )}

    {['NO_SHOW', 'DRIVER_MISSED_PICKUP', 'DROP_PENDING', 'COMPLETED'].includes(booking.status) && (
      <div className="mt-3">
        <button
          type="button"
          onClick={onReportIssue}
          disabled={reportLoading}
          className="inline-flex items-center gap-2 rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
        >
          {reportLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {t('rideDetail.reportIssue')}
        </button>
      </div>
    )}
    </>
  );
}

function formatCountdown(totalSeconds: number, t: (key: string, params?: Record<string, string | number>) => string) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return t('manageRide.countdownHoursMinutes', { hours, minutes });
  if (minutes > 0) return t('manageRide.countdownMinutes', { minutes });
  return t('manageRide.countdownSeconds', { seconds });
}

function promptManualOverride(title: string, body: string) {
  if (typeof window === 'undefined') return null;
  const reason = window.prompt(`${title}\n${body}\n\nEnter a short reason for the override:`, '');
  if (reason === null) return null;
  return reason.trim();
}

// ─── OTP Verification Section ─────────────────────────────────────────────────

function OtpVerifySection({ booking, onVerified }: { booking: DriverRideBooking; onVerified: () => void }) {
  const { t } = useTranslation();
  const [otp, setOtp] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  async function handleVerify() {
    if (otp.length < 4) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      await rideOpsApi.verifyPickupOtp(booking.id, otp);
      setSuccess(t('manageRide.pickupVerified'));
      setOtp('');
      onVerified();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('manageRide.invalidOtp'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-deliivo-dark">{t('manageRide.bookingNumber', { id: booking.id.slice(0, 8) })}</p>
        <span className="text-xs px-3 py-1 rounded-full font-medium bg-deliivo-orange text-white">{t('rideDetail.pickup')}</span>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          maxLength={6}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          placeholder={t('manageRide.enterOtp')}
          className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-center text-lg font-bold tracking-widest focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
        />
        <button
          type="button"
          onClick={handleVerify}
          disabled={loading || otp.length < 6}
          className="btn-primary px-5 py-2.5 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : t('manageRide.verify')}
        </button>
      </div>

      {success && <p className="text-xs text-green-600 font-medium">{success}</p>}
      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
    </div>
  );
}

export default function ManageRidePage() {
  return (
    <ProtectedRoute>
      <ManageRideContent />
    </ProtectedRoute>
  );
}
