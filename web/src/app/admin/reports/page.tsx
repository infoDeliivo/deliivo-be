'use client'

import { useState, useEffect } from 'react'
import { Flag, ChevronDown, ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import { adminApi, AdminDispute, Pagination } from '@/lib/api'

const statusStyle: Record<string, string> = {
  OPEN: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  EVIDENCE_COLLECTED: 'bg-blue-50 text-blue-700 border border-blue-200',
  NEEDS_MANUAL_REVIEW: 'bg-orange-50 text-orange-700 border border-orange-200',
  RESOLVED_REFUND: 'bg-green-50 text-green-700 border border-green-200',
  RESOLVED_PAYOUT: 'bg-green-50 text-green-700 border border-green-200',
  RESOLVED_SPLIT: 'bg-green-50 text-green-700 border border-green-200',
  AUTO_RESOLVED_RIDER_REFUND: 'bg-green-50 text-green-700 border border-green-200',
  AUTO_RESOLVED_DRIVER_PAYOUT: 'bg-green-50 text-green-700 border border-green-200',
  ESCALATED: 'bg-red-50 text-red-600 border border-red-200',
}

const FILTER_STATUSES = ['All', 'OPEN', 'NEEDS_MANUAL_REVIEW', 'EVIDENCE_COLLECTED', 'ESCALATED'] as const

const RESOLUTIONS = ['REFUND', 'PAYOUT', 'SPLIT', 'ESCALATE'] as const

export default function AdminReportsPage() {
  const [disputes, setDisputes] = useState<AdminDispute[]>([])
  const [pagination, setPagination] = useState<Pagination | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('All')
  const [page, setPage] = useState(1)
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  useEffect(() => { loadDisputes() }, [page, statusFilter])

  async function loadDisputes() {
    setLoading(true)
    setError('')
    try {
      const params: { page: number; limit: number; status?: string } = { page, limit: 20 }
      if (statusFilter !== 'All') params.status = statusFilter
      const res = await adminApi.getDisputes(params)
      setDisputes(res.data.disputes)
      setPagination(res.data.pagination)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load disputes')
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve(id: string, resolution: string) {
    const refundPercent = resolution === 'SPLIT'
      ? Number(window.prompt('Refund percentage for rider? Driver payout will use the remaining fare amount.', '50'))
      : undefined
    if (resolution === 'SPLIT' && (refundPercent == null || Number.isNaN(refundPercent) || refundPercent < 0 || refundPercent > 100)) {
      setError('Split refund percentage must be between 0 and 100')
      setOpenMenu(null)
      return
    }
    setActionLoading(id)
    try {
      await adminApi.resolveDispute(id, resolution, refundPercent)
      loadDisputes()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resolve dispute')
    }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  async function handleCollectEvidence(id: string) {
    setActionLoading(id)
    try {
      await adminApi.collectEvidence(id)
      loadDisputes()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to collect evidence')
    }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  async function handleEvaluate(id: string) {
    setActionLoading(id)
    try {
      await adminApi.evaluateDispute(id)
      loadDisputes()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate dispute')
    }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  const totalPages = pagination?.totalPages || 1

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Disputes</h1>
        <p className="text-sm text-gray-500 mt-0.5">{pagination?.total || 0} disputes</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Filter */}
      <div className="bg-white rounded-2xl shadow-sm p-4 flex gap-2 flex-wrap">
        {FILTER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setStatusFilter(s); setPage(1) }}
            className={`px-4 py-2 text-xs font-medium rounded-xl border transition-colors ${
              statusFilter === s
                ? 'bg-[#F97316] text-white border-[#F97316]'
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#F97316] hover:text-[#F97316]'
            }`}
          >
            {s === 'All' ? 'All' : s.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      {/* Table */}
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
                    <th className="text-left px-6 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Reason</th>
                    <th className="text-left px-4 py-3 font-medium">Route</th>
                    <th className="text-left px-4 py-3 font-medium">Decision</th>
                    <th className="text-left px-4 py-3 font-medium">Payment</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-right px-6 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {disputes.map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-3 text-xs font-mono text-gray-400">{d.id.slice(0, 8)}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-gray-800">{d.reason.replace(/_/g, ' ')}</span>
                        {d.description && <p className="text-xs text-gray-400 truncate max-w-xs mt-0.5">{d.description}</p>}
                        <p className="text-[11px] text-gray-400 mt-1">Raised by {d.raisedBy?.slice(0, 8) || '-'}</p>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        {d.ride ? `${d.ride.originAddress.split(',')[0]} → ${d.ride.destinationAddress.split(',')[0]}` : '-'}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {d.recommendation ? (
                          <div>
                            <p className="font-medium">{d.recommendation.replace(/_/g, ' ')}</p>
                            {d.riskScore != null && <p className="text-gray-400">Risk {Math.round(d.riskScore * 100)}%</p>}
                          </div>
                        ) : (
                          <span className="text-gray-400">Not evaluated</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">
                        {d.booking?.payment ? (
                          <div>
                            <p className="font-medium">{d.booking.payment.status.replace(/_/g, ' ')}</p>
                            <p className="text-gray-400">{d.booking.payment.currency} {d.booking.payment.amountTotal.toFixed(2)}</p>
                          </div>
                        ) : (
                          <span className="text-gray-400">No payment</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-1 rounded-full ${statusStyle[d.status] || 'bg-gray-100 text-gray-600'}`}>
                          {d.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => setOpenMenu(openMenu === d.id ? null : d.id)}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 border border-gray-200 px-3 py-1.5 rounded-lg hover:border-gray-300 transition-colors"
                          >
                            Actions <ChevronDown className="w-3 h-3" />
                          </button>
                          {openMenu === d.id && (
                            <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg z-10 overflow-hidden">
                              {d.status === 'OPEN' && (
                                <button
                                  type="button"
                                  className="w-full text-left px-4 py-2.5 text-xs text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                                  disabled={actionLoading === d.id}
                                  onClick={() => handleCollectEvidence(d.id)}
                                >
                                  Collect evidence
                                </button>
                              )}
                              {d.status === 'EVIDENCE_COLLECTED' && (
                                <button
                                  type="button"
                                  className="w-full text-left px-4 py-2.5 text-xs text-indigo-600 hover:bg-indigo-50 disabled:opacity-50"
                                  disabled={actionLoading === d.id}
                                  onClick={() => handleEvaluate(d.id)}
                                >
                                  Auto-evaluate
                                </button>
                              )}
                              {['OPEN', 'EVIDENCE_COLLECTED', 'NEEDS_MANUAL_REVIEW'].includes(d.status) && (
                                <>
                                  <div className="border-t border-gray-100 my-1" />
                                  {RESOLUTIONS.map(r => (
                                    <button
                                      key={r}
                                      type="button"
                                      className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                      disabled={actionLoading === d.id}
                                      onClick={() => handleResolve(d.id, r)}
                                    >
                                      Resolve: {r}
                                    </button>
                                  ))}
                                </>
                              )}
                              <button
                                type="button"
                                className="w-full text-left px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-50"
                                onClick={() => setOpenMenu(null)}
                              >
                                Close
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {disputes.length === 0 && (
              <div className="py-12 text-center text-gray-400 text-sm">No disputes found.</div>
            )}

            {pagination && pagination.totalPages > 1 && (
              <div className="px-6 py-3 border-t border-gray-50 flex items-center justify-between">
                <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30">
                    <ChevronRight className="w-4 h-4" />
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
