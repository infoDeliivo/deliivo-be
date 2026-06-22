'use client';

import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  Clock3,
  Database,
  Fingerprint,
  Loader2,
  ShieldAlert,
  Route,
  CreditCard,
  MessageSquareWarning,
  Search,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { adminApi, AdminMonitoringTrend, AdminOperationsSummary, AdminStats, getApiErrorMessage } from '@/lib/api';
import LoadFailureCard from '@/components/LoadFailureCard';

function metricClass(tone: 'good' | 'watch' | 'bad') {
  if (tone === 'good') return 'bg-green-50 text-green-700 border-green-200';
  if (tone === 'watch') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export default function AdminMonitoringPage() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [ops, setOps] = useState<AdminOperationsSummary | null>(null);
  const [trends, setTrends] = useState<AdminMonitoringTrend[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMonitoring();
  }, []);

  async function loadMonitoring(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [statsRes, opsRes, trendsRes] = await Promise.all([
        adminApi.getStats(),
        adminApi.getOperationsSummary(),
        adminApi.getMonitoringTrends(),
      ]);
      setStats(statsRes.data);
      setOps(opsRes.data);
      setTrends(trendsRes.data);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load monitoring data'));
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    );
  }

  if (error || !ops || !stats || !trends) {
    return (
      <LoadFailureCard
        title="Monitoring unavailable"
        message={error || 'Monitoring data is unavailable right now.'}
        onRetry={() => loadMonitoring()}
      />
    );
  }

  const kpis = [
    { label: 'Users', value: stats.totalUsers.toLocaleString(), tone: 'good' as const, copy: 'Marketplace identity footprint' },
    { label: 'Rides', value: stats.totalRides.toLocaleString(), tone: 'good' as const, copy: 'Supply-side activity' },
    { label: 'Bookings', value: stats.totalBookings.toLocaleString(), tone: 'good' as const, copy: 'Demand-side activity' },
    { label: 'Revenue', value: `EUR ${stats.totalRevenue.toFixed(2)}`, tone: 'watch' as const, copy: 'Gross processed value' },
  ];

  const slas = [
    { label: 'Booking request creation', target: 'p95 < 2s', actual: 'Covered by API response monitoring', tone: 'good' as const },
    { label: 'Payment confirmation feedback', target: 'p95 < 5s', actual: 'Track card confirmation retries and direct Stripe fallback', tone: 'watch' as const },
    { label: 'Driver booking notification', target: 'p95 < 10s', actual: `${ops.operations.webhookEvents24h} webhook events in 24h`, tone: 'good' as const },
    { label: 'Ride-day actions', target: 'p95 < 2s', actual: 'Driver arrived, pickup, no-show, drop-off, completion', tone: ops.checks.database && ops.checks.redis ? 'good' as const : 'bad' as const },
    { label: 'Reconciliation triage', target: '1 business day', actual: `${ops.operations.openReconciliationIssues} open issues`, tone: ops.operations.openReconciliationIssues === 0 ? 'good' as const : 'watch' as const },
    { label: 'Manual dispute resolution', target: '3 business days', actual: 'Tracked in admin disputes and revenue pages', tone: 'watch' as const },
  ];

  const signals = [
    { label: 'API error rate', icon: AlertTriangle, detail: 'Track per route, status code, and module in backend logs.', href: '/admin/settings', tone: 'watch' as const },
    { label: 'Queue health', icon: MessageSquareWarning, detail: 'Monitor SMS, mail, push, expiry, payment, and reconciliation queues.', href: '/admin/settings', tone: ops.operations.pendingPaymentRecords > 0 ? 'watch' as const : 'good' as const },
    { label: 'Webhook latency', icon: BellRing, detail: 'Stripe webhook duplicate count, failure count, and processing delay.', href: '/admin/revenue', tone: ops.configuration.stripeWebhookConfigured ? 'good' as const : 'bad' as const },
    { label: 'Ride lifecycle events', icon: Route, detail: 'Started rides, arrived events, OTP/pickup events, no-shows, completions.', href: '/admin/rides', tone: 'good' as const },
    { label: 'Ledger imbalance', icon: CreditCard, detail: 'Open reconciliation issues, payout eligible records, and payment drift.', href: '/admin/revenue', tone: ops.operations.openReconciliationIssues === 0 ? 'good' as const : 'bad' as const },
    { label: 'Booking transitions', icon: Search, detail: 'Invalid transitions and stale states should be logged with ride and booking IDs.', href: '/admin/rides', tone: 'watch' as const },
  ];

  const dashboards = [
    { title: 'Marketplace funnel', copy: 'Searches, detail opens, booking starts, payments, confirmations, completions.', href: '/admin/rides' },
    { title: 'Ride-day operations', copy: 'Started rides, pickup flow, OTP checks, no-shows, drop-offs, completions.', href: '/admin/rides' },
    { title: 'Notifications', copy: 'Created by type, delivery attempts, failures, unread counts.', href: '/profile/notifications' },
    { title: 'Payments and payouts', copy: 'Payment statuses, refunds, payout eligible, payout completed, reconciliation issues.', href: '/admin/revenue' },
    { title: 'Disputes and safety', copy: 'Opened disputes, evidence completeness, recommendations, terminal outcomes.', href: '/admin/reports' },
  ];

  const maxTrendValue = Math.max(
    1,
    ...trends.flatMap((item) => [item.ridesPublished, item.bookingsCreated, item.webhookEvents, Math.round(item.revenue)]),
  );

  const logs = [
    'Structured identifiers: `userId`, `rideId`, `bookingId`, `paymentId`, `disputeId`, `stripeEventId`, and `actionId` when available.',
    'Do not log card details, raw OTPs in production, Stripe secrets, JWTs, or full service account JSON.',
    'User-facing failures should still emit backend logs so support can correlate screen errors with system events.',
    'Support overrides must leave an audit trail and be followed by reconciliation review.',
  ];

  const tracing = [
    'Every response now echoes `x-request-id` so support can copy one ID from the UI and search backend logs.',
    'HTTP request completion logs include method, path, status, duration, and user ID when available.',
    'Retryable UI failures should keep the request ID visible in the error payload for cross-checking.',
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">KPIs, SLA targets, and operational signals for the live marketplace.</p>
        </div>
        <button
          type="button"
          onClick={() => loadMonitoring(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:text-[#F97316] disabled:opacity-50"
        >
          <Activity className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh monitoring
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((item) => (
          <div key={item.label} className={`rounded-2xl border p-5 shadow-sm ${metricClass(item.tone)}`}>
            <p className="text-xs font-medium uppercase tracking-wide opacity-80">{item.label}</p>
            <p className="mt-2 text-2xl font-bold text-inherit">{item.value}</p>
            <p className="mt-1 text-xs opacity-80">{item.copy}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Route className="h-4 w-4 text-[#F97316]" />
          <h2 className="text-sm font-semibold text-gray-900">7-day activity trend</h2>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2">
            <thead>
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Day</th>
                <th className="px-3 py-2">Rides</th>
                <th className="px-3 py-2">Bookings</th>
                <th className="px-3 py-2">Webhooks</th>
                <th className="px-3 py-2">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {trends.map((item) => (
                <tr key={item.date} className="rounded-xl bg-gray-50 text-sm text-gray-700">
                  <td className="px-3 py-3 font-semibold text-gray-900">{item.date}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 w-32 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-[#F97316]" style={{ width: `${Math.max(8, (item.ridesPublished / maxTrendValue) * 100)}%` }} />
                      </div>
                      <span>{item.ridesPublished}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 w-32 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(8, (item.bookingsCreated / maxTrendValue) * 100)}%` }} />
                      </div>
                      <span>{item.bookingsCreated}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 w-32 overflow-hidden rounded-full bg-gray-200">
                        <div className="h-full rounded-full bg-violet-500" style={{ width: `${Math.max(8, (item.webhookEvents / maxTrendValue) * 100)}%` }} />
                      </div>
                      <span>{item.webhookEvents}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 font-medium text-gray-900">EUR {item.revenue.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Operational SLAs</h2>
          </div>
          <div className="mt-4 space-y-3">
            {slas.map((item) => (
              <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                    <p className="mt-1 text-sm text-gray-600">{item.actual}</p>
                  </div>
                  <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${metricClass(item.tone)}`}>
                    {item.target}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Monitoring signals</h2>
          </div>
          <div className="mt-4 space-y-3">
            {signals.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.label} href={item.href} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 hover:border-[#F97316] hover:bg-orange-50/40">
                  <div className="flex items-start gap-3 min-w-0">
                    <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg ${metricClass(item.tone)}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                      <p className="mt-1 text-sm text-gray-600">{item.detail}</p>
                    </div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Structured logging</h2>
          </div>
          <div className="mt-4 space-y-3">
            {logs.map((line) => (
              <div key={line} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                {line}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Dashboards to build</h2>
          </div>
          <div className="mt-4 space-y-3">
            {dashboards.map((item) => (
              <Link key={item.title} href={item.href} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 hover:border-[#F97316] hover:bg-orange-50/40">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-1 text-sm text-gray-600">{item.copy}</p>
                </div>
                <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Fingerprint className="h-4 w-4 text-[#F97316]" />
          <h2 className="text-sm font-semibold text-gray-900">Trace correlation</h2>
        </div>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {tracing.map((line) => (
            <div key={line} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              {line}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
