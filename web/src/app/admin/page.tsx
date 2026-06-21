'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Users, Car, DollarSign, CalendarCheck, TrendingUp, Loader2, Database, BellRing, CreditCard, Activity, ShieldCheck, FileWarning, BookOpen, ArrowRight } from 'lucide-react'
import { adminApi, AdminStats, AdminOperationsSummary } from '@/lib/api'
import LoadFailureCard from '@/components/LoadFailureCard'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [ops, setOps] = useState<AdminOperationsSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    loadDashboard()
  }, [])

  async function loadDashboard() {
    setLoading(true)
    setError('')
    try {
      const [statsRes, opsRes] = await Promise.all([adminApi.getStats(), adminApi.getOperationsSummary()])
      setStats(statsRes.data)
      setOps(opsRes.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    )
  }

  if (error) {
    return <LoadFailureCard title="Admin dashboard unavailable" message={error} onRetry={loadDashboard} />
  }

  const statCards = [
    { label: 'Total Users', value: stats?.totalUsers?.toLocaleString() || '0', icon: Users, bg: 'bg-blue-50', iconColor: 'text-blue-500' },
    { label: 'Total Rides', value: stats?.totalRides?.toLocaleString() || '0', icon: Car, bg: 'bg-orange-50', iconColor: 'text-[#F97316]' },
    { label: 'Total Bookings', value: stats?.totalBookings?.toLocaleString() || '0', icon: CalendarCheck, bg: 'bg-purple-50', iconColor: 'text-purple-500' },
    { label: 'Total Revenue', value: `EUR ${(stats?.totalRevenue || 0).toFixed(2)}`, icon: DollarSign, bg: 'bg-green-50', iconColor: 'text-green-500' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overview of platform activity</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, bg, iconColor }) => (
          <div key={label} className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className={`w-10 h-10 rounded-xl ${bg} flex items-center justify-center`}>
                <Icon className={`w-5 h-5 ${iconColor}`} />
              </div>
              <TrendingUp className="w-4 h-4 text-gray-300" />
            </div>
            <div>
              <p className="text-2xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {ops && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <OpsCard label="Backend health" value={ops.checks.database && ops.checks.redis ? 'Healthy' : 'Degraded'} icon={Database} tone={ops.checks.database && ops.checks.redis ? 'green' : 'red'} copy={`DB ${ops.checks.database ? 'ok' : 'down'} | Redis ${ops.checks.redis ? 'ok' : 'down'}`} />
            <OpsCard label="Notification readiness" value={ops.configuration.firebaseConfigured ? 'Ready' : 'Missing'} icon={BellRing} tone={ops.configuration.firebaseConfigured ? 'green' : 'amber'} copy="Firebase admin configuration" />
            <OpsCard label="Stripe readiness" value={ops.configuration.stripeSecretConfigured && ops.configuration.stripeWebhookConfigured ? 'Ready' : 'Partial'} icon={CreditCard} tone={ops.configuration.stripeSecretConfigured && ops.configuration.stripeWebhookConfigured ? 'green' : 'amber'} copy={`Webhook events 24h: ${ops.operations.webhookEvents24h}`} />
            <OpsCard label="Open reconciliation" value={String(ops.operations.openReconciliationIssues)} icon={Activity} tone={ops.operations.openReconciliationIssues === 0 ? 'green' : 'amber'} copy={`${ops.operations.pendingPaymentRecords} pending payment records`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <QuickLinkCard
              title="Ride operations"
              copy="Inspect ride lifecycle, support overrides, refunds, and rider or driver state mismatches."
              href="/admin/rides"
              icon={Car}
              meta={`${stats?.totalRides?.toLocaleString() || '0'} rides`}
            />
            <QuickLinkCard
              title="Revenue and ledger"
              copy="Review reconciliation, ledger drift, provider state, and payment repair work."
              href="/admin/revenue"
              icon={DollarSign}
              meta={`${ops.operations.openReconciliationIssues} open issues`}
            />
            <QuickLinkCard
              title="Disputes and evidence"
              copy="Handle reports with evidence collection, recommendations, and final resolutions."
              href="/admin/reports"
              icon={FileWarning}
              meta={`${stats?.totalBookings?.toLocaleString() || '0'} bookings tracked`}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900">Operational snapshot</h2>
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <p>Uptime: {Math.floor(ops.uptimeSeconds / 3600)}h {Math.floor((ops.uptimeSeconds % 3600) / 60)}m</p>
                <p>Payout eligible payments: {ops.operations.payoutEligiblePayments}</p>
                <p>Pending payment records: {ops.operations.pendingPaymentRecords}</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900">Content snapshot</h2>
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <p>Total posts: {ops.content.total}</p>
                <p>Published: {ops.content.published}</p>
                <p>Drafts: {ops.content.drafts}</p>
                <p>Locales: {ops.content.locales.join(', ') || 'None'}</p>
                <p>Updated: {ops.content.updatedAt ? new Date(ops.content.updatedAt).toLocaleString() : 'Never'}</p>
              </div>
            </div>
            <div className="bg-white rounded-2xl shadow-sm p-5">
              <h2 className="text-sm font-semibold text-gray-900">Operational SLA signals</h2>
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <SlaRow label="Platform runtime" status={ops.checks.database && ops.checks.redis ? 'healthy' : 'risk'} />
                <SlaRow label="Payment webhook path" status={ops.configuration.stripeSecretConfigured && ops.configuration.stripeWebhookConfigured ? 'healthy' : 'risk'} />
                <SlaRow label="Realtime alerts" status={ops.configuration.firebaseConfigured ? 'healthy' : 'watch'} />
                <SlaRow label="Support backlog" status={ops.operations.openReconciliationIssues === 0 ? 'healthy' : ops.operations.openReconciliationIssues < 5 ? 'watch' : 'risk'} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <CompactOpsStat icon={ShieldCheck} label="Database and Redis" value={ops.checks.database && ops.checks.redis ? 'Passing' : 'Needs attention'} tone={ops.checks.database && ops.checks.redis ? 'green' : 'red'} />
            <CompactOpsStat icon={BookOpen} label="Content readiness" value={ops.content.published > 0 ? `${ops.content.published} published posts` : 'No published posts'} tone={ops.content.published > 0 ? 'green' : 'amber'} />
            <CompactOpsStat icon={Activity} label="Pending payments" value={String(ops.operations.pendingPaymentRecords)} tone={ops.operations.pendingPaymentRecords === 0 ? 'green' : 'amber'} />
          </div>
        </>
      )}
    </div>
  )
}

