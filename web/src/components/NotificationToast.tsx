'use client';

import { useEffect, useState } from 'react';
import { onSocketEvent, getSocket, NotificationPayload } from '@/lib/socket';
import { Bell, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getBrowserNotificationStatus, registerBrowserPushDevice, showBrowserNotification } from '@/lib/web-push';

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

  useEffect(() => {
    if (!user) return;

    // Connect socket when component mounts
    getSocket();

    if (getBrowserNotificationStatus() === 'enabled') {
      registerBrowserPushDevice().catch(() => {});
    }

    const unsub = onSocketEvent<NotificationPayload>('notification:new', (payload) => {
      const notification = {
        id: payload.data.id,
        type: payload.data.notificationType,
        title: payload.data.title,
        body: payload.data.body,
        data: payload.data.data || {},
        createdAt: payload.data.createdAt,
      };

      setNotifications(prev => [notification, ...prev].slice(0, 5));
      showBrowserNotification(notification);

      // Auto-dismiss after 6 seconds
      setTimeout(() => {
        setNotifications(prev => prev.filter(n => n.id !== payload.data.id));
      }, 6000);
    });

    return unsub;
  }, [user?.id]);

  function dismiss(id: string) {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-80">
      {notifications.map(n => (
        <div key={n.id} className="bg-white rounded-xl shadow-lg border border-gray-100 p-4 flex items-start gap-3 animate-in slide-in-from-right">
          <div className="w-8 h-8 rounded-full bg-deliivo-orange-light flex items-center justify-center shrink-0">
            <Bell className="w-4 h-4 text-deliivo-orange" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{n.title}</p>
            <p className="text-xs text-deliivo-gray mt-0.5 line-clamp-2">{n.body}</p>
          </div>
          <button onClick={() => dismiss(n.id)} className="shrink-0 p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
