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
  Radio,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import GoogleMap from '@/components/GoogleMap';
import { searchRidesApi, bookingsApi, driverBookingApi, rideOpsApi, RideDetails, Booking } from '@/lib/api';
import { getSocket, onSocketEvent, LocationUpdate } from '@/lib/socket';

type RidePhase = 'loading' | 'published' | 'in_progress' | 'completed' | 'error';

function ManageRideContent() {
  const { id } = useParams<{ id: string }>();

  const [ride, setRide] = useState<RideDetails | null>(null);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [phase, setPhase] = useState<RidePhase>('loading');
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState('');

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

  useEffect(() => { if (id) loadData(); }, [id]);

  async function loadData() {
    setPhase('loading');
    try {
      const rideRes = await searchRidesApi.getDetails(id);
      setRide(rideRes.data);

      // Determine phase from status
      const status = rideRes.data.status;
      if (status === 'COMPLETED') setPhase('completed');
      else if (status === 'IN_PROGRESS') setPhase('in_progress');
      else setPhase('published');

      // Load bookings for this ride
      try {
        const bookRes = await bookingsApi.list(undefined, 1, 50);
        // Filter to this ride's bookings (the API might not filter by rideId)
        const rideBookings = (bookRes.data.bookings || []).filter(b => b.rideId === id);
        setBookings(rideBookings);
      } catch {
        // Bookings load is best-effort
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load ride');
      setPhase('error');
    }
  }

  async function handleStartRide() {
    setActionLoading('start');
    try {
      await rideOpsApi.startRide(id);
      setPhase('in_progress');
      if (ride) setRide({ ...ride, status: 'IN_PROGRESS' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start ride');
    } finally {
      setActionLoading('');
    }
  }

  async function handleFinishRide() {
    setActionLoading('finish');
    try {
      await rideOpsApi.finishRide(id);
      setPhase('completed');
      if (ride) setRide({ ...ride, status: 'COMPLETED' });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to finish ride');
    } finally {
      setActionLoading('');
    }
  }

  async function handleAcceptBooking(bookingId: string) {
    setActionLoading(`accept-${bookingId}`);
    try {
      await driverBookingApi.accept(bookingId);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'CONFIRMED' } : b));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to accept');
    } finally {
      setActionLoading('');
    }
  }

  async function handleRejectBooking(bookingId: string) {
    setActionLoading(`reject-${bookingId}`);
    try {
      await driverBookingApi.reject(bookingId);
      setBookings(prev => prev.map(b => b.id === bookingId ? { ...b, status: 'REJECTED' } : b));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to reject');
    } finally {
      setActionLoading('');
    }
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
        <p className="text-lg font-semibold text-deliivo-dark">{error || 'Ride not found'}</p>
        <Link href="/rides" className="btn-primary mt-6 py-2.5 px-8 text-sm">Back to rides</Link>
      </div>
    );
  }

  const dateLabel = new Date(ride.departureDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const pendingBookings = bookings.filter(b => b.status === 'PENDING' || b.status === 'DRIVER_PENDING');
  const confirmedBookings = bookings.filter(b => ['CONFIRMED', 'ACCEPTED', 'ONBOARD', 'DRIVER_ARRIVED'].includes(b.status));

  return (
    <div className="min-h-screen bg-deliivo-cream">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link href="/rides" className="flex items-center gap-1.5 text-sm font-medium text-deliivo-gray hover:text-deliivo-dark">
            <ArrowLeft className="h-4 w-4" /> My Rides
          </Link>
          <span className="ml-4 text-sm font-semibold text-deliivo-dark">Manage Ride</span>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Ride status card */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className={`px-5 py-4 ${phase === 'in_progress' ? 'bg-gradient-to-r from-green-500 to-green-600' : phase === 'completed' ? 'bg-gradient-to-r from-gray-500 to-gray-600' : 'bg-gradient-to-r from-deliivo-orange to-primary-600'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-white/80">{dateLabel} at {ride.departureTime}</p>
                <p className="text-lg font-bold text-white mt-0.5">
                  {ride.originAddress.split(',')[0]} → {ride.destinationAddress.split(',')[0]}
                </p>
              </div>
              <span className={`text-xs font-bold px-3 py-1.5 rounded-full ${phase === 'in_progress' ? 'bg-white/20 text-white' : phase === 'completed' ? 'bg-white/20 text-white' : 'bg-white/20 text-white'}`}>
                {phase === 'in_progress' ? 'IN PROGRESS' : phase === 'completed' ? 'COMPLETED' : 'PUBLISHED'}
              </span>
            </div>
          </div>

          <div className="p-5">
            <div className="flex flex-wrap gap-4 text-xs text-deliivo-gray">
              <span className="flex items-center gap-1"><Calendar size={13} /> {dateLabel}</span>
              <span className="flex items-center gap-1"><Clock size={13} /> {ride.departureTime}</span>
              <span className="flex items-center gap-1"><Users size={13} /> {ride.availableSeats}/{ride.totalSeats} available</span>
              <span className="flex items-center gap-1"><MapPin size={13} /> {ride.currency} {ride.basePricePerSeat.toFixed(2)}/seat</span>
            </div>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={() => setError('')} className="ml-auto text-red-400 hover:text-red-600">&times;</button>
          </div>
        )}

        {/* Live map — shown when ride in progress */}
        {phase === 'in_progress' && (
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
                <Radio size={14} className={tracking ? 'text-green-500 animate-pulse' : 'text-gray-400'} />
                Live Location
              </h3>
              {tracking ? (
                <span className="text-xs text-green-600 font-medium">Sharing location</span>
              ) : (
                <button onClick={startTracking} className="text-xs text-deliivo-orange font-medium hover:underline">
                  Start sharing
                </button>
              )}
            </div>
            <GoogleMap
              liveLocation={driverLocation}
              markers={[
                ...(ride.waypoints?.filter(w => w.waypointType === 'ORIGIN').map(w => ({ lat: w.lat, lng: w.lng, color: 'green' as const })) || []),
                ...(ride.waypoints?.filter(w => w.waypointType === 'DESTINATION').map(w => ({ lat: w.lat, lng: w.lng, color: 'red' as const })) || []),
              ]}
              center={driverLocation || (ride.waypoints?.[0] ? { lat: ride.waypoints[0].lat, lng: ride.waypoints[0].lng } : undefined)}
              zoom={13}
              className="h-56 w-full"
            />
          </div>
        )}

        {/* Ride actions */}
        {phase === 'published' && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <Play size={16} className="text-green-500" /> Ready to start?
            </h3>
            <p className="text-xs text-deliivo-gray">When you&apos;re ready to begin the trip, start the ride. Passengers will be notified.</p>
            <button
              type="button"
              onClick={handleStartRide}
              disabled={actionLoading === 'start'}
              className="btn-primary w-full py-3 text-base gap-2 bg-green-500 hover:bg-green-600 disabled:opacity-60"
            >
              {actionLoading === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-5 w-5" />}
              Start Ride
            </button>
          </div>
        )}

        {phase === 'in_progress' && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <Navigation size={16} className="text-green-500" /> Ride in progress
            </h3>
            <p className="text-xs text-deliivo-gray">Your ride is active. Manage pickups and drop-offs below, then finish when done.</p>
            <button
              type="button"
              onClick={handleFinishRide}
              disabled={actionLoading === 'finish'}
              className="btn-primary w-full py-3 text-base gap-2 disabled:opacity-60"
            >
              {actionLoading === 'finish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
              Finish Ride
            </button>
          </div>
        )}

        {phase === 'completed' && (
          <div className="rounded-2xl bg-green-50 border border-green-200 p-5 text-center">
            <CheckCircle className="h-10 w-10 text-green-500 mx-auto mb-2" />
            <p className="text-base font-semibold text-green-800">Ride completed!</p>
            <p className="text-sm text-green-600 mt-1">All passengers have been dropped off.</p>
          </div>
        )}

        {/* Pending booking requests */}
        {pendingBookings.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-500" /> Pending requests ({pendingBookings.length})
            </h3>
            <div className="space-y-3">
              {pendingBookings.map(booking => (
                <BookingRequestCard
                  key={booking.id}
                  booking={booking}
                  onAccept={() => handleAcceptBooking(booking.id)}
                  onReject={() => handleRejectBooking(booking.id)}
                  loading={actionLoading === `accept-${booking.id}` || actionLoading === `reject-${booking.id}`}
                />
              ))}
            </div>
          </div>
        )}

        {/* Confirmed passengers */}
        {confirmedBookings.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <UserCheck size={16} className="text-green-500" /> Passengers ({confirmedBookings.length})
            </h3>
            <div className="space-y-3">
              {confirmedBookings.map(booking => (
                <PassengerCard
                  key={booking.id}
                  booking={booking}
                  ridePhase={phase}
                />
              ))}
            </div>
          </div>
        )}

        {/* OTP section for in_progress */}
        {phase === 'in_progress' && confirmedBookings.length > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <KeyRound size={16} className="text-deliivo-orange" /> OTP Verification
            </h3>
            <p className="text-xs text-deliivo-gray">
              Enter the OTP shown on your passenger&apos;s app to verify pickup/drop-off.
            </p>
            {confirmedBookings.map(booking => (
              <OtpVerifySection key={booking.id} booking={booking} />
            ))}
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
  booking: Booking;
  onAccept: () => void;
  onReject: () => void;
  loading: boolean;
}) {
  const riderName = booking.ride?.driver?.name || 'Passenger';

  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
      <div>
        <p className="text-sm font-semibold text-deliivo-dark">{riderName}</p>
        <p className="text-xs text-deliivo-gray">{booking.seatsBooked} seat{booking.seatsBooked > 1 ? 's' : ''} requested</p>
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
          Accept
        </button>
      </div>
    </div>
  );
}

// ─── Passenger Card ───────────────────────────────────────────────────────────

function PassengerCard({ booking, ridePhase }: { booking: Booking; ridePhase: RidePhase }) {
  const statusLabel: Record<string, string> = {
    CONFIRMED: 'Confirmed',
    ACCEPTED: 'Accepted',
    DRIVER_ARRIVED: 'Waiting at pickup',
    ONBOARD: 'On board',
  };

  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 p-4">
      <div>
        <p className="text-sm font-semibold text-deliivo-dark">
          Passenger
        </p>
        <p className="text-xs text-deliivo-gray">
          {booking.seatsBooked} seat{booking.seatsBooked > 1 ? 's' : ''} &middot; {statusLabel[booking.status] || booking.status}
        </p>
      </div>
      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
        booking.status === 'ONBOARD' ? 'bg-green-50 text-green-700 border border-green-200'
        : booking.status === 'DRIVER_ARRIVED' ? 'bg-amber-50 text-amber-700 border border-amber-200'
        : 'bg-blue-50 text-blue-700 border border-blue-200'
      }`}>
        {statusLabel[booking.status] || booking.status}
      </span>
    </div>
  );
}

