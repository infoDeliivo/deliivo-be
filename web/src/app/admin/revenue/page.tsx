'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { DollarSign, AlertTriangle, CheckCircle2, Loader2, AlertCircle, Play, ChevronDown, Clipboard, ExternalLink } from 'lucide-react'
import { adminApi, ReconciliationSummary, ReconciliationIssue, Pagination, AdminRevenueLedger, getApiErrorMessage } from '@/lib/api'
import { showError, showSuccess } from '@/lib/app-feedback'
import LoadFailureCard from '@/components/LoadFailureCard'

const severityStyle: Record<string, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  MEDIUM: 'bg-yellow-50 text-yellow-700',
  HIGH: 'bg-orange-50 text-orange-700',
  CRITICAL: 'bg-red-50 text-red-600',
}

const issueTypeStyle: Record<string, string> = {
  STRIPE_MISMATCH: 'bg-purple-50 text-purple-700',
  MISSING_WEBHOOK: 'bg-blue-50 text-blue-700',
  ORPHAN_INTENT: 'bg-gray-100 text-gray-700',
  LEDGER_IMBALANCE: 'bg-red-50 text-red-600',
  STALE_ESCROW: 'bg-orange-50 text-orange-700',
  DISPUTE_PAYMENT_MISMATCH: 'bg-rose-50 text-rose-700',
}

