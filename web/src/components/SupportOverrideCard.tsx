'use client';

import Link from 'next/link';
import { Copy, LifeBuoy, ShieldAlert } from 'lucide-react';
import { showSuccess } from '@/lib/app-feedback';
import { publicConfig } from '@/lib/public-config';

interface SupportOverrideCardProps {
  title?: string;
  copy?: string;
  identifiers: Array<{ label: string; value?: string | null }>;
  supportTopicHref?: string;
}

export default function SupportOverrideCard({
  title = 'Need a manual fallback?',
  copy = 'If OTP, pickup confirmation, or cancellation flow is blocked, keep the ride or booking ID handy and contact support. Support can only use override tools after checking the ride state, payment trail, and reconciliation context.',
  identifiers,
  supportTopicHref = '/contact',
}: SupportOverrideCardProps) {
  async function handleCopy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      showSuccess('Copied', value);
    } catch {
      // Keep this silent; the visible identifier still remains available.
    }
  }

  const visibleIdentifiers = identifiers.filter((item) => item.value);

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
          <ShieldAlert className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-amber-950">{title}</p>
              <p className="mt-1 text-xs leading-5 text-amber-900">{copy}</p>
            </div>
            <Link
              href={supportTopicHref}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
            >
              <LifeBuoy className="h-3.5 w-3.5" />
              Support
            </Link>
          </div>

          {visibleIdentifiers.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {visibleIdentifiers.map((item) => (
                <button
                  key={`${item.label}-${item.value}`}
                  type="button"
                  onClick={() => handleCopy(item.value!)}
                  className="flex items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white px-3 py-2 text-left hover:bg-amber-100/60"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">{item.label}</p>
                    <p className="truncate text-sm font-medium text-amber-950">{item.value}</p>
                  </div>
                  <Copy className="h-4 w-4 shrink-0 text-amber-700" />
                </button>
              ))}
            </div>
          )}

          <p className="mt-3 text-[11px] text-amber-800">
            Email: <a className="font-semibold underline" href={`mailto:${publicConfig.supportEmail}`}>{publicConfig.supportEmail}</a>
          </p>
        </div>
      </div>
    </div>
  );
}
