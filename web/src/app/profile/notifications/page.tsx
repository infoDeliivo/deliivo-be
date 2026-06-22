'use client';

import { useEffect, useState } from 'react';
import ProtectedRoute from '@/components/ProtectedRoute';
import Navbar from '@/components/Navbar';
import NotificationPanel from '@/components/NotificationPanel';
import { useTranslation } from '@/lib/i18n-context';
import { getBrowserNotificationStatus, registerBrowserPushDevice } from '@/lib/web-push';
import { Bell, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useNotificationStore } from '@/lib/notification-store';
import LoadFailureCard from '@/components/LoadFailureCard';
import { publicConfig } from '@/lib/public-config';

export default function NotificationsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [pushStatus, setPushStatus] = useState(getBrowserNotificationStatus());
  const [busy, setBusy] = useState(false);
  const { unreadCount, lastSyncedAt, lastError, refresh } = useNotificationStore(user?.id);

  useEffect(() => {
    setPushStatus(getBrowserNotificationStatus());
  }, [user?.id]);

  async function enableAlerts() {
    setBusy(true);
    try {
      setPushStatus(await registerBrowserPushDevice());
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProtectedRoute>
      <Navbar />
      <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="mb-6 text-2xl font-bold text-deliivo-dark">{t('nav.notifications')}</h1>
          {lastError && (
            <div className="mb-5">
              <LoadFailureCard
                title="Notification sync needs attention"
                message={`${lastError}. You can retry sync here. If this keeps failing, contact ${publicConfig.supportEmail}.`}
                onRetry={() => { void refresh(); }}
              />
            </div>
          )}
          <div className="mb-5 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <Bell className="h-4 w-4 text-deliivo-orange" />
                  <h2 className="text-sm font-semibold text-deliivo-dark">Browser alert delivery</h2>
                </div>
                <p className="mt-1 text-sm text-deliivo-gray">Status: {pushStatus.replaceAll('-', ' ')}</p>
                <p className="mt-1 text-xs text-deliivo-gray">
                  {unreadCount} unread
                  {lastSyncedAt ? ` | Last synced ${new Date(lastSyncedAt).toLocaleTimeString()}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {(pushStatus === 'permission-default' || pushStatus === 'enabled') && (
                  <button type="button" onClick={enableAlerts} disabled={busy} className="btn-outline py-2 px-4 text-sm">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {pushStatus === 'enabled' ? 'Refresh browser device' : 'Enable browser alerts'}
                  </button>
                )}
                <button type="button" onClick={() => { void refresh(); }} className="btn-outline py-2 px-4 text-sm">
                  Refresh notifications
                </button>
              </div>
            </div>
          </div>
          <NotificationPanel maxItems={50} showViewAll={false} />
        </div>
      </main>
    </ProtectedRoute>
  );
}