export default function AdminRevenuePage() {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [issues, setIssues] = useState<ReconciliationIssue[]>([])
  const [ledger, setLedger] = useState<AdminRevenueLedger | null>(null)
  const [issuePagination, setIssuePagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved'>('open')
  const [issuePage, setIssuePage] = useState(1)
  const [ledgerPage, setLedgerPage] = useState(1)
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [resolveText, setResolveText] = useState('')
  const [accountType, setAccountType] = useState('ALL')
  const [issueType, setIssueType] = useState('ALL')
  const [severity, setSeverity] = useState('ALL')

  useEffect(() => { loadData() }, [issuePage, ledgerPage, statusFilter, accountType, issueType, severity])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [summaryRes, issuesRes, ledgerRes] = await Promise.all([
        adminApi.getReconciliationSummary(),
        adminApi.getReconciliationIssues({
          status: statusFilter,
          page: issuePage,
          limit: 20,
          issueType: issueType === 'ALL' ? undefined : issueType,
          severity: severity === 'ALL' ? undefined : severity,
        }),
        adminApi.getRevenueLedger({ page: ledgerPage, limit: 20, accountType }),
      ])
      setSummary(summaryRes.data)
      setIssues(issuesRes.data.issues)
      setIssuePagination(issuesRes.data.pagination)
      setLedger(ledgerRes.data)
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to load data')
      setError(message)
      showError('Could not load revenue data', message)
    } finally {
      setLoading(false)
    }
  }

  async function runJob(type: 'hourly' | 'daily') {
    setRunningJob(type)
    try {
      if (type === 'hourly') await adminApi.runHourlyReconciliation()
      else await adminApi.runDailyReconciliation()
      await loadData()
      showSuccess('Reconciliation completed', `${type === 'hourly' ? 'Hourly' : 'Daily'} reconciliation finished.`)
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to run reconciliation')
      setError(message)
      showError('Reconciliation failed', message)
    }
    finally { setRunningJob(null) }
  }

  async function handleResolveIssue(id: string) {
    if (!resolveText.trim()) return
    try {
      await adminApi.resolveReconciliationIssue(id, resolveText.trim())
      setOpenMenu(null)
      setResolveText('')
      await loadData()
      showSuccess('Issue resolved', resolveText.trim())
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to resolve issue')
      setError(message)
      showError('Resolve failed', message)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Revenue & Reconciliation</h1>
          <p className="text-sm text-gray-500 mt-0.5">Financial health monitoring</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => runJob('hourly')}
            disabled={runningJob !== null}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white hover:border-[#F97316] hover:text-[#F97316] disabled:opacity-50 transition-colors"
          >
            <Play className="w-3 h-3" />
            {runningJob === 'hourly' ? 'Running...' : 'Run Hourly'}
          </button>
          <button
            onClick={() => runJob('daily')}
            disabled={runningJob !== null}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-xl border border-gray-200 bg-white hover:border-[#F97316] hover:text-[#F97316] disabled:opacity-50 transition-colors"
          >
            <Play className="w-3 h-3" />
            {runningJob === 'daily' ? 'Running...' : 'Run Daily'}
          </button>
        </div>
      </div>

      {error && (
        <LoadFailureCard title="Revenue tools reported an error" message={error} onRetry={loadData} />
      )}

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              <p className="text-xs text-gray-500 font-medium">Open Issues</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.open}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <p className="text-xs text-gray-500 font-medium">Auto-Repaired</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.autoRepaired}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-[#F97316]" />
              <p className="text-xs text-gray-500 font-medium">Total Scanned</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{summary.total}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium mb-2">By Severity</p>
            <div className="flex flex-wrap gap-1.5">
              {summary.bySeverity.CRITICAL > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 text-red-600">{summary.bySeverity.CRITICAL} CRIT</span>}
              {summary.bySeverity.HIGH > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-orange-50 text-orange-600">{summary.bySeverity.HIGH} HIGH</span>}
              {summary.bySeverity.MEDIUM > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700">{summary.bySeverity.MEDIUM} MED</span>}
              {summary.bySeverity.LOW > 0 && <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">{summary.bySeverity.LOW} LOW</span>}
              {Object.values(summary.bySeverity).every(v => v === 0) && <span className="text-xs text-gray-400">None</span>}
            </div>
          </div>
        </div>
      )}

      {ledger && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium">Net Platform</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">EUR {ledger.summary.netPlatformRevenue.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium">Platform Credits</p>
            <p className="mt-1 text-2xl font-bold text-green-700">EUR {ledger.summary.platformCredits.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium">Platform Debits</p>
            <p className="mt-1 text-2xl font-bold text-red-600">EUR {ledger.summary.platformDebits.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium">Rider Credits</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">EUR {ledger.summary.riderCredits.toFixed(2)}</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-gray-500 font-medium">Driver Credits</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">EUR {ledger.summary.driverCredits.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex gap-2">
        {(['open', 'resolved'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(s); setIssuePage(1) }}
            className={`px-4 py-2 text-xs font-medium rounded-xl border transition-colors capitalize ${
              statusFilter === s
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#F97316] hover:text-[#F97316]'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Ledger entries</h2>
            <p className="mt-0.5 text-xs text-gray-500">Audit trail for rider, driver, platform, and provider accounts.</p>
          </div>
          <select
            value={accountType}
            onChange={(event) => { setAccountType(event.target.value); setLedgerPage(1) }}
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none"
          >
            {['ALL', 'RIDER', 'DRIVER', 'PLATFORM', 'PROVIDER'].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto rounded-xl border border-gray-100">
          <table className="w-full text-xs">
            <thead className="bg-gray-50 text-gray-400">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Account</th>
                <th className="px-3 py-2 text-left font-medium">Entry</th>
                <th className="px-3 py-2 text-left font-medium">Booking</th>
                <th className="px-3 py-2 text-left font-medium">Payment/User</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(ledger?.entries || []).map((entry) => (
                <tr key={entry.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="px-3 py-2 text-gray-700">{entry.accountType}</td>
                  <td className="px-3 py-2 text-gray-600">{entry.entryType.replace(/_/g, ' ')}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {entry.bookingId ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <CopyableId id={entry.bookingId} label="Booking ID" />
                        <Link href={`/admin/rides?search=${encodeURIComponent(entry.bookingId)}&searchBy=bookingId`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F97316] hover:underline">
                          Ride <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                    ) : '-'}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    <div className="flex flex-col gap-1">
                      {entry.paymentId ? <span>Payment <CopyableId id={entry.paymentId} label="Payment ID" /></span> : null}
                      {entry.userId ? <span>User <CopyableId id={entry.userId} label="User ID" /></span> : null}
                      {!entry.paymentId && !entry.userId ? '-' : null}
                    </div>
                  </td>
                  <td className={`px-3 py-2 text-right font-semibold ${entry.direction === 'CREDIT' ? 'text-green-700' : 'text-red-600'}`}>
                    {entry.direction === 'CREDIT' ? '+' : '-'}{entry.currency} {entry.amount.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ledger?.entries.length === 0 && <div className="py-10 text-center text-sm text-gray-400">No ledger entries found.</div>}
        </div>
        {ledger?.pagination && ledger.pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-gray-400">Ledger page {ledgerPage} of {ledger.pagination.totalPages}</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setLedgerPage((value) => Math.max(1, value - 1))} disabled={ledgerPage === 1} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                &lt;
              </button>
              <button type="button" onClick={() => setLedgerPage((value) => Math.min(ledger.pagination.totalPages, value + 1))} disabled={ledgerPage === ledger.pagination.totalPages} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                &gt;
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Issues table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[#F97316]" />
          </div>
        ) : (
          <>
            <div className="border-b border-gray-100 px-6 py-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-gray-900">Reconciliation issues</h2>
                  <p className="mt-0.5 text-xs text-gray-500">Filter financial drift by type and severity before resolving.</p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select value={issueType} onChange={(event) => { setIssueType(event.target.value); setIssuePage(1) }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none">
                    {['ALL', 'STRIPE_MISMATCH', 'MISSING_WEBHOOK', 'ORPHAN_INTENT', 'LEDGER_IMBALANCE', 'STALE_ESCROW', 'DISPUTE_PAYMENT_MISMATCH'].map((value) => (
                      <option key={value} value={value}>{value === 'ALL' ? 'All issue types' : value.replace(/_/g, ' ')}</option>
                    ))}
                  </select>
                  <select value={severity} onChange={(event) => { setSeverity(event.target.value); setIssuePage(1) }} className="rounded-xl border border-gray-200 px-3 py-2 text-sm focus:border-[#F97316] focus:outline-none">
                    {['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => (
                      <option key={value} value={value}>{value === 'ALL' ? 'All severities' : value}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Severity</th>
                    <th className="text-left px-4 py-3 font-medium">Booking / Payment</th>
                    <th className="text-left px-4 py-3 font-medium">Description</th>
                    <th className="text-left px-4 py-3 font-medium">Detected</th>
                    <th className="text-right px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map(issue => (
                    <tr key={issue.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${issueTypeStyle[issue.issueType] || 'bg-gray-100 text-gray-600'}`}>
                          {issue.issueType.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${severityStyle[issue.severity] || severityStyle.LOW}`}>
                          {issue.severity}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        <div className="flex flex-col gap-1">
                          {issue.bookingId ? (
                            <div className="flex items-center gap-2">
                              <CopyableId id={issue.bookingId} label="Booking ID" />
                              <Link href={`/admin/rides?search=${encodeURIComponent(issue.bookingId)}&searchBy=bookingId`} className="inline-flex items-center gap-1 font-semibold text-[#F97316] hover:underline">
                                Ride <ExternalLink className="h-3 w-3" />
                              </Link>
                            </div>
                          ) : <span>-</span>}
                          {issue.paymentId ? <span>Payment <CopyableId id={issue.paymentId} label="Payment ID" /></span> : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">{issue.description || '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                        {new Date(issue.detectedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-3 text-right">
                        {!issue.resolvedAt ? (
                          <div className="relative inline-block">
                            <button
                              type="button"
                              onClick={() => { setOpenMenu(openMenu === issue.id ? null : issue.id); setResolveText('') }}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg hover:border-gray-300 transition-colors"
                            >
                              Resolve <ChevronDown className="w-3 h-3" />
                            </button>
                            {openMenu === issue.id && (
                              <div className="absolute right-0 mt-1 w-56 bg-white border border-gray-200 rounded-xl shadow-lg z-10 p-3">
                                <input
                                  type="text"
                                  placeholder="Resolution note..."
                                  value={resolveText}
                                  onChange={(e) => setResolveText(e.target.value)}
                                  className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-2 mb-2 focus:outline-none focus:border-[#F97316]"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleResolveIssue(issue.id)}
                                  disabled={!resolveText.trim()}
                                  className="w-full text-xs font-medium bg-[#F97316] text-white rounded-lg py-1.5 hover:bg-orange-600 disabled:opacity-50"
                                >
                                  Mark resolved
                                </button>
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-green-600 font-medium">Resolved</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {issues.length === 0 && (
              <div className="p-5">
                <LoadFailureCard
                  title="No reconciliation issues matched"
                  message="Try a broader status, issue type, or severity filter."
                  onRetry={() => { setIssueType('ALL'); setSeverity('ALL'); setStatusFilter('open'); setIssuePage(1); }}
                />
              </div>
            )}

            {issuePagination && issuePagination.totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-50 flex items-center justify-between">
                <p className="text-xs text-gray-400">Issue page {issuePage} of {issuePagination.totalPages}</p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setIssuePage(p => Math.max(1, p - 1))} disabled={issuePage === 1} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                    &lt;
                  </button>
                  <button type="button" onClick={() => setIssuePage(p => Math.min(issuePagination.totalPages, p + 1))} disabled={issuePage === issuePagination.totalPages} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                    &gt;
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

async function copyText(value: string, label: string) {
  try {
    await navigator.clipboard?.writeText(value)
    showSuccess(`${label} copied`, value)
  } catch {
    showError('Copy failed', `Could not copy ${label.toLowerCase()}.`)
  }
}

function CopyableId({ id, label }: { id: string; label: string }) {
  return (
    <button
      type="button"
      onClick={() => copyText(id, label)}
      title={id}
      className="inline-flex items-center gap-1 rounded-md font-mono text-[11px] font-semibold text-gray-500 hover:text-[#F97316]"
    >
      {id.slice(0, 8)}
      <Clipboard className="h-3 w-3" />
    </button>
  )
}
