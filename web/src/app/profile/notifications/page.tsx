'use client';

import ProtectedRoute from '@/components/ProtectedRoute';
import Navbar from '@/components/Navbar';
import NotificationPanel from '@/components/NotificationPanel';

export default function NotificationsPage() {
  return (
    <ProtectedRoute>
      <Navbar />
      <main className="w-full px-4 py-8 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-5xl">
          <h1 className="mb-6 text-2xl font-bold text-deliivo-dark">Notifications</h1>
          <NotificationPanel maxItems={50} showViewAll={false} />
        </div>
      </main>
    </ProtectedRoute>
  );
}
