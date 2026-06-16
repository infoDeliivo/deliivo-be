'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { AlertCircle, ArrowLeft, Clock, Loader2, MapPin, Radio } from 'lucide-react';
import GoogleMap from '@/components/GoogleMap';
import { PublicTrackingData, trackingApi } from '@/lib/api';

export default function PublicTrackingPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicTrackingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await trackingApi.getPublic(token);
      setData(res.data);
      setError('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Tracking link is unavailable');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!token) return;
    load();
    const interval = window.setInterval(load, 8000);
    return () => window.clearInterval(interval);
  }, [token]);

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-deliivo-cream">
        <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-deliivo-cream px-4 text-center">
        <AlertCircle className="mb-4 h-12 w-12 text-red-500" />
        <h1 className="text-lg font-semibold text-deliivo-dark">Tracking unavailable</h1>
        <p className="mt-2 max-w-md text-sm text-deliivo-gray">{error || 'This tracking link may be expired or revoked.'}</p>
      </main>
    );
  }

  const liveLocation = data.location ? { lat: data.location.lat, lng: data.location.lng } : null;
  const departureDate = data.departureDate ? new Date(data.departureDate).toLocaleDateString() : null;
  const lastUpdated = data.location?.timestamp ? new Date(data.location.timestamp).toLocaleTimeString() : null;

  return (
    <main className="min-h-screen bg-deliivo-cream">
      <div className="sticky top-0 z-10 border-b border-gray-100 bg-white/85 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-3xl items-center px-4">
          <Link href="/" className="flex items-center gap-1.5 text-sm font-medium text-deliivo-gray hover:text-deliivo-dark">
            <ArrowLeft className="h-4 w-4" /> Deliivo
          </Link>
          <span className="ml-4 text-sm font-semibold text-deliivo-dark">Live ride tracking</span>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="bg-gradient-to-r from-deliivo-orange to-primary-600 px-5 py-4 text-white">
            <p className="text-sm text-white/80">{departureDate} {data.departureTime ? `at ${data.departureTime}` : ''}</p>
            <h1 className="mt-0.5 text-lg font-bold">
              {data.originAddress.split(',')[0]} to {data.destinationAddress.split(',')[0]}
            </h1>
          </div>

          <div className="grid gap-3 p-5 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-deliivo-gray">
                <MapPin className="h-3.5 w-3.5 text-deliivo-orange" /> Pickup
              </p>
              <p className="mt-1 font-medium text-deliivo-dark">{data.pickup || data.originAddress}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-deliivo-gray">
                <MapPin className="h-3.5 w-3.5 text-deliivo-orange" /> Drop-off
              </p>
              <p className="mt-1 font-medium text-deliivo-dark">{data.dropoff || data.destinationAddress}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-deliivo-gray">
                <Radio className="h-3.5 w-3.5 text-green-600" /> Ride status
              </p>
              <p className="mt-1 font-medium text-deliivo-dark">{data.rideStatus} / {data.bookingStatus}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-deliivo-gray">
                <Clock className="h-3.5 w-3.5 text-deliivo-orange" /> Last update
              </p>
              <p className="mt-1 font-medium text-deliivo-dark">{lastUpdated || 'Waiting for driver location'}</p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-deliivo-gray">
                <Clock className="h-3.5 w-3.5 text-deliivo-orange" /> ETA to pickup
              </p>
              <p className="mt-1 font-medium text-deliivo-dark">
                {data.eta?.pickup?.label || (data.eta?.scheduledPickupTime ? `Scheduled ${data.eta.scheduledPickupTime}` : 'Waiting for driver location')}
              </p>
            </div>
            <div className="rounded-xl border border-gray-100 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-deliivo-gray">
                <Clock className="h-3.5 w-3.5 text-deliivo-orange" /> ETA to drop-off
              </p>
              <p className="mt-1 font-medium text-deliivo-dark">
                {data.eta?.dropoff?.label || (data.eta?.scheduledDropoffTime ? `Scheduled ${data.eta.scheduledDropoffTime}` : 'Available after live location')}
              </p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl bg-white shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-deliivo-dark">
              <MapPin className={liveLocation ? 'h-4 w-4 animate-pulse text-green-600' : 'h-4 w-4 text-deliivo-orange'} />
              Driver location
            </h2>
            <span className="text-xs font-medium text-deliivo-gray">{liveLocation ? 'Live' : 'Pending'}</span>
          </div>
          <GoogleMap
            liveLocation={liveLocation}
            center={liveLocation || { lat: 56.95, lng: 24.11 }}
            zoom={liveLocation ? 13 : 6}
            className="h-72 w-full"
          />
          {!liveLocation && (
            <div className="border-t border-gray-100 px-5 py-3 text-xs text-deliivo-gray">
              Location will appear here once the driver starts sharing live GPS updates.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
