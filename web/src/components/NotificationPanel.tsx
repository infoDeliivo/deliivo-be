'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, Loader2, RefreshCw, ArrowRight, MapPin, Calendar, Clock } from 'lucide-react';
import { NotificationRecord, notificationsApi } from '@/lib/api';
import { onSocketEvent, getSocket, NotificationPayload } from '@/lib/socket';
import { useAuth } from '@/lib/auth-context';
import { getBrowserNotificationStatus, registerBrowserPushDevice } from '@/lib/web-push';

type Props = {
  title?: string;
  maxItems?: number;
  showViewAll?: boolean;
  className?: string;
};

function getString(data: Record<string, unknown> | null, key: string): string | null {
  if (!data) return null;
  const value = data[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function formatDateLabel(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function getNotificationLink(item: NotificationRecord): string | null {
  const data = item.data;
  const rideId = getString(data, 'rideId');
  const bookingId = getString(data, 'bookingId');
  const deepLink = getString(data, 'deepLink');

  if (deepLink?.startsWith('app://driver/booking-request/')) {
    return rideId ? `/rides/${rideId}/manage${bookingId ? `?bookingId=${bookingId}` : ''}` : null;
  }

  if (deepLink?.startsWith('app://booking/')) {
    return rideId ? `/rides/${rideId}${bookingId ? `?bookingId=${bookingId}` : ''}` : null;
  }

  if (rideId) {
    return `/rides/${rideId}`;
  }

  return null;
}

function getNotificationSummary(item: NotificationRecord): string | null {
  const data = item.data;
  if (!data) return null;

  const origin = getString(data, 'originAddress');
  const destination = getString(data, 'destinationAddress');
  const departureDate = formatDateLabel(getString(data, 'departureDate'));
  const departureTime = getString(data, 'departureTime');
  const refundPercent = getString(data, 'refundPercent');
  const cancellationReason = getString(data, 'cancellationReason') || getString(data, 'reason');
  const rejectionReason = getString(data, 'rejectionReason');
  const statusReason = cancellationReason || rejectionReason;

  const route = origin && destination ? `${origin.split(',')[0]} -> ${destination.split(',')[0]}` : null;
  const schedule = departureDate || departureTime ? [departureDate, departureTime].filter(Boolean).join(' | ') : null;
  const refundLabel = refundPercent ? `Refund ${refundPercent}%` : null;
  const reasonLabel = statusReason ? `Reason: ${statusReason}` : null;

  return [route, schedule, refundLabel, reasonLabel].filter(Boolean).join(' | ') || null;
}

export default function NotificationPanel({
  title = 'Notifications',
  maxItems = 5,
  showViewAll = true,
  className = '',
}: Props) {
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pushStatus, setPushStatus] = useState<ReturnType<typeof getBrowserNotificationStatus>>('unsupported');
  const [pushBusy, setPushBusy] = useState(false);
  const { user } = useAuth();

  const unreadIds = useMemo(() => items.filter((item) => !item.isRead).map((item) => item.id), [items]);

  async function load() {
    setLoading(true);
    try {
      const [listRes, unreadRes] = await Promise.all([
        notificationsApi.list(undefined, maxItems),
        notificationsApi.getUnreadCount(),
      ]);
      setItems(listRes.data.notifications || []);
      setUnreadCount(unreadRes.data.unreadCount || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;

    getSocket();
    setPushStatus(getBrowserNotificationStatus());
    load();

    const unsub = onSocketEvent<NotificationPayload>('notification:new', (payload) => {
      setItems((prev) => [
        {
          id: payload.data.id,
          type: payload.data.notificationType,
          title: payload.data.title,
          body: payload.data.body,
          data: (payload.data.data || {}) as Record<string, unknown>,
          isRead: false,
          readAt: null,
          createdAt: payload.data.createdAt,
        },
        ...prev,
      ].slice(0, maxItems));
      setUnreadCount((prev) => prev + 1);
    });

    return unsub;
  }, [maxItems, user?.id]);

  async function markAllRead() {
    if (unreadIds.length === 0) return;
    setBusy(true);
    try {
      await notificationsApi.markRead(unreadIds);
      setItems((prev) =>
        prev.map((item) =>
          unreadIds.includes(item.id) ? { ...item, isRead: true, readAt: new Date().toISOString() } : item
        )
      );
      setUnreadCount(0);
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  }

  async function enableBrowserAlerts() {
    setPushBusy(true);
    try {
      setPushStatus(await registerBrowserPushDevice());
    } catch {
      setPushStatus(getBrowserNotificationStatus());
    } finally {
      setPushBusy(false);
    }
  }

  const content = (
    <div className={`w-full overflow-hidden rounded-2xl bg-white shadow-sm border border-gray-100 ${className}`}>
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Bell className="h-4 w-4 text-deliivo-orange" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-deliivo-dark">{title}</p>
            <p className="text-xs text-deliivo-gray">{unreadCount} unread</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {pushStatus === 'permission-default' && (
            <button
              type="button"
              onClick={enableBrowserAlerts}
              disabled={pushBusy}
              className="hidden rounded-full border border-orange-200 px-3 py-1.5 text-xs font-semibold text-deliivo-orange hover:bg-orange-50 disabled:opacity-50 sm:inline-flex"
            >
              {pushBusy ? 'Enabling...' : 'Enable browser alerts'}
            </button>
          )}
          {pushStatus === 'enabled' && (
            <span className="hidden rounded-full bg-green-50 px-3 py-1.5 text-xs font-semibold text-green-700 sm:inline-flex">
              Browser alerts on
            </span>
          )}
          <button
            type="button"
            onClick={load}
            className="rounded-full p-2 text-deliivo-gray hover:bg-gray-100 hover:text-deliivo-dark"
            aria-label="Refresh notifications"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={markAllRead}
            disabled={busy || unreadIds.length === 0}
            className="rounded-full p-2 text-deliivo-gray hover:bg-gray-100 hover:text-deliivo-dark disabled:opacity-40"
            aria-label="Mark notifications as read"
          >
            <CheckCheck className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto">
        {loading ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-deliivo-gray">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading notifications...
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-6 text-sm text-deliivo-gray">
            No notifications yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {items.map((item) => {
              const summary = getNotificationSummary(item);
              const rideId = getString(item.data, 'rideId');
              const bookingId = getString(item.data, 'bookingId');
              const departureDate = formatDateLabel(getString(item.data, 'departureDate'));
              const departureTime = getString(item.data, 'departureTime');
              const href = getNotificationLink(item);
              const origin = getString(item.data, 'originAddress');
              const destination = getString(item.data, 'destinationAddress');

              return (
                <div key={item.id} className={`px-4 py-3 ${item.isRead ? 'bg-white' : 'bg-orange-50/60'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-deliivo-dark">{item.title}</p>
                      <p className="mt-0.5 text-xs text-deliivo-gray">{item.body}</p>

                      {summary && (
                        <div className="mt-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-deliivo-gray">
                          {summary}
                        </div>
                      )}

                      {(origin || destination || departureDate || departureTime || rideId || bookingId) && (
                        <div className="mt-2 grid gap-2 text-[11px] text-deliivo-gray sm:grid-cols-2">
                          {origin && destination && (
                            <div className="rounded-xl border border-gray-100 px-3 py-2">
                              <div className="flex items-center gap-1.5 font-medium text-deliivo-dark">
                                <MapPin className="h-3 w-3 text-deliivo-orange" />
                                Route
                              </div>
                              <div className="mt-1 break-words">
                                {origin} {'->'} {destination}
                              </div>
                            </div>
                          )}
                          {(departureDate || departureTime) && (
                            <div className="rounded-xl border border-gray-100 px-3 py-2">
                              <div className="flex items-center gap-1.5 font-medium text-deliivo-dark">
                                <Clock className="h-3 w-3 text-deliivo-orange" />
                                Schedule
                              </div>
                              <div className="mt-1">
                                {[departureDate, departureTime].filter(Boolean).join(' | ')}
                              </div>
                            </div>
                          )}
                          {rideId && (
                            <div className="rounded-xl border border-gray-100 px-3 py-2">
                              <div className="flex items-center gap-1.5 font-medium text-deliivo-dark">
                                <Calendar className="h-3 w-3 text-deliivo-orange" />
                                Ride ID
                              </div>
                              <div className="mt-1 break-all">{rideId}</div>
                            </div>
                          )}
                          {bookingId && (
                            <div className="rounded-xl border border-gray-100 px-3 py-2">
                              <div className="flex items-center gap-1.5 font-medium text-deliivo-dark">
                                <Calendar className="h-3 w-3 text-deliivo-orange" />
                                Booking ID
                              </div>
                              <div className="mt-1 break-all">{bookingId}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    {!item.isRead && <span className="mt-0.5 h-2.5 w-2.5 rounded-full bg-deliivo-orange shrink-0" />}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wide text-deliivo-gray">
                      {item.type.replace(/\./g, ' ')}
                    </p>
                    {href && (
                      <Link
                        href={href}
                        className="inline-flex items-center gap-1 rounded-full border border-orange-200 px-3 py-1 text-xs font-semibold text-deliivo-orange hover:bg-orange-50"
                      >
                        Open ride
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showViewAll && (
        <div className="border-t border-gray-100 px-4 py-3">
          <Link href="/profile/notifications" className="text-sm font-semibold text-deliivo-orange hover:underline">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );

  return content;
}
