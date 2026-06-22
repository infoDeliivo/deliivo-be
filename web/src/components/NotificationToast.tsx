'use client';

import { useEffect, useState } from 'react';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useNotificationStore } from '@/lib/notification-store';
import { getBrowserNotificationStatus, registerBrowserPushDevice } from '@/lib/web-push';

type ToastNotification = {
  id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, string>;
  createdAt: string;
};

export default function NotificationToast() {
  const [notifications, setNotifications] = useState<ToastNotification[]>([]);
  const { user } = useAuth();
  const { lastIncoming } = useNotificationStore(user?.id);

  useEffect(() => {
    if (!user) return;

    if (getBrowserNotificationStatus() === 'enabled') {
      registerBrowserPushDevice().catch(() => {});
    }
  }, [user?.id]);

  useEffect(() => {
    if (!lastIncoming) return;

    const notification = {
      id: lastIncoming.id,
      type: lastIncoming.type,
      title: lastIncoming.title,
      body: lastIncoming.body,
      data: (lastIncoming.data || {}) as Record<string, string>,
      createdAt: lastIncoming.createdAt,
    };

    setNotifications((prev) => [notification, ...prev.filter((item) => item.id !== notification.id)].slice(0, 5));

    const timeoutId = window.setTimeout(() => {
      setNotifications((prev) => prev.filter((item) => item.id !== notification.id));
    }, 6000);

    return () => window.clearTimeout(timeoutId);
  }, [lastIncoming?.id]);

  function dismiss(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  function notificationTarget(data?: Record<string, string>) {
    const rideId = data?.rideId;
    const bookingId = data?.bookingId;
    const deepLink = data?.deepLink || '';
    if (!rideId) return '/profile/notifications';
    if (deepLink.startsWith('app://driver/booking-request/')) {
      return `/rides/${rideId}/manage${bookingId ? `?bookingId=${bookingId}` : ''}`;
    }
    return `/rides/${rideId}${bookingId ? `?bookingId=${bookingId}` : ''}`;
  }

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {notifications.map(n => (
        <div key={n.id} className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 flex items-start gap-3 animate-in slide-in-from-right">
          <div className="w-8 h-8 rounded-full bg-deliivo-orange-light flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4 text-deliivo-orange" />
          </div>
          <button
            type="button"
            onClick={() => { window.location.href = notificationTarget(n.data); }}
            className="flex-1 min-w-0 text-left"
          >
            <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
            <p className="text-xs text-deliivo-gray mt-0.5 line-clamp-2">{n.body}</p>
          </button>
          <button onClick={() => dismiss(n.id)} className="shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