// ─── OTP Verification Section ─────────────────────────────────────────────────

function OtpVerifySection({ booking }: { booking: Booking }) {
  const [otp, setOtp] = useState('');
  const [mode, setMode] = useState<'pickup' | 'dropoff'>('pickup');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  async function handleVerify() {
    if (otp.length < 4) return;
    setLoading(true);
    setError('');
    setSuccess('');
    try {
      if (mode === 'pickup') {
        await driverBookingApi.verifyPickupOtp(booking.id, otp);
        setSuccess('Pickup verified! Passenger boarded.');
      } else {
        await driverBookingApi.verifyDropOtp(booking.id, otp);
        setSuccess('Drop-off verified! Passenger delivered.');
      }
      setOtp('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid OTP');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-deliivo-dark">Booking #{booking.id.slice(0, 8)}</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => { setMode('pickup'); setSuccess(''); setError(''); }}
            className={`text-xs px-3 py-1 rounded-full font-medium ${mode === 'pickup' ? 'bg-deliivo-orange text-white' : 'bg-gray-100 text-deliivo-gray'}`}
          >
            Pickup
          </button>
          <button
            type="button"
            onClick={() => { setMode('dropoff'); setSuccess(''); setError(''); }}
            className={`text-xs px-3 py-1 rounded-full font-medium ${mode === 'dropoff' ? 'bg-deliivo-orange text-white' : 'bg-gray-100 text-deliivo-gray'}`}
          >
            Drop-off
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          placeholder="Enter 4-digit OTP"
          className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-center text-lg font-bold tracking-widest focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
        />
        <button
          type="button"
          onClick={handleVerify}
          disabled={loading || otp.length < 4}
          className="btn-primary px-5 py-2.5 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Verify'}
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
