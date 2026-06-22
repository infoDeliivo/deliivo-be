'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Bell,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  CreditCard,
  Globe,
  Loader2,
  RefreshCw,
  Shield,
  TriangleAlert,
} from 'lucide-react';
import { adminApi, AdminOperationsSummary, HealthReadyStatus, getApiErrorMessage } from '@/lib/api';
import { showError } from '@/lib/app-feedback';
import LoadFailureCard from '@/components/LoadFailureCard';

type ReadinessTone = 'pass' | 'warn' | 'fail';

type ReadinessItem = {
  label: string;
  description: string;
  tone: ReadinessTone;
  action?: string;
};

function toneClasses(tone: ReadinessTone) {
  if (tone === 'pass') return 'bg-green-50 text-green-700 border-green-200';
  if (tone === 'warn') return 'bg-amber-50 text-amber-700 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

function toneLabel(tone: ReadinessTone) {
  if (tone === 'pass') return 'Passing';
  if (tone === 'warn') return 'Watch';
  return 'Blocked';
}

function formatUptime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

export default function AdminSettingsPage() {
  const [ops, setOps] = useState<AdminOperationsSummary | null>(null);
  const [health, setHealth] = useState<HealthReadyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadDiagnostics();
  }, []);

  async function loadDiagnostics(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [opsRes, healthRes] = await Promise.all([
        adminApi.getOperationsSummary(),
        adminApi.getReadinessHealth(),
      ]);
      setOps(opsRes.data);
      setHealth(healthRes.data);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to load diagnostics');
      setError(message);
      showError('Could not load diagnostics', message);
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  const readiness = useMemo<ReadinessItem[]>(() => {
    if (!ops) return [];

    return [
      {
        label: 'Core runtime',
        description: ops.checks.database && ops.checks.redis
          ? 'Database and Redis are reachable.'
          : 'One or more core dependencies are unavailable.',
        tone: ops.checks.database && ops.checks.redis ? 'pass' : 'fail',
        action: ops.checks.database && ops.checks.redis ? undefined : 'Restore database or Redis connectivity before ride-day testing.',
      },
      {
        label: 'Stripe payments',
        description: ops.configuration.stripeSecretConfigured && ops.configuration.stripeWebhookConfigured
          ? 'Stripe secret and webhook configuration are present.'
          : 'Stripe payment or webhook configuration is incomplete.',
        tone: ops.configuration.stripeSecretConfigured && ops.configuration.stripeWebhookConfigured ? 'pass' : 'fail',
        action: ops.configuration.stripeSecretConfigured && ops.configuration.stripeWebhookConfigured ? undefined : 'Set Stripe secret and webhook secret, then verify webhook delivery.',
      },
      {
        label: 'Notification acceleration',
        description: ops.configuration.firebaseConfigured
          ? 'Firebase admin configuration exists for push acceleration.'
          : 'Firebase admin configuration is missing. Persisted notifications still work.',
        tone: ops.configuration.firebaseConfigured ? 'pass' : 'warn',
        action: ops.configuration.firebaseConfigured ? undefined : 'Push support is optional, but configure Firebase before production rollout.',
      },
      {
        label: 'Financial reconciliation',
        description: ops.operations.openReconciliationIssues === 0
          ? 'No open reconciliation issues are blocking release review.'
          : `${ops.operations.openReconciliationIssues} open reconciliation issues require triage.`,
        tone: ops.operations.openReconciliationIssues === 0 ? 'pass' : ops.operations.openReconciliationIssues < 5 ? 'warn' : 'fail',
        action: ops.operations.openReconciliationIssues === 0 ? undefined : 'Review the revenue page and resolve or document each open issue.',
      },
      {
        label: 'Payment queue backlog',
        description: ops.operations.pendingPaymentRecords === 0
          ? 'No pending internal payment records are waiting for cleanup.'
          : `${ops.operations.pendingPaymentRecords} payment records still need reconciliation or webhook completion.`,
        tone: ops.operations.pendingPaymentRecords === 0 ? 'pass' : 'warn',
        action: ops.operations.pendingPaymentRecords === 0 ? undefined : 'Run reconciliation and verify pending records are expected.',
      },
      {
        label: 'Runtime health endpoint',
        description: health?.status === 'ready'
          ? 'Backend readiness endpoint reports the deployment is ready.'
          : 'Readiness endpoint reports at least one required dependency is missing.',
        tone: health?.status === 'ready' ? 'pass' : 'fail',
        action: health?.status === 'ready' ? undefined : 'Fix the failed readiness checks before testing ride-day flows.',
      },
    ];
  }, [health, ops]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    );
  }

  if (error || !ops) {
    return (
      <LoadFailureCard
        title="Admin diagnostics unavailable"
        message={error || 'Diagnostics are unavailable right now.'}
        onRetry={() => loadDiagnostics()}
      />
    );
  }

  const sections = [
    {
      icon: Globe,
      title: 'General',
      description: 'Platform runtime and content footprint.',
      rows: [
        ['Uptime', formatUptime(ops.uptimeSeconds)],
        ['Content posts', String(ops.content.total)],
        ['Content locales', ops.content.locales.join(', ') || 'None'],
        ['Last content update', ops.content.updatedAt ? new Date(ops.content.updatedAt).toLocaleString() : 'Never'],
      ],
    },
    {
      icon: CreditCard,
      title: 'Payments',
      description: 'Stripe and reconciliation readiness.',
      rows: [
        ['Stripe secret key', ops.configuration.stripeSecretConfigured ? 'Configured' : 'Missing'],
        ['Stripe webhook secret', ops.configuration.stripeWebhookConfigured ? 'Configured' : 'Missing'],
        ['Open reconciliation issues', String(ops.operations.openReconciliationIssues)],
        ['Pending payment records', String(ops.operations.pendingPaymentRecords)],
      ],
    },
    {
      icon: Bell,
      title: 'Notifications',
      description: 'Push delivery configuration status.',
      rows: [
        ['Firebase admin config', ops.configuration.firebaseConfigured ? 'Configured' : 'Missing'],
        ['Webhook events in 24h', String(ops.operations.webhookEvents24h)],
        ['Persisted notification path', 'Required baseline'],
        ['Browser push path', ops.configuration.firebaseConfigured ? 'Available for acceleration' : 'Not configured'],
      ],
    },
    {
      icon: Shield,
      title: 'Security & infra',
      description: 'Core backend dependency checks.',
      rows: [
        ['Database', ops.checks.database ? 'Healthy' : 'Down'],
        ['Redis', ops.checks.redis ? 'Healthy' : 'Down'],
        ['Payout eligible payments', String(ops.operations.payoutEligiblePayments)],
        ['Admin support override rule', 'Use ride ID + booking ID before refund or override'],
      ],
    },
  ];

  const blockers = readiness.filter((item) => item.tone === 'fail');
  const warnings = readiness.filter((item) => item.tone === 'warn');

  const smokeChecks = [
    {
      title: 'Ride booking path',
      description: 'Publish a ride, book with a saved card, confirm driver acceptance, and ensure both rider and driver surfaces update.',
      href: '/admin/rides',
    },
    {
      title: 'Payment and reconciliation path',
      description: 'Confirm Stripe webhook delivery, open reconciliation count, and ledger entries for the same booking.',
      href: '/admin/revenue',
    },
    {
      title: 'Dispute and support path',
      description: 'Open a dispute, collect evidence, verify ride linkage, and confirm admin resolution flow is usable.',
      href: '/admin/reports',
    },
  ];

  const overrideGuardrails = [
    'Before a refund or manual override, collect the ride ID, booking ID, actor, and the exact lifecycle state visible on screen.',
    'Use force refund only after checking payment, dispute, and reconciliation context on the admin revenue and dispute pages.',
    'When realtime looks stale, trust persisted notification history and canonical ride or booking data before changing state manually.',
    'If a manual action fixes a user issue, review reconciliation afterwards so the financial trail remains consistent.',
  ];

  const overridePolicy = [
    {
      title: 'Allowed support actions',
      tone: 'pass' as const,
      items: [
        'Resend a notification or recovery link after confirming the canonical state.',
        'Re-open a stale booking or ride page by refreshing the source of truth.',
        'Use dev-only ride simulation to unblock testing when env flags allow it.',
      ],
    },
    {
      title: 'Require admin review',
      tone: 'warn' as const,
      items: [
        'Force refund a booking after checking payment, dispute, and reconciliation context.',
        'Cancel or close a ride when payment or ride-day evidence shows the current state is wrong.',
        'Override a rider or driver flow when OTP, pickup, or cancellation is blocked but evidence exists.',
      ],
    },
    {
      title: 'Not allowed',
      tone: 'fail' as const,
      items: [
        'Edit ledger history or payment state directly in the UI.',
        'Apply a manual override without ride ID and booking ID.',
        'Use dev simulation, hidden bypasses, or support actions in production without audit trail.',
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-0.5">Platform diagnostics, release readiness, and support guardrails</p>
        </div>
        <button
          type="button"
          onClick={() => loadDiagnostics(true)}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:text-[#F97316] disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh diagnostics
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Release readiness</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">Current operational snapshot of the main release blockers and watch items.</p>
          <div className="mt-4 space-y-3">
            {readiness.map((item) => (
              <div key={item.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                    <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                    {item.action && <p className="mt-2 text-xs font-medium text-gray-500">{item.action}</p>}
                  </div>
                  <span className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${toneClasses(item.tone)}`}>
                    {toneLabel(item.tone)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900">Current status</h2>
          <div className="mt-4 space-y-3">
            <StatusMetric label="Readiness endpoint" value={health?.status === 'ready' ? 'Ready' : 'Not ready'} tone={health?.status === 'ready' ? 'pass' : 'fail'} />
            <StatusMetric label="Blocking items" value={String(blockers.length)} tone={blockers.length === 0 ? 'pass' : 'fail'} />
            <StatusMetric label="Watch items" value={String(warnings.length)} tone={warnings.length === 0 ? 'pass' : 'warn'} />
            <StatusMetric label="Runtime" value={ops.checks.database && ops.checks.redis ? 'Healthy' : 'Degraded'} tone={ops.checks.database && ops.checks.redis ? 'pass' : 'fail'} />
            <StatusMetric label="Webhook volume" value={String(ops.operations.webhookEvents24h)} tone={ops.operations.webhookEvents24h > 0 ? 'pass' : 'warn'} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Smoke checks</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">Run these flows before calling the current environment stable.</p>
          <div className="mt-4 space-y-3">
            {smokeChecks.map((item) => (
              <Link key={item.title} href={item.href} className="flex items-start justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 hover:border-[#F97316] hover:bg-orange-50/40">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                  <p className="mt-1 text-sm text-gray-600">{item.description}</p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-400" />
              </Link>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <CircleAlert className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Support override guardrails</h2>
          </div>
          <p className="mt-1 text-sm text-gray-500">Operational rules to keep support actions auditable and financially consistent.</p>
          <ul className="mt-4 space-y-3">
            {overrideGuardrails.map((item) => (
              <li key={item} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#F97316]" />
          <h2 className="text-sm font-semibold text-gray-900">Manual override policy</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">Use these rules to decide whether a support issue can be handled instantly, needs admin review, or must be refused.</p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {overridePolicy.map((section) => (
            <div key={section.title} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-gray-900">{section.title}</p>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses(section.tone)}`}>
                  {toneLabel(section.tone)}
                </span>
              </div>
              <ul className="mt-3 space-y-2 text-sm text-gray-700">
                {section.items.map((item) => (
                  <li key={item} className="rounded-lg bg-white px-3 py-2">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <TriangleAlert className="h-4 w-4 text-[#F97316]" />
          <h2 className="text-sm font-semibold text-gray-900">Readiness checks</h2>
        </div>
        <p className="mt-1 text-sm text-gray-500">Backend readiness endpoint state is the deployment gate for ride-day testing.</p>
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <HealthChip label="Database" value={health?.checks.database} />
          <HealthChip label="Redis" value={health?.checks.redis} />
          <HealthChip label="Auth secrets" value={health?.checks.authSecrets} />
          <HealthChip label="Stripe" value={health?.checks.stripe} />
          <HealthChip label="Firebase" value={health?.checks.firebase} />
        </div>
      </div>

      <div className="flex flex-col gap-5">
        {sections.map(({ icon: Icon, title, description, rows }) => (
          <div key={title} className="bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
                <Icon className="w-4 h-4 text-[#F97316]" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
                <p className="text-xs text-gray-400">{description}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {rows.map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                  <p className="text-xs font-medium text-gray-500">{label}</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{value}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusMetric({ label, value, tone }: { label: string; value: string; tone: ReadinessTone }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-gray-500">{label}</p>
          <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${toneClasses(tone)}`}>
          {toneLabel(tone)}
        </span>
      </div>
    </div>
  );
}

function HealthChip({ label, value }: { label: string; value?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${value ? 'text-green-700' : 'text-red-700'}`}>{value ? 'OK' : 'Missing'}</p>
    </div>
  );
}
