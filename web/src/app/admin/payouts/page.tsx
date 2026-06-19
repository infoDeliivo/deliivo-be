'use client'

import { useEffect, useState } from 'react'
import { Banknote, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import { adminApi, AdminPayoutCandidate } from '@/lib/api'

export default function AdminPayoutsPage() {
  const [driverId, setDriverId] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<{ status: string; amount?: number; batchId?: string } | null>(null)
  const [error, setError] = useState('')

  const [checking, setChecking] = useState(false)
  const [eligibilityResult, setEligibilityResult] = useState<{ checked: number; markedEligible: number } | null>(null)
  const [candidates, setCandidates] = useState<AdminPayoutCandidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(true)

  useEffect(() => { loadCandidates() }, [])

  async function loadCandidates() {
    setLoadingCandidates(true)
    try {
      const res = await adminApi.getEligiblePayouts()
      setCandidates(res.data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load eligible payouts')
    } finally {
      setLoadingCandidates(false)
    }
  }

  async function handleProcess(e: React.FormEvent) {
    e.preventDefault()
    if (!driverId.trim()) return
    setProcessing(true)
    setError('')
    setResult(null)
    try {
      const res = await adminApi.processPayout(driverId.trim())
      setResult(res.data)
      setDriverId('')
      await loadCandidates()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Payout failed')
    } finally {
      setProcessing(false)
    }
  }

  async function handleCheckEligibility() {
    setChecking(true)
    setEligibilityResult(null)
    try {
      const res = await adminApi.checkPayoutEligibility()
      setEligibilityResult(res.data)
      await loadCandidates()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Payouts</h1>
        <p className="text-sm text-gray-500 mt-0.5">Process driver payouts via Stripe Connect</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Check Eligibility */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Check Payout Eligibility</h3>
            <p className="text-xs text-gray-500 mt-0.5">Scan escrow payments past 48h dispute window and mark as eligible</p>
          </div>
          <button
            onClick={handleCheckEligibility}
            disabled={checking}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {checking ? 'Checking...' : 'Run Check'}
          </button>
        </div>
        {eligibilityResult && (
          <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-4 py-3 flex items-center gap-4">
            <span className="text-sm text-green-700"><strong>{eligibilityResult.checked}</strong> payments checked</span>
            <span className="text-sm text-green-700"><strong>{eligibilityResult.markedEligible}</strong> marked eligible</span>
          </div>
        )}
      </div>

      {/* Process Payout */}
      <div className="bg-white rounded-2xl shadow-sm p-5">
        <div className="mb-5">
          <h3 className="text-sm font-semibold text-gray-900">Eligible payout candidates</h3>
          <p className="text-xs text-gray-500 mt-0.5">Review drivers with payout-eligible completed bookings.</p>
        </div>

        {loadingCandidates ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-[#F97316]" />
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
            No eligible driver payouts yet.
          </div>
        ) : (
          <div className="mb-6 flex flex-col gap-3">
            {candidates.map((candidate) => (
              <div key={candidate.driverId} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">{candidate.driverName || 'Driver'} <span className="font-mono text-xs text-gray-400">{candidate.driverId.slice(0, 8)}</span></p>
                    <p className="mt-1 text-xs text-gray-500">
                      {candidate.paymentsCount} payment{candidate.paymentsCount !== 1 ? 's' : ''} ready, Stripe account {candidate.stripeAccountId ? 'linked' : 'missing'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold text-gray-900">{candidate.currency} {candidate.amountTotal.toFixed(2)}</p>
                    <button
                      type="button"
                      onClick={async () => {
                        setDriverId(candidate.driverId)
                        setProcessing(true)
                        setError('')
                        setResult(null)
                        try {
                          const res = await adminApi.processPayout(candidate.driverId)
                          setResult(res.data)
                          await loadCandidates()
                        } catch (err: unknown) {
                          setError(err instanceof Error ? err.message : 'Payout failed')
                        } finally {
                          setProcessing(false)
                        }
                      }}
                      disabled={processing}
                      className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-[#F97316] px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                    >
                      {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Banknote className="w-3 h-3" />}
                      Process
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex flex-col gap-1">
                  {candidate.payments.slice(0, 3).map((payment) => (
                    <p key={payment.id} className="text-xs text-gray-500">
                      {payment.booking?.ride?.originAddress?.split(',')[0] || 'Ride'} to {payment.booking?.ride?.destinationAddress?.split(',')[0] || 'destination'} - {payment.currency} {payment.fareAmount.toFixed(2)}
                    </p>
                  ))}
                  {candidate.payments.length > 3 && (
                    <p className="text-xs text-gray-400">+{candidate.payments.length - 3} more</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <h3 className="text-sm font-semibold text-gray-900 mb-3">Process Driver Payout</h3>
        <p className="text-xs text-gray-500 mb-4">Transfer eligible funds to a driver&apos;s Stripe Connect account</p>
        <form onSubmit={handleProcess} className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Driver ID</label>
            <input
              type="text"
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
              placeholder="Enter driver UUID..."
              className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 focus:border-[#F97316]"
            />
          </div>
          <button
            type="submit"
            disabled={processing || !driverId.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-xl bg-[#F97316] text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Banknote className="w-4 h-4" />}
            {processing ? 'Processing...' : 'Process Payout'}
          </button>
        </form>

        {result && (
          <div className={`mt-4 rounded-xl border px-4 py-3 ${
            result.status === 'COMPLETED' ? 'bg-green-50 border-green-100' :
            result.status === 'NO_ELIGIBLE_PAYMENTS' ? 'bg-yellow-50 border-yellow-100' :
            'bg-red-50 border-red-100'
          }`}>
            <p className={`text-sm font-medium ${
              result.status === 'COMPLETED' ? 'text-green-700' :
              result.status === 'NO_ELIGIBLE_PAYMENTS' ? 'text-yellow-700' :
              'text-red-600'
            }`}>
              Status: {result.status}
            </p>
            {result.amount !== undefined && (
              <p className="text-xs text-gray-600 mt-1">Amount: EUR {result.amount.toFixed(2)}</p>
            )}
            {result.batchId && (
              <p className="text-xs text-gray-400 mt-0.5">Batch: {result.batchId}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
