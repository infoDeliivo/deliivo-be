'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, Car, ChevronLeft, ChevronRight, Clipboard, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { adminApi, AdminRide, Pagination, getApiErrorMessage } from '@/lib/api';
import { showError, showSuccess } from '@/lib/app-feedback';
import LoadFailureCard from '@/components/LoadFailureCard';

const STATUSES = ['ALL', 'PUBLISHED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
const SEARCH_BY_OPTIONS = [
  { value: 'all', label: 'All fields' },
  { value: 'rideId', label: 'Ride ID' },
  { value: 'bookingId', label: 'Booking ID' },
  { value: 'route', label: 'Route text' },
  { value: 'driverId', label: 'Driver ID' },
  { value: 'driverName', label: 'Driver name' },
  { value: 'driverEmail', label: 'Driver email' },
  { value: 'driverPhone', label: 'Driver phone' },
  { value: 'riderId', label: 'Rider ID' },
  { value: 'riderName', label: 'Rider name' },
  { value: 'riderEmail', label: 'Rider email' },
  { value: 'riderPhone', label: 'Rider phone' },
] as const;

function shortId(id: string) {
  return id.slice(0, 8);
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard?.writeText(value);
    showSuccess(`${label} copied`, value);
  } catch {
    showError('Copy failed', `Could not copy ${label.toLowerCase()}.`);
  }
}

