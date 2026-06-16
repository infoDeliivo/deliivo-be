'use client';

import { FormEvent, useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MapPin,
  Calendar,
  Clock,
  Users,
  Car,
  CreditCard,
  Star,
  Loader2,
  AlertCircle,
  CheckCircle,
  Minus,
  Plus,
  MessageSquare,
  Share2,
} from 'lucide-react';
import { CardElement, useElements, useStripe } from '@stripe/react-stripe-js';
import ProtectedRoute from '@/components/ProtectedRoute';
import GoogleMap from '@/components/GoogleMap';
import { authApi, searchRidesApi, bookingsApi, rideOpsApi, ratingsApi, trackingApi, disputesApi, paymentMethodsApi, RideDetails, PricePreview, Booking, TrackingLink, Dispute, PaymentMethod } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { emitSocketEvent, getSocket, onSocketEvent, LocationUpdate, NotificationPayload, BookingUpdatedPayload, RideUpdatedPayload } from '@/lib/socket';
import { isStripeConfigured, StripeProvider } from '@/lib/stripe';

const TOS_VERSION = '1.0';
const PRIVACY_VERSION = '1.0';

const REQUEST_EXPIRY_OPTIONS = [
  { value: 'ONE_HOUR', label: '1 hour' },
  { value: 'THREE_HOURS', label: '3 hours' },
  { value: 'SIX_HOURS', label: '6 hours' },
  { value: 'TWELVE_HOURS', label: '12 hours' },
  { value: 'TWENTY_FOUR_HOURS', label: '24 hours' },
  { value: 'BEFORE_DEPARTURE', label: 'Before departure' },
] as const;

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const earthRadius = 6371e3;
  const toRad = (value: number) => value * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function etaLabel(from: { lat: number; lng: number } | null, to: { lat: number; lng: number } | null) {
  if (!from || !to) return null;
  const minutes = Math.max(1, Math.round((distanceMeters(from, to) / 1000) / 35 * 60));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function RideDetailContent() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const segmentId = searchParams.get('segmentId') || undefined;
  const { user, refreshUser } = useAuth();
  const stripe = useStripe();

  const [ride, setRide] = useState<RideDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Booking state
  const [seats, setSeats] = useState(1);
  const [preview, setPreview] = useState<PricePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [booking, setBooking] = useState(false);
  const [bookError, setBookError] = useState('');
  const [paymentMessage, setPaymentMessage] = useState('');
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(false);
  const [selectedPaymentMethodId, setSelectedPaymentMethodId] = useState('');
  const [showAddPaymentMethod, setShowAddPaymentMethod] = useState(false);
  const [tosAcceptedForBooking, setTosAcceptedForBooking] = useState(false);
  const [responseExpiryOption, setResponseExpiryOption] = useState<'ONE_HOUR' | 'THREE_HOURS' | 'SIX_HOURS' | 'TWELVE_HOURS' | 'TWENTY_FOUR_HOURS' | 'BEFORE_DEPARTURE'>('BEFORE_DEPARTURE');

  // Rider's existing booking for this ride
  const [myBooking, setMyBooking] = useState<Booking | null>(null);
  const [riderActionLoading, setRiderActionLoading] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');
  const [pickupArrivalLoading, setPickupArrivalLoading] = useState(false);
  const [pickupArrivalMessage, setPickupArrivalMessage] = useState('');
  const [dropoffMessage, setDropoffMessage] = useState('');
  const [trackingLinks, setTrackingLinks] = useState<TrackingLink[]>([]);
  const [trackingBusy, setTrackingBusy] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState('');

  // Rating
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingText, setRatingText] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingLoading, setRatingLoading] = useState(false);

  // Disputes / reports
  const [missedPickupLoading, setMissedPickupLoading] = useState(false);
  const [disputeReason, setDisputeReason] = useState('NO_SHOW');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [disputeLoading, setDisputeLoading] = useState(false);
  const [disputeMessage, setDisputeMessage] = useState('');
  const [myDisputes, setMyDisputes] = useState<Dispute[]>([]);

  // Live driver location (for passengers)
  const [driverLiveLocation, setDriverLiveLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!id) return;
    loadRide();
    loadMyBooking();
    loadPaymentMethods();
  }, [id]);

  useEffect(() => {
    if (!myBooking) {
      setTrackingLinks([]);
      setMyDisputes([]);
      return;
    }
    loadTrackingLinks(myBooking.id);
    loadMyDisputes(myBooking.id);
  }, [myBooking?.id]);

  useEffect(() => {
    if (!id || !user) return;
    const socket = getSocket();
    const joinRideRoom = () => socket?.emit('ride:join', { rideId: id });
    joinRideRoom();
    socket?.on('connect', joinRideRoom);
    return () => {
      socket?.off('connect', joinRideRoom);
      emitSocketEvent('ride:leave', { rideId: id });
    };
  }, [id, user?.id]);

  useEffect(() => {
    if (!id || !user) return;

    const unsub = onSocketEvent<NotificationPayload>('notification:new', (payload) => {
      const rideId = payload.data.data?.rideId;
      const bookingId = payload.data.data?.bookingId;

      if (rideId === id || bookingId === myBooking?.id) {
        loadRide();
        loadMyBooking();
      }
    });

    return unsub;
  }, [id, myBooking?.id, user?.id]);

  useEffect(() => {
    if (!id || !user) return;
    getSocket();

    const unsubBooking = onSocketEvent<BookingUpdatedPayload>('booking:updated', (payload) => {
      if (payload.rideId !== id && payload.bookingId !== myBooking?.id) return;

      setMyBooking((prev) =>
        prev && prev.id === payload.bookingId
          ? {
              ...prev,
              status: payload.status,
              displayStatus: payload.status,
              updatedAt: payload.updatedAt,
            }
          : prev
      );
    });

    const unsubRide = onSocketEvent<RideUpdatedPayload>('ride:updated', (payload) => {
      if (payload.rideId !== id) return;

      setRide((prev) =>
        prev
          ? {
              ...prev,
              status: payload.status,
            }
          : prev
      );
      setMyBooking((prev) =>
        prev?.ride
          ? {
              ...prev,
              ride: { ...prev.ride, status: payload.status },
            }
          : prev
      );
    });

    return () => {
      unsubBooking();
      unsubRide();
    };
  }, [id, myBooking?.id, user?.id]);

  // Subscribe to driver's live location via socket
  useEffect(() => {
    if (!id || !user) return;
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
  }, [id, user?.id]);

  async function loadMyBooking() {
    try {
      const res = await bookingsApi.list();
      const match = (res.data.bookings || []).find((b: Booking) => b.rideId === id);
      if (!match) {
        setMyBooking(null);
        return;
      }

      const detail = await bookingsApi.getById(match.id);
      setMyBooking(detail.data || match);
    } catch {
      setMyBooking(null);
    }
  }

  async function loadTrackingLinks(bookingId: string) {
    try {
      const res = await trackingApi.listLinks(bookingId);
      setTrackingLinks(res.data || []);
    } catch {
      setTrackingLinks([]);
    }
  }

  async function loadMyDisputes(bookingId: string) {
    try {
      const res = await disputesApi.getMyDisputes();
      setMyDisputes((res.data || []).filter((dispute) => dispute.bookingId === bookingId));
    } catch {
      setMyDisputes([]);
    }
  }

  async function loadPaymentMethods(selectId?: string) {
    setPaymentMethodsLoading(true);
    try {
      const res = await paymentMethodsApi.list();
      const methods = res.data || [];
      setPaymentMethods(methods);
      const nextSelected = selectId
        || methods.find((method) => method.isDefault)?.id
        || methods[0]?.id
        || '';
      setSelectedPaymentMethodId(nextSelected);
      if (methods.length > 0) setShowAddPaymentMethod(false);
    } catch {
      setPaymentMethods([]);
      setSelectedPaymentMethodId('');
    } finally {
      setPaymentMethodsLoading(false);
    }
  }

  function trackingUrlFor(link: TrackingLink) {
    const path = link.trackingUrl || `/tracking/${link.token}`;
    if (typeof window === 'undefined') return path;
    return new URL(path, window.location.origin).toString();
  }

  async function handleCreateTrackingLink() {
    if (!myBooking) return;
    setTrackingBusy(true);
    setTrackingMessage('');
    try {
      const res = await trackingApi.createLink(myBooking.id, 24);
      const nextLinks = [res.data, ...trackingLinks];
      setTrackingLinks(nextLinks);
      const url = trackingUrlFor(res.data);
      await navigator.clipboard?.writeText(url);
      setTrackingMessage('Live sharing link copied.');
    } catch (err: unknown) {
      setTrackingMessage(err instanceof Error ? err.message : 'Failed to create tracking link');
    } finally {
      setTrackingBusy(false);
    }
  }

  async function handleCopyTrackingLink(link: TrackingLink) {
    try {
      await navigator.clipboard?.writeText(trackingUrlFor(link));
      setTrackingMessage('Live sharing link copied.');
    } catch {
      setTrackingMessage(trackingUrlFor(link));
    }
  }

  async function handleRiderConfirmDropoff() {
    if (!myBooking) return;
    setRiderActionLoading(true);
    setDropoffMessage('');
    setBookError('');
    try {
      await rideOpsApi.riderConfirmDropoff(myBooking.id);
      setDropoffMessage('Drop-off confirmed. Thanks for confirming the ride completion.');
      await loadMyBooking();
      await loadRide();
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Failed to confirm drop-off');
    } finally {
      setRiderActionLoading(false);
    }
  }

  function getBookedPickupPoint() {
    const segment = myBooking?.segmentRide;
    if (segment?.originLat != null && segment?.originLng != null) {
      return { lat: segment.originLat, lng: segment.originLng };
    }
    const fullRide = myBooking?.fullRide || myBooking?.ride;
    if (fullRide && 'originLat' in fullRide && 'originLng' in fullRide) {
      const originLat = (fullRide as { originLat?: number }).originLat;
      const originLng = (fullRide as { originLng?: number }).originLng;
      if (originLat != null && originLng != null) return { lat: originLat, lng: originLng };
    }
    return null;
  }

  function getBookedDropoffPoint() {
    const segment = myBooking?.segmentRide;
    if (segment?.destinationLat != null && segment?.destinationLng != null) {
      return { lat: segment.destinationLat, lng: segment.destinationLng };
    }
    const fullRide = myBooking?.fullRide || myBooking?.ride;
    if (fullRide && 'destinationLat' in fullRide && 'destinationLng' in fullRide) {
      const destinationLat = (fullRide as { destinationLat?: number }).destinationLat;
      const destinationLng = (fullRide as { destinationLng?: number }).destinationLng;
      if (destinationLat != null && destinationLng != null) return { lat: destinationLat, lng: destinationLng };
    }
    return null;
  }

  async function getCurrentPositionOrNull() {
    return new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
      );
    });
  }

  async function handleRiderArrivedAtPickup(simulate = false) {
    if (!myBooking) return;
    setPickupArrivalLoading(true);
    setPickupArrivalMessage('');
    setBookError('');
    try {
      const position = simulate
        ? getBookedPickupPoint()
        : await getCurrentPositionOrNull();
      await rideOpsApi.riderArrivedAtPickup(myBooking.id, position?.lat, position?.lng);
      setPickupArrivalMessage(simulate ? 'Pickup arrival simulated.' : 'Pickup arrival recorded.');
      await loadMyBooking();
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Failed to record arrival');
    } finally {
      setPickupArrivalLoading(false);
    }
  }

  async function handleReportMissedPickup(simulate = false) {
    if (!myBooking) return;
    setMissedPickupLoading(true);
    setPickupArrivalMessage('');
    setBookError('');
    try {
      const position = simulate ? getBookedPickupPoint() : await getCurrentPositionOrNull();
      await rideOpsApi.reportMissedPickup(myBooking.id, position?.lat, position?.lng);
      setPickupArrivalMessage('Missed pickup report submitted. You can add a dispute note below if support needs more detail.');
      setMyBooking((prev) => prev ? { ...prev, status: 'DRIVER_MISSED_PICKUP', displayStatus: 'DRIVER_MISSED_PICKUP' } : prev);
      setDisputeReason('DRIVER_MISSED_PICKUP');
      await loadMyBooking();
      await loadRide();
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Failed to report missed pickup');
    } finally {
      setMissedPickupLoading(false);
    }
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

  async function handleCreateDispute() {
    if (!myBooking || !ride) return;
    setDisputeLoading(true);
    setDisputeMessage('');
    setBookError('');
    try {
      await disputesApi.create({
        rideId: ride.id,
        bookingId: myBooking.id,
        reason: disputeReason,
        description: disputeDescription.trim() || undefined,
      });
      setDisputeMessage('Report submitted. Support can review the ride, booking, event, and location evidence.');
      setDisputeDescription('');
      await loadMyDisputes(myBooking.id);
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Failed to submit report');
    } finally {
      setDisputeLoading(false);
    }
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

  async function confirmStripeBookingPayment(targetBooking: Booking) {
    if (!targetBooking.payment?.clientSecret) return targetBooking;

    if (!isStripeConfigured() || !stripe) {
      throw new Error('Payment intent was created, but Stripe is not configured in the web app. Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and rebuild web.');
    }

    const selectedMethod = paymentMethods.find((method) => method.id === selectedPaymentMethodId);
    if (!selectedMethod?.stripePaymentMethodId) {
      throw new Error('Add or select a saved card before booking this ride.');
    }

    setPaymentMessage('Confirming card payment...');
    const { error: stripeError, paymentIntent } = await stripe.confirmCardPayment(
      targetBooking.payment.clientSecret,
      { payment_method: selectedMethod.stripePaymentMethodId }
    );

    if (stripeError) {
      throw new Error(stripeError.message || 'Card payment failed. Please check the card details and try again.');
    }

    if (paymentIntent && ['succeeded', 'processing', 'requires_capture'].includes(paymentIntent.status)) {
      setPaymentMessage('Payment confirmed. Waiting for driver response.');
      try {
        const refreshed = await bookingsApi.confirmPayment(targetBooking.id);
        return refreshed.data || targetBooking;
      } catch {
        await loadMyBooking();
        return targetBooking;
      }
    }

    setPaymentMessage(`Payment status: ${paymentIntent?.status || 'pending'}.`);
    return targetBooking;
  }

  async function handleBook() {
    if (!ride) return;
    if (isStripeConfigured() && paymentMethods.length === 0) {
      setBookError('Add a payment card before booking this ride.');
      setShowAddPaymentMethod(true);
      return;
    }
    if (isStripeConfigured() && !selectedPaymentMethodId) {
      setBookError('Select a payment card before booking this ride.');
      return;
    }
    setBooking(true);
    setBookError('');
    setPaymentMessage('');
    try {
      if (needsTosAcceptance) {
        await authApi.acceptTos(TOS_VERSION, PRIVACY_VERSION);
        await refreshUser();
      }
      const res = await bookingsApi.create({
        rideId: ride.id,
        segmentId,
        seatsBooked: seats,
        pickupWaypointId: ride.bookingContext?.pickupWaypointId || undefined,
        dropoffWaypointId: ride.bookingContext?.dropoffWaypointId || undefined,
        responseExpiryOption,
      });
      const createdBooking = res.data;
      setMyBooking(createdBooking);

      if (createdBooking.payment?.clientSecret) {
        const confirmedBooking = await confirmStripeBookingPayment(createdBooking);
        setMyBooking(confirmedBooking);
      } else {
        setPaymentMessage('Booking request sent. Waiting for driver response.');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Booking failed';
      setBookError(message.includes('TOS_NOT_ACCEPTED')
        ? 'You must accept the Terms of Service before booking this ride.'
        : message);
      setPaymentMessage('');
    } finally {
      setBooking(false);
    }
  }

  async function handleRetryPayment() {
    if (!myBooking) return;
    setBooking(true);
    setBookError('');
    setPaymentMessage('');
    try {
      const confirmedBooking = await confirmStripeBookingPayment(myBooking);
      setMyBooking(confirmedBooking);
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Payment failed');
      setPaymentMessage('');
    } finally {
      setBooking(false);
    }
  }

  async function handleWithdrawBooking() {
    if (!myBooking) return;
    setRiderActionLoading(true);
    try {
      await bookingsApi.cancel(myBooking.id, withdrawReason.trim() || undefined);
      loadMyBooking();
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Failed to cancel booking');
    } finally {
      setRiderActionLoading(false);
    }
  }

  async function handleCancelBooking() {
    if (!myBooking) return;
    setRiderActionLoading(true);
    try {
      await bookingsApi.cancel(myBooking.id);
      loadMyBooking();
    } catch (err: unknown) {
      setBookError(err instanceof Error ? err.message : 'Failed to cancel booking');
    } finally {
      setRiderActionLoading(false);
    }
  }

  function formatDeadline(deadline?: Booking['decisionDeadline']) {
    if (!deadline) return '';
    if (deadline.isExpired) return 'Expired';
    const seconds = Math.max(0, Math.floor(deadline.timeRemainingSeconds));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m remaining`;
    if (minutes > 0) return `${minutes}m remaining`;
    return `${seconds}s remaining`;
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

  const driverName = ride.driver?.name || 'Driver';
  const initials = driverName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const vehicleLabel = ride.vehicle ? [ride.vehicle.brand, ride.vehicle.model_name].filter(Boolean).join(' ') : null;
  const dateLabel = new Date(ride.departureDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const durationMin = ride.routeDurationSeconds ? Math.round(ride.routeDurationSeconds / 60) : null;
  const distanceKm = ride.routeDistanceMeters ? (ride.routeDistanceMeters / 1000).toFixed(1) : null;
  const price = ride.segment?.segmentFare ?? ride.basePricePerSeat;
  const previewBreakdown = preview?.priceBreakdown;
  const isOwnRide = user?.id === ride.driverId;
  const needsTosAcceptance = !user?.tosAcceptedAt || !user?.privacyAcceptedAt;
  const allowRideSimulation = process.env.NEXT_PUBLIC_ALLOW_RIDE_SIMULATION === 'true';
  const routeWaypoints = [...(ride.waypoints || [])].sort((a, b) => a.orderIndex - b.orderIndex);
  const routeMarkers = routeWaypoints.length >= 2
    ? [
        { lat: routeWaypoints[0].lat, lng: routeWaypoints[0].lng, color: 'green' as const },
        { lat: routeWaypoints[routeWaypoints.length - 1].lat, lng: routeWaypoints[routeWaypoints.length - 1].lng, color: 'red' as const },
      ]
    : [];
  const pickupEta = etaLabel(driverLiveLocation, getBookedPickupPoint());
  const dropoffEta = etaLabel(driverLiveLocation, getBookedDropoffPoint());
  const isTrackableBooking = myBooking && ['IN_PROGRESS', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED', 'ONBOARD', 'DROP_PENDING'].includes(myBooking.status);
  const rateableBookingStatuses = ['COMPLETED', 'NO_SHOW', 'DRIVER_MISSED_PICKUP'];
  const disputeEligibleStatuses = ['NO_SHOW', 'DRIVER_MISSED_PICKUP', 'DROP_PENDING', 'COMPLETED', 'DISPUTED'];
  const openDispute = myDisputes.find((dispute) => ['OPEN', 'EVIDENCE_COLLECTED', 'NEEDS_MANUAL_REVIEW', 'WAITING_FOR_USER_RESPONSE', 'ESCALATED'].includes(dispute.status));

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

      {(routeMarkers.length > 0 || driverLiveLocation) && (
        <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-deliivo-dark flex items-center gap-2">
              <MapPin size={14} className={driverLiveLocation ? 'text-green-500 animate-pulse' : 'text-deliivo-orange'} />
              {driverLiveLocation ? 'Route and live driver location' : 'Route map'}
            </h3>
            {isTrackableBooking && (
              <span className="text-xs font-medium text-deliivo-gray">
                {driverLiveLocation ? 'Live' : 'Waiting for live location'}
              </span>
            )}
          </div>
          <GoogleMap
            markers={routeMarkers}
            liveLocation={driverLiveLocation}
            center={driverLiveLocation || (routeMarkers[0] ? { lat: routeMarkers[0].lat, lng: routeMarkers[0].lng } : { lat: 56.95, lng: 24.11 })}
            zoom={12}
            className="h-56 w-full"
          />
          {!driverLiveLocation && isTrackableBooking && (
            <div className="border-t border-gray-100 px-5 py-3 text-xs text-deliivo-gray">
              Waiting for the driver to start location sharing.
            </div>
          )}
          {isTrackableBooking && (
            <div className="grid gap-3 border-t border-gray-100 px-5 py-3 text-xs sm:grid-cols-2">
              <div>
                <p className="font-semibold text-deliivo-dark">ETA to pickup</p>
                <p className="mt-0.5 text-deliivo-gray">{pickupEta || 'Waiting for driver location'}</p>
              </div>
              <div>
                <p className="font-semibold text-deliivo-dark">ETA to drop-off</p>
                <p className="mt-0.5 text-deliivo-gray">{dropoffEta || 'Available after live location'}</p>
              </div>
            </div>
          )}
        </div>
      )}

        {/* Live driver map — shown when ride is in progress */}
        {/* Booking section */}
        {!isOwnRide && !myBooking && ride.availableSeats > 0 && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-semibold text-deliivo-dark">Book this ride</h3>

            {needsTosAcceptance && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-900">Accept the Terms of Service and Privacy Policy to continue.</p>
                <label className="flex items-start gap-3 text-sm text-amber-900">
                  <input
                    type="checkbox"
                    checked={tosAcceptedForBooking}
                    onChange={(e) => setTosAcceptedForBooking(e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-amber-300 text-deliivo-orange focus:ring-deliivo-orange"
                  />
                  <span>
                    I accept the <Link href="/terms" className="underline">Terms of Service</Link> and{' '}
                    <Link href="/privacy" className="underline">Privacy Policy</Link> for this booking.
                  </span>
                </label>
              </div>
            )}

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

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-deliivo-dark">Request expires</span>
              <select
                value={responseExpiryOption}
                onChange={(e) => setResponseExpiryOption(e.target.value as typeof responseExpiryOption)}
                className="min-w-44 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-deliivo-dark focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
              >
                {REQUEST_EXPIRY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>

            {isStripeConfigured() ? (
              <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <CreditCard className="h-4 w-4 text-deliivo-orange" />
                    <p className="text-sm font-semibold text-deliivo-dark">Payment card</p>
                  </div>
                  {paymentMethods.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowAddPaymentMethod((value) => !value)}
                      className="text-xs font-semibold text-deliivo-orange hover:underline"
                    >
                      {showAddPaymentMethod ? 'Use saved card' : 'Add another'}
                    </button>
                  )}
                </div>

                {paymentMethodsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-deliivo-gray">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading cards...
                  </div>
                ) : paymentMethods.length > 0 && !showAddPaymentMethod ? (
                  <div className="space-y-2">
                    {paymentMethods.map((method) => (
                      <label
                        key={method.id}
                        className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition-colors ${
                          selectedPaymentMethodId === method.id
                            ? 'border-deliivo-orange bg-deliivo-orange-light'
                            : 'border-gray-200 hover:border-deliivo-orange/50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="bookingPaymentMethod"
                          checked={selectedPaymentMethodId === method.id}
                          onChange={() => setSelectedPaymentMethodId(method.id)}
                          className="h-4 w-4 border-gray-300 text-deliivo-orange focus:ring-deliivo-orange"
                        />
                        <CreditCard className="h-4 w-4 text-deliivo-gray" />
                        <span className="flex-1 text-sm font-medium text-deliivo-dark">
                          {method.brand} **** {method.last4}
                        </span>
                        <span className="text-xs text-deliivo-gray">
                          {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                        </span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <RideAddPaymentMethodForm
                    onSaved={(method) => {
                      loadPaymentMethods(method.id);
                    }}
                  />
                )}

                <p className="text-xs text-deliivo-gray">
                  Your saved card is authorized now. The driver still needs to approve the booking.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <p className="text-sm font-medium text-amber-900">Stripe publishable key is not configured for this web build.</p>
                <p className="mt-1 text-xs text-amber-800">
                  Mock payments can still work if the backend is in mock mode. For real Stripe test cards, add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY and rebuild web.
                </p>
              </div>
            )}

            {/* Price preview */}
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-deliivo-gray"><Loader2 className="h-4 w-4 animate-spin" /> Calculating...</div>
            ) : preview ? (
              <div className="rounded-xl bg-primary-50 border border-primary-100 p-4 space-y-2">
                <div className="flex justify-between text-sm"><span className="text-deliivo-gray">Base fare ({seats} seat{seats > 1 ? 's' : ''})</span><span className="font-medium">{previewBreakdown?.currency} {previewBreakdown?.subtotal?.toFixed(2)}</span></div>
                {previewBreakdown && previewBreakdown.serviceFee > 0 && <div className="flex justify-between text-sm"><span className="text-deliivo-gray">Service fee</span><span className="font-medium">{previewBreakdown.currency} {previewBreakdown.serviceFee.toFixed(2)}</span></div>}
                {previewBreakdown && previewBreakdown.luggageFee > 0 && <div className="flex justify-between text-sm"><span className="text-deliivo-gray">Luggage fee</span><span className="font-medium">{previewBreakdown.currency} {previewBreakdown.luggageFee.toFixed(2)}</span></div>}
                <div className="flex justify-between text-base font-bold pt-2 border-t border-primary-200"><span>Total</span><span className="text-primary-500">{previewBreakdown?.currency} {previewBreakdown?.totalPrice?.toFixed(2)}</span></div>
              </div>
            ) : null}

            {bookError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{bookError}</p>
              </div>
            )}

            {paymentMessage && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm text-green-700">{paymentMessage}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleBook}
              disabled={booking || paymentMethodsLoading || (isStripeConfigured() && (!selectedPaymentMethodId || showAddPaymentMethod)) || (needsTosAcceptance && !tosAcceptedForBooking)}
              className="btn-primary w-full py-3.5 text-base gap-2 disabled:opacity-60"
            >
              {booking ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-5 w-5" />}
              {booking ? 'Processing...' : `Request to book - ${previewBreakdown ? `${previewBreakdown.currency} ${previewBreakdown.totalPrice.toFixed(2)}` : ''}`}
            </button>

            <p className="text-center text-xs text-deliivo-gray">
              The driver will be notified and can accept or decline your request.
            </p>
          </div>
        )}

        {/* Rider booking panel — show OTP, actions */}
        {!isOwnRide && myBooking && (
          <div className="rounded-2xl bg-white shadow-sm p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-deliivo-dark">Your Booking</h3>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                myBooking.status === 'ACCEPTED' || myBooking.status === 'CONFIRMED' ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                myBooking.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border border-green-200' :
                myBooking.status === 'NO_SHOW' || myBooking.status === 'DRIVER_MISSED_PICKUP' ? 'bg-red-50 text-red-700 border border-red-200' :
                myBooking.status === 'DISPUTED' ? 'bg-purple-50 text-purple-700 border border-purple-200' :
                'bg-yellow-50 text-yellow-700 border border-yellow-200'
              }`}>{myBooking.status}</span>
            </div>

            {myBooking.status === 'DRIVER_PENDING' && myBooking.decisionDeadline && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-1">
                <p className="text-sm font-semibold text-amber-900">Waiting for driver response</p>
                <p className="text-xs text-amber-800">Expires in {formatDeadline(myBooking.decisionDeadline)}</p>
              </div>
            )}

            {myBooking.status === 'PAYMENT_PENDING' && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-amber-900">Payment needs confirmation</p>
                  <p className="mt-1 text-xs text-amber-800">
                    Confirm the card payment to send this request to the driver.
                  </p>
                </div>
                {myBooking.payment?.clientSecret && isStripeConfigured() && paymentMethods.length > 0 && (
                  <div className="space-y-2">
                    <select
                      value={selectedPaymentMethodId}
                      onChange={(event) => setSelectedPaymentMethodId(event.target.value)}
                      className="w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-deliivo-dark focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
                    >
                      {paymentMethods.map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.brand} **** {method.last4} - {String(method.expMonth).padStart(2, '0')}/{method.expYear}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleRetryPayment}
                      disabled={booking}
                      className="w-full rounded-xl bg-deliivo-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-deliivo-orange-dark disabled:opacity-50"
                    >
                      {booking ? 'Confirming...' : 'Confirm card payment'}
                    </button>
                  </div>
                )}
                {myBooking.payment?.clientSecret && isStripeConfigured() && paymentMethods.length === 0 && (
                  <RideAddPaymentMethodForm
                    onSaved={(method) => {
                      loadPaymentMethods(method.id);
                    }}
                  />
                )}
              </div>
            )}

            {bookError && (
              <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
                <p className="text-sm text-red-600">{bookError}</p>
              </div>
            )}

            {paymentMessage && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-4 py-3">
                <CheckCircle className="h-4 w-4 text-green-600 shrink-0" />
                <p className="text-sm text-green-700">{paymentMessage}</p>
              </div>
            )}

            {myBooking.segmentRide && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
                <p className="text-sm font-semibold text-deliivo-dark">Booked segment</p>
                <div className="text-sm text-deliivo-dark space-y-1">
                  <p><span className="font-medium text-deliivo-gray">Pickup:</span> {myBooking.segmentRide.originAddress}</p>
                  <p><span className="font-medium text-deliivo-gray">Drop-off:</span> {myBooking.segmentRide.destinationAddress}</p>
                  {myBooking.segmentRide.segment?.segmentFare !== undefined && (
                    <p><span className="font-medium text-deliivo-gray">Segment fare:</span> {ride.currency} {myBooking.segmentRide.segment.segmentFare.toFixed(2)}</p>
                  )}
                  {myBooking.segmentRide.bookingContext && (
                    <p className="text-xs text-deliivo-gray">
                      Waypoints: {myBooking.segmentRide.bookingContext.pickupWaypointId || 'origin'} - {myBooking.segmentRide.bookingContext.dropoffWaypointId || 'destination'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {['WAITING_FOR_PICKUP', 'DRIVER_ARRIVED'].includes(myBooking.status) && (
              <div className="rounded-xl border border-dashed border-deliivo-orange/30 bg-orange-50/50 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-deliivo-dark">Pickup point</p>
                  <p className="text-xs text-deliivo-gray mt-1">
                    Mark your arrival here when you are physically at the pickup point. The app will store your GPS evidence for support and disputes.
                  </p>
                </div>
                <div className="rounded-lg bg-white border border-orange-100 p-3 text-sm text-deliivo-dark">
                  <p className="font-medium">
                    {myBooking.segmentRide?.segment?.pickupAddress || myBooking.segmentRide?.originAddress || myBooking.fullRide?.originAddress || ride.originAddress}
                  </p>
                  {myBooking.segmentRide?.bookingContext?.pickupWaypointId && (
                    <p className="text-xs text-deliivo-gray mt-1 break-all">
                      Waypoint: {myBooking.segmentRide.bookingContext.pickupWaypointId}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleRiderArrivedAtPickup(false)}
                  disabled={pickupArrivalLoading || missedPickupLoading}
                  className="w-full rounded-xl border border-deliivo-orange px-4 py-2.5 text-sm font-semibold text-deliivo-orange hover:bg-orange-50 disabled:opacity-50"
                >
                  {pickupArrivalLoading ? 'Recording...' : 'I am at pickup point'}
                </button>
                {allowRideSimulation && (
                  <button
                    type="button"
                    onClick={() => handleRiderArrivedAtPickup(true)}
                    disabled={pickupArrivalLoading || missedPickupLoading}
                    className="w-full rounded-xl border border-dashed border-deliivo-orange px-4 py-2.5 text-sm font-semibold text-deliivo-orange hover:bg-orange-50 disabled:opacity-50"
                  >
                    {pickupArrivalLoading ? 'Recording...' : 'Simulate pickup arrival'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleReportMissedPickup(false)}
                  disabled={pickupArrivalLoading || missedPickupLoading}
                  className="w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {missedPickupLoading ? 'Submitting...' : 'Report driver missed pickup'}
                </button>
                {allowRideSimulation && (
                  <button
                    type="button"
                    onClick={() => handleReportMissedPickup(true)}
                    disabled={pickupArrivalLoading || missedPickupLoading}
                    className="w-full rounded-xl border border-dashed border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {missedPickupLoading ? 'Submitting...' : 'Simulate missed pickup'}
                  </button>
                )}
                {pickupArrivalMessage && <p className="text-xs font-medium text-green-700">{pickupArrivalMessage}</p>}
              </div>
            )}

            <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-deliivo-gray">Seats</span>
                <span className="font-medium text-deliivo-dark">{myBooking.seatsBooked}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-deliivo-gray">Total</span>
                <span className="font-medium text-deliivo-dark">{ride.currency} {myBooking.totalPrice.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-deliivo-gray">Booking ID</span>
                <span className="font-medium text-deliivo-dark">{myBooking.id.slice(0, 8)}</span>
              </div>
            </div>

            {['CONFIRMED', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED', 'ONBOARD', 'DROP_PENDING', 'IN_PROGRESS'].includes(myBooking.status) && (
              <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-deliivo-dark">Live sharing link</p>
                    <p className="mt-1 text-xs text-deliivo-gray">
                      Share a read-only tracking page with family or friends. It expires automatically.
                    </p>
                  </div>
                  <Share2 className="h-4 w-4 text-blue-600" />
                </div>

                {trackingLinks.length > 0 ? (
                  <div className="space-y-2">
                    {trackingLinks.slice(0, 2).map((link) => (
                      <div key={link.id} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-blue-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-deliivo-dark">{trackingUrlFor(link)}</p>
                          <p className="text-[11px] text-deliivo-gray">Expires {new Date(link.expiresAt).toLocaleString()}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyTrackingLink(link)}
                          className="shrink-0 rounded-full border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          Copy
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-deliivo-gray">No active sharing link yet.</p>
                )}

                <button
                  type="button"
                  onClick={handleCreateTrackingLink}
                  disabled={trackingBusy}
                  className="w-full rounded-xl border border-blue-200 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                >
                  {trackingBusy ? 'Creating...' : 'Create and copy live link'}
                </button>
                {trackingMessage && <p className="text-xs text-deliivo-gray">{trackingMessage}</p>}
              </div>
            )}

            {(myBooking.status === 'PENDING' || myBooking.status === 'PAYMENT_PENDING' || myBooking.status === 'DRIVER_PENDING') && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-deliivo-gray">Cancel reason</label>
                  <textarea
                    value={withdrawReason}
                    onChange={(e) => setWithdrawReason(e.target.value)}
                    placeholder="Optional reason for cancelling this request"
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20 resize-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleWithdrawBooking}
                  disabled={riderActionLoading}
                  className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-deliivo-dark hover:bg-gray-50 disabled:opacity-50"
                >
                  {riderActionLoading ? 'Working...' : 'Cancel request'}
                </button>
              </div>
            )}

            {(myBooking.status === 'ACCEPTED' || myBooking.status === 'CONFIRMED') && (
              <button
                type="button"
                onClick={handleCancelBooking}
                disabled={riderActionLoading}
                className="w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {riderActionLoading ? 'Working...' : 'Cancel booking'}
              </button>
            )}

            {/* OTP Display */}
            {['ACCEPTED', 'CONFIRMED', 'WAITING_FOR_PICKUP', 'DRIVER_ARRIVED', 'IN_PROGRESS'].includes(myBooking.status) && (myBooking as unknown as { pickupOtp?: string }).pickupOtp && (
              <div className="rounded-xl bg-orange-50 border border-orange-100 p-4">
                <p className="text-xs text-deliivo-gray font-medium mb-1">Pickup OTP — share with driver</p>
                <p className="text-2xl font-bold text-deliivo-orange tracking-widest text-center">
                  {(myBooking as unknown as { pickupOtp: string }).pickupOtp}
                </p>
              </div>
            )}

            {/* Confirm Dropoff */}
            {myBooking.status === 'DROP_PENDING' && (
              <div className="space-y-2">
                <button
                  onClick={handleRiderConfirmDropoff}
                  disabled={riderActionLoading}
                  className="w-full py-2.5 text-sm font-semibold rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {riderActionLoading ? 'Confirming...' : 'Confirm I was dropped off'}
                </button>
                {allowRideSimulation && (
                  <button
                    type="button"
                    onClick={handleRiderConfirmDropoff}
                    disabled={riderActionLoading}
                    className="w-full rounded-xl border border-dashed border-deliivo-orange px-4 py-2.5 text-sm font-semibold text-deliivo-orange hover:bg-orange-50 disabled:opacity-50"
                  >
                    {riderActionLoading ? 'Working...' : 'Simulate drop-off confirmation'}
                  </button>
                )}
                {dropoffMessage && <p className="text-xs font-medium text-green-700">{dropoffMessage}</p>}
              </div>
            )}

            {disputeEligibleStatuses.includes(myBooking.status) && (
              <div className="pt-3 border-t border-gray-100 space-y-3">
                <div>
                  <h4 className="text-sm font-semibold text-deliivo-dark">Report an issue</h4>
                  <p className="mt-1 text-xs text-deliivo-gray">
                    Add context for support. The backend links this report to ride events, location history, and booking evidence.
                  </p>
                </div>
                {openDispute && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                    <p className="text-xs font-semibold text-amber-900">Existing report: {openDispute.status.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-xs text-amber-800">{openDispute.reason.replace(/_/g, ' ')}</p>
                    {openDispute.resolution && <p className="mt-1 text-xs text-amber-800">Resolution: {openDispute.resolution}</p>}
                  </div>
                )}
                <select
                  value={disputeReason}
                  onChange={(e) => setDisputeReason(e.target.value)}
                  disabled={!!openDispute}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-deliivo-dark focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
                >
                  <option value="NO_SHOW">Passenger or driver no-show</option>
                  <option value="DRIVER_MISSED_PICKUP">Driver missed pickup</option>
                  <option value="WRONG_PICKUP_LOCATION">Wrong pickup location</option>
                  <option value="DROP_OFF_ISSUE">Drop-off issue</option>
                  <option value="PAYMENT_OR_REFUND">Payment or refund issue</option>
                  <option value="SAFETY">Safety concern</option>
                  <option value="OTHER">Other</option>
                </select>
                <textarea
                  value={disputeDescription}
                  onChange={(e) => setDisputeDescription(e.target.value)}
                  placeholder="What happened? Include timing, pickup point, and any useful details."
                  rows={3}
                  disabled={!!openDispute}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20 resize-none"
                />
                <button
                  type="button"
                  onClick={handleCreateDispute}
                  disabled={disputeLoading || !!openDispute}
                  className="w-full rounded-xl border border-red-200 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {openDispute ? 'Report already open' : disputeLoading ? 'Submitting...' : 'Submit report'}
                </button>
                {disputeMessage && <p className="text-xs font-medium text-green-700">{disputeMessage}</p>}
              </div>
            )}

            {/* Rating form — after ride completed */}
            {rateableBookingStatuses.includes(myBooking.status) && !ratingSubmitted && (
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

function RideAddPaymentMethodForm({ onSaved }: { onSaved: (method: PaymentMethod) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements) return;

    setSaving(true);
    setError('');
    try {
      const setupIntentRes = await paymentMethodsApi.createSetupIntent();
      const { clientSecret, customerId } = setupIntentRes.data;
      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card details are not ready. Please re-enter the card.');

      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) {
        throw new Error(stripeError.message || 'Card setup failed');
      }

      const stripePaymentMethodId = typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method?.id;
      if (!stripePaymentMethodId) throw new Error('Stripe did not return a payment method');

      const saved = await paymentMethodsApi.save(stripePaymentMethodId, customerId);
      onSaved(saved.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save card');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-3">
        <CardElement
          options={{
            hidePostalCode: true,
            style: {
              base: {
                color: '#1F2937',
                fontSize: '15px',
                '::placeholder': { color: '#9CA3AF' },
              },
            },
          }}
        />
      </div>
      {error && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
      )}
      <button
        type="submit"
        disabled={saving || !stripe}
        className="w-full rounded-xl border border-deliivo-orange bg-white px-4 py-2.5 text-sm font-semibold text-deliivo-orange hover:bg-deliivo-orange-light disabled:opacity-50"
      >
        {saving ? 'Saving card...' : 'Save card for this booking'}
      </button>
    </form>
  );
}

export default function RideDetailPage() {
  return (
    <ProtectedRoute>
      <StripeProvider>
        <RideDetailContent />
      </StripeProvider>
    </ProtectedRoute>
  );
}
