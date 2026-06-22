'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Flag, ChevronDown, ChevronLeft, ChevronRight, Loader2, AlertCircle } from 'lucide-react'
import { adminApi, AdminDispute, Pagination, getApiErrorMessage } from '@/lib/api'
import { showError, showSuccess } from '@/lib/app-feedback'

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
  const [splitRefundPercent, setSplitRefundPercent] = useState('50')
  const [selectedDispute, setSelectedDispute] = useState<AdminDispute | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

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
      setError(getApiErrorMessage(err, 'Failed to load disputes'))
    } finally {
      setLoading(false)
    }
  }

  async function handleResolve(id: string, resolution: string) {
    const refundPercent = resolution === 'SPLIT'
      ? Number(splitRefundPercent)
      : undefined
    if (resolution === 'SPLIT' && (refundPercent == null || Number.isNaN(refundPercent) || refundPercent < 0 || refundPercent > 100)) {
      setError('Split refund percentage must be between 0 and 100')
      setOpenMenu(null)
      return
    }
    setActionLoading(id)
    try {
      await adminApi.resolveDispute(id, resolution, refundPercent)
      await loadDisputes()
      showSuccess('Dispute resolved', `Resolution: ${resolution}`)
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to resolve dispute')
      setError(message)
      showError('Resolve failed', message)
    }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  async function handleCollectEvidence(id: string) {
    setActionLoading(id)
    try {
      await adminApi.collectEvidence(id)
      await loadDisputes()
      showSuccess('Evidence collected', 'Dispute lifecycle evidence was refreshed.')
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to collect evidence')
      setError(message)
      showError('Evidence collection failed', message)
    }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  async function handleEvaluate(id: string) {
    setActionLoading(id)
    try {
      await adminApi.evaluateDispute(id)
      await loadDisputes()
      showSuccess('Dispute evaluated', 'Recommendation and risk score were updated.')
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to evaluate dispute')
      setError(message)
      showError('Evaluation failed', message)
    }
    finally { setActionLoading(null); setOpenMenu(null) }
  }

  async function handleViewDetails(id: string) {
    setDetailLoading(true)
    setOpenMenu(null)
    try {
      const res = await adminApi.getDisputeById(id)
      setSelectedDispute(res.data)
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, 'Failed to load dispute details')
      setError(message)
      showError('Could not load lifecycle', message)
    } finally {
      setDetailLoading(false)
    }
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

      {selectedDispute && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-gray-900">Dispute lifecycle</h2>
              <p className="mt-1 text-xs text-gray-500">
                Ride {selectedDispute.rideId.slice(0, 8)} • Booking {selectedDispute.bookingId.slice(0, 8)} • Raised by {selectedDispute.raisedBy === selectedDispute.ride?.driverId ? 'driver' : 'rider'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {selectedDispute.ride ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/admin/rides?search=${encodeURIComponent(selectedDispute.ride.id)}&searchBy=rideId`}
                      className="text-[#F97316] hover:underline"
                    >
                      {selectedDispute.ride.originAddress.split(',')[0]} to {selectedDispute.ride.destinationAddress.split(',')[0]}
                    </Link>
                    <Link
                      href={`/admin/rides?search=${encodeURIComponent(selectedDispute.ride.id)}&searchBy=rideId`}
                      className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] font-semibold text-gray-600 hover:border-[#F97316] hover:text-[#F97316]"
                    >
                      Open in rides
                    </Link>
                  </span>
                ) : null}
              </p>
            </div>
            <button onClick={() => setSelectedDispute(null)} className="text-xs font-semibold text-gray-500 hover:text-gray-900">Close</button>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
            <div>
              <TimelineStep title="Opened" active description={`${selectedDispute.reason.replace(/_/g, ' ')}${selectedDispute.description ? ` • ${selectedDispute.description}` : ''}`} />
              <TimelineStep
                title="Evidence collected"
                active={Boolean(selectedDispute.evidenceJson)}
                description={selectedDispute.evidenceJson ? 'Booking state, ride events, GPS history, and OTP evidence were captured.' : 'Evidence has not been collected yet.'}
              />
              <TimelineStep
                title="Evaluated"
                active={Boolean(selectedDispute.recommendation)}
                description={selectedDispute.recommendation ? `${selectedDispute.recommendation.replace(/_/g, ' ')} • Risk ${Math.round((selectedDispute.riskScore || 0) * 100)}%` : 'No recommendation yet.'}
              />
              <TimelineStep
                title="Resolved"
                active={Boolean(selectedDispute.resolvedAt)}
                description={selectedDispute.resolution ? `${selectedDispute.resolution.replace(/_/g, ' ')}${selectedDispute.status.startsWith('AUTO_RESOLVED') ? ' • auto resolved' : ' • manual resolution'}` : 'Not resolved yet.'}
              />
            </div>

            <div className="space-y-3">
              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500">Resolution status</p>
                <p className="mt-1 text-sm font-semibold text-gray-900">{selectedDispute.status.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-xs text-gray-500">{selectedDispute.resolvedAt ? new Date(selectedDispute.resolvedAt).toLocaleString() : 'Open dispute'}</p>
                {selectedDispute.resolvedBy && (
                  <p className="mt-1 text-xs text-gray-500">Resolved by {selectedDispute.resolvedBy.slice(0, 8)}</p>
                )}
              </div>

              <div className="rounded-xl bg-gray-50 p-4">
                <p className="text-xs font-semibold text-gray-500">Evidence checklist</p>
                <div className="mt-3 space-y-2">
                  {renderEvidenceItem('Booking snapshot', Boolean(selectedDispute.evidenceJson), 'Captured booking status, timestamps, and passenger state.')}
                  {renderEvidenceItem('Ride snapshot', Boolean(selectedDispute.evidenceJson), 'Captured ride state, start/end timestamps, and route context.')}
                  {renderEvidenceItem(
                    'Location history',
                    Boolean((selectedDispute.evidenceJson as any)?.locationHistory?.count > 0),
                    (selectedDispute.evidenceJson as any)?.locationHistory?.count > 0
                      ? `${(selectedDispute.evidenceJson as any).locationHistory.count} GPS updates available.`
                      : 'No GPS updates were found.',
                  )}
                  {renderEvidenceItem(
                    'Ride events',
                    Boolean((selectedDispute.evidenceJson as any)?.rideEvents?.length > 0),
                    (selectedDispute.evidenceJson as any)?.rideEvents?.length > 0
                      ? `${(selectedDispute.evidenceJson as any).rideEvents.length} lifecycle events recorded.`
                      : 'No ride events were found.',
                  )}
                  {renderEvidenceItem('OTP verified', Boolean((selectedDispute.evidenceJson as any)?.otpVerified), (selectedDispute.evidenceJson as any)?.otpVerified ? 'Pickup OTP was verified.' : 'Pickup OTP was not verified.')}
                  {renderEvidenceItem('Drop-off confirmed', Boolean((selectedDispute.evidenceJson as any)?.dropoffConfirmed), (selectedDispute.evidenceJson as any)?.dropoffConfirmed ? 'Driver drop-off confirmation exists.' : 'No driver drop-off confirmation.')}
                  {renderEvidenceItem('Rider drop-off confirmation', Boolean((selectedDispute.evidenceJson as any)?.riderConfirmedDropoff), (selectedDispute.evidenceJson as any)?.riderConfirmedDropoff ? 'Rider confirmed drop-off.' : 'Rider did not confirm drop-off.')}
                  {renderEvidenceItem('No-show marked', Boolean((selectedDispute.evidenceJson as any)?.noShowMarked), (selectedDispute.evidenceJson as any)?.noShowMarked ? 'No-show was marked.' : 'No no-show mark recorded.')}
                  {renderEvidenceItem(
                    'Manual override signals',
                    Boolean((selectedDispute.evidenceJson as any)?.manualOverrides?.events?.length > 0),
                    (selectedDispute.evidenceJson as any)?.manualOverrides?.events?.length > 0
                      ? `${(selectedDispute.evidenceJson as any).manualOverrides.events.length} support or fallback actions were recorded.`
                      : 'No manual override actions were recorded.',
                  )}
                </div>
                {Array.isArray((selectedDispute.evidenceJson as any)?.factorSummary) && (selectedDispute.evidenceJson as any).factorSummary.length > 0 && (
                  <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-xs font-semibold text-gray-700">Evaluation factors</p>
                    <div className="mt-2 space-y-1.5">
                      {(selectedDispute.evidenceJson as any).factorSummary.map((factor: any, index: number) => (
                        <div key={`${factor.key || factor.label || index}`} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-2.5 py-2">
                          <div className="min-w-0">
                            <p className="text-[11px] font-semibold text-gray-800">{factor.label || factor.key || 'Factor'}</p>
                            <p className="text-[11px] text-gray-500">{factor.detail || 'No detail available.'}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${factor.passed ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {factor.passed ? 'PASS' : 'REVIEW'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray((selectedDispute.evidenceJson as any)?.rideEvents) && (selectedDispute.evidenceJson as any).rideEvents.length > 0 && (
                  <div className="mt-4 rounded-xl border border-gray-200 bg-white p-3">
                    <p className="text-xs font-semibold text-gray-700">Ride event evidence</p>
                    <div className="mt-2 space-y-1.5">
                      {(selectedDispute.evidenceJson as any).rideEvents.map((event: any, index: number) => (
                        <div key={`${event.eventType}-${index}`} className="flex items-start justify-between gap-3 rounded-lg bg-gray-50 px-2.5 py-2">
                          <div>
                            <p className="text-[11px] font-semibold text-gray-800">{String(event.eventType || 'UNKNOWN').replace(/_/g, ' ')}</p>
                            <p className="text-[11px] text-gray-500">{event.actorType || 'UNKNOWN'}{event.timestamp ? ` - ${new Date(event.timestamp).toLocaleString()}` : ''}</p>
                          </div>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${event.hasLocation ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {event.hasLocation ? 'GPS' : 'No GPS'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {Array.isArray((selectedDispute.evidenceJson as any)?.manualOverrides?.events) && (selectedDispute.evidenceJson as any).manualOverrides.events.length > 0 && (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs font-semibold text-amber-900">Manual override evidence</p>
                    <div className="mt-2 space-y-1.5">
                      {(selectedDispute.evidenceJson as any).manualOverrides.events.map((event: any, index: number) => (
                        <div key={`${event.eventType}-${index}`} className="rounded-lg bg-white px-2.5 py-2">
                          <p className="text-[11px] font-semibold text-amber-900">{String(event.eventType || 'UNKNOWN').replace(/_/g, ' ')}</p>
                          <p className="text-[11px] text-amber-800">
                            {event.actorType || 'UNKNOWN'}
                            {event.timestamp ? ` - ${new Date(event.timestamp).toLocaleString()}` : ''}
                          </p>
                          {event.metadata?.overrideReason && (
                            <p className="mt-0.5 text-[11px] text-amber-800">{String(event.metadata.overrideReason)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
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
      <div className="bg-white rounded-2xl shadow-sm overflow-visible">
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
                      <td className="px-6 py-3 text-xs">
                        <p className="font-mono text-gray-500">{d.id.slice(0, 8)}</p>
                        <p className="mt-1 font-mono text-[11px] text-gray-400">Ride {d.rideId.slice(0, 8)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-medium text-gray-800">{d.reason.replace(/_/g, ' ')}</span>
                        {d.description && <p className="text-xs text-gray-400 truncate max-w-xs mt-0.5">{d.description}</p>}
                        <p className="text-[11px] text-gray-400 mt-1">
                          Raised by {d.raisedBy === d.ride?.driverId ? 'driver' : d.raisedBy === d.booking?.passengerId ? 'rider' : d.raisedBy?.slice(0, 8) || '-'}
                        </p>
                        {d.ride && (
                          <Link href={`/admin/rides?search=${encodeURIComponent(d.ride.id)}&searchBy=rideId`} className="mt-1 inline-flex text-[11px] font-medium text-[#F97316] hover:underline">
                            Open in ride history
                          </Link>
                        )}
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
                              <button
                                type="button"
                                className="w-full text-left px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                                disabled={detailLoading}
                                onClick={() => handleViewDetails(d.id)}
                              >
                                View lifecycle
                              </button>
                              {['OPEN', 'EVIDENCE_COLLECTED', 'NEEDS_MANUAL_REVIEW'].includes(d.status) && (
                                <>
                                  <div className="border-t border-gray-100 my-1" />
                                  <div className="px-4 py-2">
                                    <label className="block text-[11px] font-medium text-gray-500 mb-1">Split refund %</label>
                                    <input
                                      type="number"
                                      min="0"
                                      max="100"
                                      value={splitRefundPercent}
                                      onChange={(event) => setSplitRefundPercent(event.target.value)}
                                      className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs focus:border-[#F97316] focus:outline-none"
                                    />
                                    {d.booking?.payment && (
                                      <p className="mt-1 text-[11px] text-gray-400">
                                        Payment {d.booking.payment.currency} {d.booking.payment.amountTotal.toFixed(2)}
                                      </p>
                                    )}
                                  </div>
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

function TimelineStep({
  title,
  description,
  active,
}: {
  title: string;
  description: string;
  active?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        <span className={`h-3 w-3 rounded-full ${active ? 'bg-[#F97316]' : 'bg-gray-300'}`} />
        <span className="mt-1 h-full w-px bg-gray-200" />
      </div>
      <div className="pb-4">
        <p className="text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}

function renderEvidenceItem(title: string, success: boolean, description: string) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'}`}>
      <span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${success ? 'bg-green-600' : 'bg-red-500'}`} />
      <div className="min-w-0">
        <p className={`text-xs font-semibold ${success ? 'text-green-800' : 'text-red-800'}`}>{title}</p>
        <p className={`mt-0.5 text-[11px] ${success ? 'text-green-700' : 'text-red-700'}`}>{description}</p>
      </div>
    </div>
  );
}