function OpsCard({ label, value, icon: Icon, tone, copy }: { label: string; value: string; icon: any; tone: 'green' | 'amber' | 'red'; copy: string }) {
  const tones = {
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  } as const

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 rounded-xl ${tones[tone]} flex items-center justify-center`}>
          <Icon className="w-5 h-5" />
        </div>
        <TrendingUp className="w-4 h-4 text-gray-300" />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
        <p className="text-xs text-gray-400 mt-2">{copy}</p>
      </div>
    </div>
  )
}

function QuickLinkCard({ title, copy, href, icon: Icon, meta }: { title: string; copy: string; href: string; icon: any; meta: string }) {
  return (
    <Link href={href} className="group rounded-2xl bg-white p-5 shadow-sm transition-colors hover:bg-orange-50/40">
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-50 text-[#F97316]">
          <Icon className="h-5 w-5" />
        </div>
        <ArrowRight className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#F97316]" />
      </div>
      <p className="mt-4 text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-sm text-gray-500">{copy}</p>
      <p className="mt-3 text-xs font-medium text-[#F97316]">{meta}</p>
    </Link>
  )
}

function SlaRow({ label, status }: { label: string; status: 'healthy' | 'watch' | 'risk' }) {
  const styles = {
    healthy: 'bg-green-100 text-green-700',
    watch: 'bg-amber-100 text-amber-700',
    risk: 'bg-red-100 text-red-700',
  } as const
  const labels = {
    healthy: 'Healthy',
    watch: 'Watch',
    risk: 'At risk',
  } as const

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2">
      <span>{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>
    </div>
  )
}

function CompactOpsStat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone: 'green' | 'amber' | 'red' }) {
  const styles = {
    green: 'bg-green-50 text-green-700',
    amber: 'bg-amber-50 text-amber-700',
    red: 'bg-red-50 text-red-700',
  } as const

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${styles[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
      </div>
      <p className="mt-3 text-sm font-semibold text-gray-900">{value}</p>
    </div>
  )
}
