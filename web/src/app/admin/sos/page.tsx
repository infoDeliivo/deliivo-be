'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, MapPin, ShieldCheck, XCircle } from 'lucide-react';
import { adminApi, type AdminEmergencyAlert, type Pagination, getApiErrorMessage } from '@/lib/api';
import { showError, showSuccess } from '@/lib/app-feedback';

const FILTERS = ['ALL', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'FALSE_ALARM'] as const;

const statusStyles: Record<string, string> = {
  OPEN: 'border-red-200 bg-red-50 text-red-700',
  ACKNOWLEDGED: 'border-amber-200 bg-amber-50 text-amber-700',
  RESOLVED: 'border-green-200 bg-green-50 text-green-700',
  FALSE_ALARM: 'border-gray-200 bg-gray-50 text-gray-600',
};

export default function AdminSosPage() {
  const [alerts, setAlerts] = useState<AdminEmergencyAlert[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('OPEN');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadAlerts();
  }, [status, page]);

  async function loadAlerts() {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getEmergencyAlerts({ status, page, limit: 20 });
      setAlerts(res.data.alerts);
      setPagination(res.data.pagination);
      setOpenCount(res.data.openCount);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to load SOS alerts');
      setError(message);
      showError('Could not load SOS alerts', message);
    } finally {
      setLoading(false);
    }
  }

  async function updateStatus(alertId: string, nextStatus: 'ACKNOWLEDGED' | 'RESOLVED' | 'FALSE_ALARM') {
    setActionLoading(`${alertId}:${nextStatus}`);
    try {
      await adminApi.updateEmergencyAlertStatus(alertId, nextStatus);
      await loadAlerts();
      showSuccess('SOS alert updated', nextStatus.replace('_', ' ').toLowerCase());
    } catch (err: unknown) {
      showError('Could not update SOS', getApiErrorMessage(err, 'Failed to update SOS alert'));
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = pagination?.totalPages || 1;

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-red-600">Safety operations</p>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Emergency SOS</h1>
          <p className="mt-1 text-sm text-gray-500">
            {openCount} open alert{openCount === 1 ? '' : 's'} need admin attention.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => { setStatus(filter); setPage(1); }}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                status === filter ? 'border-red-500 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600 hover:border-red-200'
              }`}
            >
              {filter.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck className="mx-auto h-9 w-9 text-green-500" />
            <p className="mt-3 text-sm font-semibold text-gray-900">No SOS alerts in this view</p>
            <p className="mt-1 text-xs text-gray-500">Change the filter to review older resolved alerts.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {alerts.map((alert) => (
              <article key={alert.id} className="grid gap-4 p-5 xl:grid-cols-[1fr_auto]">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[alert.status] || statusStyles.OPEN}`}>
                      <AlertTriangle size={13} />
                      {alert.status.replace('_', ' ')}
                    </span>
                    <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">{alert.role}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                      <Clock size={13} />
                      {new Date(alert.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <div>
                    <h2 className="text-base font-semibold text-gray-900">
                      {alert.user?.name || alert.user?.email || alert.user?.phone || 'Unknown user'}
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                      {alert.ride
                        ? `${alert.ride.originAddress.split(',')[0]} to ${alert.ride.destinationAddress.split(',')[0]}`
                        : 'Ride context unavailable'}
                    </p>
                    {alert.message && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">{alert.message}</p>}
                  </div>

                  <div className="grid gap-2 text-xs text-gray-500 md:grid-cols-3">
                    <div>
                      <span className="font-semibold text-gray-700">Ride</span>
                      <div>{alert.rideId ? alert.rideId.slice(0, 8) : '--'}</div>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">Booking</span>
                      <div>{alert.bookingId ? alert.bookingId.slice(0, 8) : '--'}</div>
                    </div>
                    <div>
                      <span className="font-semibold text-gray-700">Location</span>
                      <div className="flex items-center gap-1">
                        <MapPin size={12} />
                        {alert.lat != null && alert.lng != null ? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}` : 'No GPS'}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs">
                    {alert.rideId && (
                      <Link href={`/admin/rides?search=${encodeURIComponent(alert.rideId)}&searchBy=rideId`} className="font-semibold text-orange-600 hover:underline">
                        Open ride
                      </Link>
                    )}
                    {alert.bookingId && (
                      <Link href={`/admin/rides?search=${encodeURIComponent(alert.bookingId)}&searchBy=bookingId`} className="font-semibold text-orange-600 hover:underline">
                        Find booking
                      </Link>
                    )}
                    {alert.user?.email && <span>{alert.user.email}</span>}
                    {alert.user?.phone && <span>{alert.user.phone}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 xl:flex-col xl:items-stretch">
                  {alert.status === 'OPEN' && (
                    <button
                      type="button"
                      onClick={() => updateStatus(alert.id, 'ACKNOWLEDGED')}
                      disabled={actionLoading === `${alert.id}:ACKNOWLEDGED`}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-200 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {actionLoading === `${alert.id}:ACKNOWLEDGED` ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      Acknowledge
                    </button>
                  )}
                  {alert.status !== 'RESOLVED' && alert.status !== 'FALSE_ALARM' && (
                    <>
                      <button
                        type="button"
                        onClick={() => updateStatus(alert.id, 'RESOLVED')}
                        disabled={actionLoading === `${alert.id}:RESOLVED`}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-green-200 px-3 py-2 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
                      >
                        {actionLoading === `${alert.id}:RESOLVED` ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
                        Resolve
                      </button>
                      <button
                        type="button"
                        onClick={() => updateStatus(alert.id, 'FALSE_ALARM')}
                        disabled={actionLoading === `${alert.id}:FALSE_ALARM`}
                        className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {actionLoading === `${alert.id}:FALSE_ALARM` ? <Loader2 size={15} className="animate-spin" /> : <XCircle size={15} />}
                        False alarm
                      </button>
                    </>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">
          Page {page} of {totalPages}
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-50"
          >
            <ChevronLeft size={15} /> Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            disabled={page >= totalPages}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-600 disabled:opacity-50"
          >
            Next <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
