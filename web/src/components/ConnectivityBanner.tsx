'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Wifi, WifiOff } from 'lucide-react';

export default function ConnectivityBanner() {
  const [isOnline, setIsOnline] = useState(true);
  const [showRecovered, setShowRecovered] = useState(false);

  useEffect(() => {
    const initial = typeof navigator === 'undefined' ? true : navigator.onLine;
    setIsOnline(initial);

    let recoverTimer: ReturnType<typeof setTimeout> | null = null;

    const handleOnline = () => {
      setIsOnline(true);
      setShowRecovered(true);
      if (recoverTimer) clearTimeout(recoverTimer);
      recoverTimer = setTimeout(() => setShowRecovered(false), 5000);
    };

    const handleOffline = () => {
      if (recoverTimer) clearTimeout(recoverTimer);
      setShowRecovered(false);
      setIsOnline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      if (recoverTimer) clearTimeout(recoverTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  if (isOnline && !showRecovered) return null;

  return (
    <div className="fixed inset-x-4 top-4 z-[90] flex justify-center pointer-events-none">
      <div
        className={`pointer-events-auto flex w-full max-w-2xl items-start gap-3 rounded-2xl border px-4 py-3 shadow-lg backdrop-blur ${
          isOnline
            ? 'border-green-200 bg-green-50/95 text-green-900'
            : 'border-amber-200 bg-amber-50/95 text-amber-950'
        }`}
      >
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
          isOnline ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {isOnline ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {isOnline ? 'Connection restored' : 'You are offline'}
          </p>
          <p className="mt-0.5 text-xs leading-5">
            {isOnline
              ? 'The app is syncing the latest ride, booking, and notification state.'
              : 'Actions may fail or appear delayed until the connection comes back. Avoid repeating payments or booking actions while offline.'}
          </p>
        </div>
        {!isOnline && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />}
      </div>
    </div>
  );
}
