'use client'

import { useState, useEffect } from 'react'
import { DollarSign, AlertTriangle, CheckCircle2, Loader2, AlertCircle, Play, ChevronDown } from 'lucide-react'
import { adminApi, ReconciliationSummary, ReconciliationIssue, Pagination } from '@/lib/api'

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
}

export default function AdminRevenuePage() {
  const [summary, setSummary] = useState<ReconciliationSummary | null>(null)
  const [issues, setIssues] = useState<ReconciliationIssue[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved'>('open')
  const [page, setPage] = useState(1)
  const [runningJob, setRunningJob] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [resolveText, setResolveText] = useState('')

  useEffect(() => { loadData() }, [page, statusFilter])

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const [summaryRes, issuesRes] = await Promise.all([
        adminApi.getReconciliationSummary(),
        adminApi.getReconciliationIssues({ status: statusFilter, page, limit: 20 }),
      ])
      setSummary(summaryRes.data)
      setIssues(issuesRes.data.issues)
      setPagination(issuesRes.data.pagination)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  async function runJob(type: 'hourly' | 'daily') {
    setRunningJob(type)
    try {
      if (type === 'hourly') await adminApi.runHourlyReconciliation()
      else await adminApi.runDailyReconciliation()
      loadData()
    } catch { /* ignore */ }
    finally { setRunningJob(null) }
  }

  async function handleResolveIssue(id: string) {
    if (!resolveText.trim()) return
    try {
      await adminApi.resolveReconciliationIssue(id, resolveText.trim())
      setOpenMenu(null)
      setResolveText('')
      loadData()
    } catch { /* ignore */ }
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
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
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

      {/* Filter tabs */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex gap-2">
        {(['open', 'resolved'] as const).map(s => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(s); setPage(1) }}
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

      {/* Issues table */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-[#F97316]" />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-gray-400 border-b border-gray-100">
                    <th className="text-left px-6 py-3 font-medium">Type</th>
                    <th className="text-left px-4 py-3 font-medium">Severity</th>
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
              <div className="py-12 text-center text-gray-400 text-sm">No issues found.</div>
            )}

            {pagination && pagination.totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-50 flex items-center justify-between">
                <p className="text-xs text-gray-400">Page {page} of {pagination.totalPages}</p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                    &lt;
                  </button>
                  <button type="button" onClick={() => setPage(p => Math.min(pagination!.totalPages, p + 1))} disabled={page === pagination.totalPages} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
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
