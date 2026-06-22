'use client';

import { AuthProvider } from '@/lib/auth-context';
import NotificationToast from '@/components/NotificationToast';
import OngoingRidePanel from '@/components/OngoingRidePanel';
import AppFeedbackToast from '@/components/AppFeedbackToast';
import { I18nProvider } from '@/lib/i18n-context';
import ConnectivityBanner from '@/components/ConnectivityBanner';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <AuthProvider>
        {children}
        <ConnectivityBanner />
        <OngoingRidePanel />
        <AppFeedbackToast />
        <NotificationToast />
      </AuthProvider>
    </I18nProvider>
  );
}
