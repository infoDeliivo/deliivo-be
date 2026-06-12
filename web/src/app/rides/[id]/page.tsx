'use client';

import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Car,
  Star,
  Loader2,
  AlertCircle,
  CheckCircle,
  Minus,
  Plus,
  MessageSquare,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import GoogleMap from '@/components/GoogleMap';
import { searchRidesApi, bookingsApi, rideOpsApi, ratingsApi, RideDetails, PricePreview, Booking } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { onSocketEvent, LocationUpdate } from '@/lib/socket';

function RideDetailContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const segmentId = searchParams.get('segmentId') || undefined;
  const { user } = useAuth();

  const [ride, setRide] = useState<RideDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking state
  const [seats, setSeats] = useState(1);
  const [preview, setPreview] = useState<PricePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [booked, setBooked] = useState(false);
  const [bookError, setBookError] = useState('');

  // Rider's existing booking for this ride
  const [myBooking, setMyBooking] = useState<Booking | null>(null);
  const [riderActionLoading, setRiderActionLoading] = useState(false);

  // Rating
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingText, setRatingText] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingLoading, setRatingLoading] = useState(false);

  // Live driver location (for passengers)
  const [driverLiveLocation, setDriverLiveLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    loadRide();
    loadMyBooking();
  }, [id]);

  // Subscribe to driver's live location via socket
  useEffect(() => {
    if (!id) return;
    const unsub = onSocketEvent<LocationUpdate>('ride:location', (data) => {
      if (data.rideId === id) {
        setDriverLiveLocation({ lat: data.lat, lng: data.lng });
      }
    });
    // Also try to fetch last known location
    rideOpsApi.getLatestLocation(id).then(res => {
      if (res.data) setDriverLiveLocation({ lat: res.data.lat, lng: res.data.lng });
    }).catch(() => {});
    return unsub;
  }, [id]);

  async function loadMyBooking() {
    try {
      const res = await bookingsApi.list();
      const match = (res.data.bookings || []).find((b: Booking) => b.rideId === id);
      if (match) setMyBooking(match);
    } catch { /* ignore */ }
  }

  async function handleRiderConfirmDropoff() {
    if (!myBooking) return;
    setRiderActionLoading(true);
    try {
      await rideOpsApi.riderConfirmDropoff(myBooking.id);
      loadMyBooking();
    } catch { /* */ }
    finally { setRiderActionLoading(false); }
  }

  async function handleSubmitRating() {
    if (!myBooking || ratingStars === 0) return;
    setRatingLoading(true);
    try {
      await ratingsApi.submitRating(myBooking.id, ratingStars, ratingText || undefined);
      setRatingSubmitted(true);
    } catch { /* */ }
    finally { setRatingLoading(false); }
  }

  async function loadRide() {
    setLoading(true);
    try {
      const res = await searchRidesApi.getDetails(id, segmentId);
      setRide(res.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load ride');
    } finally {
      setLoading(false);
    }
  }

  async function loadPricePreview() {
    if (!ride) return;
    setPreviewLoading(true);
    try {
      const res = await bookingsApi.pricePreview({
        rideId: ride.id,
        seatsBooked: seats,
        segmentId,
        pickupWaypointId: ride.bookingContext?.pickupWaypointId || undefined,
        dropoffWaypointId: ride.bookingContext?.dropoffWaypointId || undefined,
      });
      setPreview(res.data);
    } catch {
      // Preview optional
    } finally {
      setPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (ride) loadPricePreview();
  }, [ride, seats]);

  async function handleBook() {
    if (!ride) return;
    setBooking(true);
    setBookError('');
    try {
      await bookingsApi.create({
        rideId: ride.id,
        segmentId,
        seatsBooked: seats,
        pickupWaypointId: ride.bookingContext?.pickupWaypointId || undefined,
        dropoffWaypointId: ride.bookingContext?.dropoffWaypointId || undefined,
      });
      setBooked(true);
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Booking failed');
    } finally {
      setBooking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deliivo-cream">
        <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
      </div>
    );
  }

  if (error || !ride) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-deliivo-cream px-4">
        <AlertCircle className="h-12 w-12 text-red-400 mb-4" />
        <p className="text-lg font-semibold text-deliivo-dark">{error || 'Ride not found'}</p>
        <Link href="/search" className="btn-primary mt-6 py-2.5 px-8 text-sm">Back to search</Link>
      </div>
    );
  }

  if (booked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-deliivo-cream px-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-500 shadow-xl shadow-green-500/30">
            <CheckCircle className="h-10 w-10 text-white" />
          </div>
          <h1 className="mb-2 text-2xl font-bold text-deliivo-dark">Booking requested!</h1>
          <p className="mb-8 text-deliivo-gray">
            Your booking request has been sent to the driver. You&apos;ll be notified when they respond.
          </p>
          <div className="flex flex-col gap-3">
            <Link href="/rides" className="btn-primary w-full py-3 text-base">View my rides</Link>
            <Link href="/search" className="btn-outline w-full py-3 text-base">Search more rides</Link>
          </div>
        </div>
      </div>
    );
  }

  const driverName = ride.driver?.name || 'Driver';
  const initials = driverName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const vehicleLabel = ride.vehicle ? [ride.vehicle.brand, ride.vehicle.model_name].filter(Boolean).join(' ') : null;
  const dateLabel = new Date(ride.departureDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const durationMin = ride.routeDurationSeconds ? Math.round(ride.routeDurationSeconds / 60) : null;
  const distanceKm = ride.routeDistanceMeters ? (ride.routeDistanceMeters / 1000).toFixed(1) : null;
  const price = ride.segment?.segmentFare ?? ride.basePricePerSeat;
  const isOwnRide = user?.id === ride.driverId;

  return (
    <div className="min-h-screen bg-deliivo-cream">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link href="/search" className="flex items-center gap-1.5 text-sm font-medium text-deliivo-gray hover:text-deliivo-dark">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
          <span className="ml-4 text-sm font-semibold text-deliivo-dark">Ride details</span>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* Route card */}
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="bg-gradient-to-r from-deliivo-orange to-primary-600 px-5 py-4">
            <p className="text-sm text-white/80">{dateLabel} at {ride.departureTime}</p>
            <p className="text-lg font-bold text-white mt-0.5">
              {ride.originAddress.split(',')[0]} → {ride.destinationAddress.split(',')[0]}
            </p>
          </div>

          <div className="p-5 space-y-4">
            {/* Route stops */}
            <div className="flex items-stretch gap-3">
              <div className="flex flex-col items-center gap-1 pt-1">
                <span className="h-3 w-3 rounded-full border-2 border-deliivo-orange bg-white" />
                <span className="w-0.5 flex-1 bg-primary-200" />
                <span className="h-3 w-3 rounded-full bg-deliivo-orange" />
              </div>
              <div className="flex flex-1 flex-col gap-4">
                <div>
                  <p className="text-xs text-deliivo-gray">Pickup</p>
                  <p className="text-sm font-medium text-deliivo-dark">{ride.originAddress}</p>
                </div>
                <div>
                  <p className="text-xs text-deliivo-gray">Drop-off</p>
                  <p className="text-sm font-medium text-deliivo-dark">{ride.destinationAddress}</p>
                </div>
              </div>
            </div>

            {/* Meta info */}
            <div className="flex flex-wrap gap-4 pt-3 border-t border-gray-50 text-xs text-deliivo-gray">
              <span className="flex items-center gap-1"><Calendar size={13} /> {dateLabel}</span>
              <span className="flex items-center gap-1"><Clock size={13} /> {ride.departureTime}</span>
              {durationMin && <span className="flex items-center gap-1"><Clock size={13} /> ~{durationMin} min</span>}
              {distanceKm && <span className="flex items-center gap-1"><MapPin size={13} /> {distanceKm} km</span>}
            </div>
          </div>
        </div>

        {/* Driver card */}
        <div className="rounded-2xl bg-white shadow-sm p-5 flex items-center gap-4">
          <div className="h-14 w-14 shrink-0 rounded-full bg-primary-100 flex items-center justify-center">
            {ride.driver?.avatarUrl ? (
              <img src={ride.driver.avatarUrl} alt={driverName} className="h-full w-full rounded-full object-cover" />
            ) : (
              <span className="text-lg font-semibold text-primary-600">{initials}</span>
            )}
          </div>
          <div className="flex-1">
            <p className="text-base font-semibold text-deliivo-dark">{driverName}</p>
            {ride.driver?.rating && (
              <div className="flex items-center gap-1 mt-0.5">
                <Star size={14} className="fill-amber-400 text-amber-400" />
                <span className="text-sm text-deliivo-gray">{ride.driver.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
          {vehicleLabel && (
            <div className="text-right text-sm">
              <p className="font-medium text-deliivo-dark flex items-center gap-1"><Car size={14} /> {vehicleLabel}</p>
              {ride.vehicle?.color && <p className="text-xs text-deliivo-gray mt-0.5">{ride.vehicle.color}</p>}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="rounded-2xl bg-white shadow-sm p-5 space-y-3">
          <h3 className="text-sm font-semibold text-deliivo-dark">Ride info</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2"><Users size={16} className="text-deliivo-orange" /><span>{ride.availableSeats} of {ride.totalSeats} seats available</span></div>
            <div className="flex items-center gap-2"><span className="text-lg font-bold text-primary-500">{ride.currency} {price.toFixed(2)}</span><span className="text-deliivo-gray">/ seat</span></div>
          </div>
          {ride.notes && (
            <div className="pt-3 border-t border-gray-50">
              <p className="flex items-center gap-2 text-xs font-medium text-deliivo-gray mb-1"><MessageSquare size={12} /> Driver notes</p>
              <p className="text-sm text-deliivo-dark">{ride.notes}</p>
            </div>
          )}
          {ride.femaleOnly && (
            <span className="inline-flex items-center gap-1 rounded-full bg-pink-50 px-3 py-1 text-xs font-semibold text-pink-600">
              <CheckCircle className="h-3 w-3" /> Women only ride
            </span>
          )}
        </div>

        {/* Live driver map — shown when ride is in progress */}
        {!isOwnRide && myBooking && ['IN_PROGRESS', 'CONFIRMED', 'ACCEPTED'].includes(myBooking.status) && driverLiveLocation && (
          <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
                <MapPin size={14} className="text-green-500 animate-pulse" />
                Driver&apos;s live location
              </h3>
            </div>
            <GoogleMap
              liveLocation={driverLiveLocation}
              markers={[
                { lat: ride.waypoints?.[0]?.lat || 0, lng: ride.waypoints?.[0]?.lng || 0, color: 'green' },
                { lat: ride.waypoints?.[ride.waypoints.length - 1]?.lat || 0, lng: ride.waypoints?.[ride.waypoints.length - 1]?.lng || 0, color: 'red' },
              ]}
              center={driverLiveLocation}
              zoom={14}
              className="h-48 w-full"
            />
          </div>
        )}

        {/* Booking section */}
        {!isOwnRide && ride.availableSeats > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark">Book this ride</h3>

            {/* Seat selector */}
            <div className="flex items-center justify-between">
              <span className="text-sm text-deliivo-dark">Seats</span>
              <div className="flex items-center gap-3">
                <button type="button" disabled={seats <= 1} onClick={() => setSeats(s => s - 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 disabled:opacity-30">
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-5 text-center font-bold">{seats}</span>
                <button type="button" disabled={seats >= Math.min(4, ride.availableSeats)} onClick={() => setSeats(s => s + 1)} className="flex h-8 w-8 items-center justify-center rounded-full border border-deliivo-orange bg-deliivo-orange-light text-deliivo-orange disabled:opacity-30">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Price preview */}
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-deliivo-gray"><Loader2 className="h-4 w-4 animate-spin" /> Calculating...</div>
            ) : preview ? (
              <div className="rounded-xl bg-primary-50 border border-primary-100 p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-deliivo-gray">Base fare ({seats} seat{seats > 1 ? 's' : ''})</span><span className="font-medium">{preview.currency} {preview.baseFare.toFixed(2)}</span></div>
                {preview.serviceFee > 0 && <div className="flex justify-between text-sm"><span className="text-deliivo-gray">Service fee</span><span className="font-medium">{preview.currency} {preview.serviceFee.toFixed(2)}</span></div>}
                <div className="flex justify-between text-base font-bold pt-2 border-t border-primary-200"><span>Total</span><span className="text-primary-500">{preview.currency} {preview.total.toFixed(2)}</span></div>
              </div>
            ) : null}

            {bookError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{bookError}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleBook}
              disabled={booking}
              className="btn-primary w-full py-3.5 text-base gap-2 disabled:opacity-60"
            >
              {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
              {booking ? 'Booking...' : `Request to book · ${preview ? `${preview.currency} ${preview.total.toFixed(2)}` : ''}`}
            </button>

            <p className="text-center text-xs text-deliivo-gray">
              The driver will be notified and can accept or decline your request.
            </p>
          </div>
        )}

        {/* Rider booking panel — show OTP, actions */}
        {!isOwnRide && myBooking && !booked && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-deliivo-dark">Your Booking</h3>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                myBooking.status === 'ACCEPTED' || myBooking.status === 'CONFIRMED' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                myBooking.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border border-green-200' :
                'bg-yellow-50 text-yellow-700 border border-yellow-200'
              }`}>{myBooking.status}</span>
            </div>

            {/* OTP Display */}
            {['ACCEPTED', 'CONFIRMED', 'IN_PROGRESS'].includes(myBooking.status) && (myBooking as unknown as { pickupOtp?: string }).pickupOtp && (
              <div className="rounded-xl bg-orange-50 border border-orange-100 p-4">
                <p className="text-xs text-deliivo-gray font-medium mb-1">Pickup OTP — share with driver</p>
                <p className="text-2xl font-bold text-deliivo-orange tracking-widest text-center">
                  {(myBooking as unknown as { pickupOtp: string }).pickupOtp}
                </p>
              </div>
            )}

            {(myBooking as unknown as { dropOtp?: string }).dropOtp && (
              <div className="rounded-xl bg-blue-50 border border-blue-100 p-4">
                <p className="text-xs text-deliivo-gray font-medium mb-1">Drop-off OTP — share with driver</p>
                <p className="text-2xl font-bold text-blue-600 tracking-widest text-center">
                  {(myBooking as unknown as { dropOtp: string }).dropOtp}
                </p>
              </div>
            )}

            {/* Confirm Dropoff */}
            {myBooking.status === 'IN_PROGRESS' && (
              <button
                onClick={handleRiderConfirmDropoff}
                disabled={riderActionLoading}
                className="w-full py-2.5 text-sm font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {riderActionLoading ? 'Confirming...' : 'Confirm I was dropped off'}
              </button>
            )}

            {/* Rating form — after ride completed */}
            {myBooking.status === 'COMPLETED' && !ratingSubmitted && (
              <div className="pt-3 border-t border-gray-100">
                <h4 className="text-sm font-semibold text-deliivo-dark mb-2">Rate this ride</h4>
                <div className="flex gap-1 mb-3">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} type="button" onClick={() => setRatingStars(s)}>
                      <Star className={`w-7 h-7 ${s <= ratingStars ? 'fill-[#F97316] text-[#F97316]' : 'text-gray-200'}`} />
                    </button>
                  ))}
                </div>
                <textarea
                  value={ratingText}
                  onChange={e => setRatingText(e.target.value)}
                  placeholder="Leave a review (optional)..."
                  rows={2}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20 resize-none mb-3"
                />
                <button
                  onClick={handleSubmitRating}
                  disabled={ratingStars === 0 || ratingLoading}
                  className="btn-primary w-full py-2.5 text-sm disabled:opacity-50"
                >
                  {ratingLoading ? 'Submitting...' : 'Submit Rating'}
                </button>
              </div>
            )}

            {ratingSubmitted && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <CheckCircle className="h-4 w-4 text-green-600" />
                <p className="text-sm text-green-700 font-medium">Rating submitted! Thank you.</p>
              </div>
            )}
          </div>
        )}

        {isOwnRide && (
          <div className="rounded-2xl bg-primary-50 border border-primary-100 p-5 text-center">
            <p className="text-sm font-medium text-deliivo-dark">This is your ride</p>
            <p className="text-xs text-deliivo-gray mt-1">You can manage it from the My Rides page.</p>
            <Link href="/rides" className="btn-outline mt-3 py-2 px-6 text-sm inline-block">My Rides</Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function RideDetailPage() {
  return (
    <ProtectedRoute>
      <RideDetailContent />
    </ProtectedRoute>
  );
}
