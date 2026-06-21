'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, Info, X } from 'lucide-react';
import { AppFeedbackPayload, onAppFeedback } from '@/lib/app-feedback';

type Toast = AppFeedbackPayload & {
  id: string;
};

const iconByKind = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

const classByKind = {
  success: 'border-green-100 bg-green-50 text-green-700',
  error: 'border-red-100 bg-red-50 text-red-700',
  info: 'border-orange-100 bg-orange-50 text-deliivo-orange',
};

export default function AppFeedbackToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return onAppFeedback((payload) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setToasts((prev) => [{ ...payload, id }, ...prev].slice(0, 4));
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, payload.kind === 'error' ? 9000 : 5000);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-4 z-50 flex w-[min(26rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => {
        const Icon = iconByKind[toast.kind];
        return (
          <div key={toast.id} className="rounded-lg border border-gray-100 bg-white p-4 shadow-lg">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${classByKind[toast.kind]}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-deliivo-dark">{toast.title}</p>
                {toast.message && <p className="mt-1 break-words text-xs leading-5 text-deliivo-gray">{toast.message}</p>}
              </div>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((item) => item.id !== toast.id))}
                className="rounded-full p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                aria-label="Dismiss message"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
