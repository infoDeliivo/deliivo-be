'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { getApiErrorMessage, safetyApi, type EmergencySosRole } from '@/lib/api';
import { showError, showSuccess } from '@/lib/app-feedback';

type EmergencySosButtonProps = {
  rideId: string;
  bookingId?: string;
  role: EmergencySosRole;
  className?: string;
};

function getCurrentPosition(): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (position) => resolve({
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 }
    );
  });
}

export default function EmergencySosButton({ rideId, bookingId, role, className = '' }: EmergencySosButtonProps) {
  const [loading, setLoading] = useState(false);

  async function handleSos() {
    const confirmed = window.confirm(
      'If you are in immediate danger, call local emergency services first. Send an SOS alert to Deliivo support now?'
    );
    if (!confirmed) return;

    const rawMessage = window.prompt('Optional message for support', '') || '';
    setLoading(true);
    try {
      const position = await getCurrentPosition();
      await safetyApi.createSos({
        rideId,
        bookingId,
        role,
        message: rawMessage.trim() || undefined,
        lat: position?.lat,
        lng: position?.lng,
      });
      showSuccess(
        'SOS sent',
        'Deliivo support was notified with the linked ride details. Contact local emergency services if you are in danger.'
      );
    } catch (error: unknown) {
      showError('Could not send SOS', getApiErrorMessage(error, 'Failed to send emergency alert'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleSos}
      disabled={loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-50 ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
      SOS
    </button>
  );
}