export default function AdminRidesPage() {
  const [rides, setRides] = useState<AdminRide[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [status, setStatus] = useState<string>('ALL');
  const [searchBy, setSearchBy] = useState('all');
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refundBookingId, setRefundBookingId] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextStatus = params.get('status') || 'ALL';
    const nextSearchBy = params.get('searchBy') || 'all';
    const nextSearch = params.get('search') || '';
    const nextPage = Number(params.get('page') || '1');

    setStatus(nextStatus);
    setSearchBy(nextSearchBy);
    setSearch(nextSearch);
    setAppliedSearch(nextSearch);
    setPage(Number.isFinite(nextPage) && nextPage > 0 ? nextPage : 1);
  }, []);

  useEffect(() => { loadRides(); }, [page, status, searchBy, appliedSearch]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status !== 'ALL') params.set('status', status);
    if (searchBy !== 'all') params.set('searchBy', searchBy);
    if (appliedSearch) params.set('search', appliedSearch);
    if (page > 1) params.set('page', String(page));
    const next = params.toString();
    const href = next ? `${window.location.pathname}?${next}` : window.location.pathname;
    window.history.replaceState(null, '', href);
  }, [status, searchBy, appliedSearch, page]);

  async function loadRides(nextSearch = appliedSearch) {
    setLoading(true);
    setError('');
    try {
      const res = await adminApi.getRides({
        page,
        limit: 20,
        status,
        search: nextSearch.trim() || undefined,
        searchBy: searchBy === 'all' ? undefined : searchBy,
      });
      setRides(res.data.rides);
      setPagination(res.data.pagination);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load rides'));
    } finally {
      setLoading(false);
    }
  }

  async function refundBooking(bookingId: string) {
    setRefundBookingId(bookingId);
    try {
      await adminApi.refundBooking(bookingId);
      await loadRides();
      showSuccess('Refund requested', `Booking ${shortId(bookingId)} was sent for refund.`);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Refund failed');
      setError(message);
      showError('Refund failed', message);
    } finally {
      setRefundBookingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Ride History</h1>
          <p className="text-sm text-gray-500 mt-0.5">Search rides, bookings, drivers, riders, disputes, and operational state.</p>
        </div>
        <button onClick={() => loadRides()} className="inline-flex items-center gap-1.5 rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-600 hover:text-[#F97316]">
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => { setStatus(value); setPage(1); }}
                className={`rounded-xl border px-4 py-2 text-xs font-semibold ${status === value ? 'border-[#F97316] bg-[#F97316] text-white' : 'border-gray-200 text-gray-600 hover:border-[#F97316] hover:text-[#F97316]'}`}
              >
                {value.replace(/_/g, ' ')}
              </button>
            ))}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); setPage(1); setAppliedSearch(search); }} className="flex flex-col gap-2 lg:flex-row">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ride, booking, driver, rider..." className="w-full rounded-xl border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-[#F97316] focus:outline-none lg:w-80" />
            </div>
            <select value={searchBy} onChange={(event) => setSearchBy(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none lg:w-40">
              {SEARCH_BY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <button className="rounded-xl bg-[#F97316] px-4 py-2 text-sm font-semibold text-white">Search</button>
          </form>
        </div>
        <p className="mt-3 text-xs text-gray-400">
          Search supports ride ID, booking ID, driver/rider ID, name, email, phone, and route city/address text.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setSearch(''); setAppliedSearch(''); setSearchBy('all'); setStatus('ALL'); setPage(1); }}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-[#F97316] hover:text-[#F97316]"
          >
            Clear filters
          </button>
          <Link href="/admin/reports" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-[#F97316] hover:text-[#F97316]">
            Open disputes
          </Link>
          <Link href="/admin/revenue" className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-[#F97316] hover:text-[#F97316]">
            Open revenue
          </Link>
        </div>
      </div>

      <div className="rounded-2xl bg-white shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-[#F97316]" /></div>
        ) : rides.length === 0 ? (
          <div className="p-5">
            <LoadFailureCard
              title="No rides matched these filters"
              message="Try a broader status, clear the search, or search by a specific ride or booking identifier."
              onRetry={() => { setSearch(''); setAppliedSearch(''); setSearchBy('all'); setStatus('ALL'); setPage(1); }}
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {rides.map((ride) => {
              const bookedSeats = ride.bookings.reduce((sum, booking) => sum + booking.seatsBooked, 0);
              const paidAmount = ride.bookings.reduce((sum, booking) => sum + (booking.paymentAmount || 0), 0);
              return (
                <div key={ride.id} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Car className="h-4 w-4 text-[#F97316]" />
                        <span className="font-semibold text-gray-900">
                          {ride.originAddress.split(',')[0]} to {ride.destinationAddress.split(',')[0]}
                        </span>
                        <Link href={`/admin/rides?search=${encodeURIComponent(ride.id)}&searchBy=rideId`} className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-500 hover:border-[#F97316] hover:text-[#F97316]">
                          Focus <ExternalLink className="h-3 w-3" />
                        </Link>
                        <CopyableId id={ride.id} label="Ride ID" />
                        <span className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-semibold text-gray-600">{ride.status.replace(/_/g, ' ')}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        Ride {ride.id} • {new Date(ride.departureDate).toLocaleDateString()} at {ride.departureTime}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        Driver: {ride.driver?.name || ride.driver?.email || 'Unknown'} • {bookedSeats}/{ride.totalSeats} seats booked • {ride.currency} {paidAmount.toFixed(2)} paid
                      </p>
                      {ride.driver?.id && (
                        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                          <span>Driver ID <CopyableId id={ride.driver.id} label="Driver ID" /></span>
                          {ride.driver.email && <span>{ride.driver.email}</span>}
                          {ride.driver.phone && <span>{ride.driver.phone}</span>}
                        </p>
                      )}
                    </div>
                    <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-3 lg:w-80">
                      <Metric label="Bookings" value={String(ride.bookings.length)} />
                      <Metric label="Disputes" value={String(ride.disputes.length)} />
                      <Metric label="Available" value={String(ride.availableSeats)} />
                    </div>
                  </div>

                  {ride.bookings.length > 0 && (
                    <div className="mt-4 overflow-x-auto rounded-xl border border-gray-100">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 text-gray-400">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Booking</th>
                            <th className="px-3 py-2 text-left font-medium">Passenger</th>
                            <th className="px-3 py-2 text-left font-medium">Status</th>
                            <th className="px-3 py-2 text-left font-medium">Seats</th>
                            <th className="px-3 py-2 text-left font-medium">Paid</th>
                            <th className="px-3 py-2 text-right font-medium">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {ride.bookings.map((booking) => (
                            <tr key={booking.id} className="border-t border-gray-100">
                              <td className="px-3 py-2 text-gray-500">
                                <CopyableId id={booking.id} label="Booking ID" />
                              </td>
                              <td className="px-3 py-2 text-gray-700">
                                <div className="space-y-0.5">
                                  <Link href={`/profile/users/${booking.passengerId}`} className="font-medium hover:text-[#F97316]">
                                    {booking.passenger?.name || booking.passenger?.email || shortId(booking.passengerId)}
                                  </Link>
                                  <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-gray-400">
                                    <span>Rider ID <CopyableId id={booking.passengerId} label="Rider ID" /></span>
                                    {booking.passenger?.email && <span>{booking.passenger.email}</span>}
                                    {booking.passenger?.phone && <span>{booking.passenger.phone}</span>}
                                  </div>
                                </div>
                              </td>
                              <td className="px-3 py-2 text-gray-600">{booking.status.replace(/_/g, ' ')}</td>
                              <td className="px-3 py-2 text-gray-600">{booking.seatsBooked}</td>
                              <td className="px-3 py-2 text-gray-600">{ride.currency} {(booking.paymentAmount || booking.totalPrice || 0).toFixed(2)}</td>
                              <td className="px-3 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (window.confirm(`Force refund booking ${shortId(booking.id)}? This is a support override and should only be used after checking payment/dispute context.`)) {
                                      refundBooking(booking.id);
                                    }
                                  }}
                                  disabled={!!booking.refundedAt || refundBookingId === booking.id}
                                  className="rounded-lg border border-red-200 px-2.5 py-1 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40"
                                >
                                  {booking.refundedAt ? 'Refunded' : refundBookingId === booking.id ? 'Refunding' : 'Refund'}
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <p className="text-xs text-gray-400">Page {page} of {pagination.totalPages}</p>
            <div className="flex gap-1">
              <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page === 1} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))} disabled={page === pagination.totalPages} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 px-3 py-2">
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function CopyableId({ id, label }: { id: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => copyText(id, label)}
      title={id}
      className="inline-flex items-center gap-1 rounded-md font-mono text-[11px] font-semibold text-gray-500 hover:text-[#F97316]"
    >
      {shortId(id)}
      <Clipboard className="h-3 w-3" />
    </button>
  );
}
