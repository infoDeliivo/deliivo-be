'use client'

import { useState } from 'react'
import { adminApi } from '@/lib/api'

export default function AdminRidesPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Rides & Bookings</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage rides, process refunds, and verify vehicles</p>
      </div>

      {/* Refund tool */}
      <RefundTool />

      {/* Vehicle verification tool */}
      <VerifyVehicleTool />
    </div>
  )
}

function RefundTool() {
  const [bookingId, setBookingId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleRefund(e: React.FormEvent) {
    e.preventDefault()
    if (!bookingId.trim()) return
    setLoading(true)
    setResult(null)
    try {
      await adminApi.refundBooking(bookingId.trim())
      setResult('Refund processed successfully')
      setBookingId('')
    } catch (err: unknown) {
      setResult(err instanceof Error ? err.message : 'Refund failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Refund a Booking</h3>
      <form onSubmit={handleRefund} className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Booking ID</label>
          <input
            type="text"
            value={bookingId}
            onChange={(e) => setBookingId(e.target.value)}
            placeholder="Enter booking UUID..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 focus:border-[#F97316]"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !bookingId.trim()}
          className="px-4 py-2.5 text-sm font-medium rounded-xl bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Processing...' : 'Refund'}
        </button>
      </form>
      {result && (
        <p className={`mt-2 text-xs ${result.includes('success') ? 'text-green-600' : 'text-red-500'}`}>{result}</p>
      )}
    </div>
  )
}

function VerifyVehicleTool() {
  const [vehicleId, setVehicleId] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    if (!vehicleId.trim()) return
    setLoading(true)
    setResult(null)
    try {
      await adminApi.verifyVehicle(vehicleId.trim())
      setResult('Vehicle verified successfully')
      setVehicleId('')
    } catch (err: unknown) {
      setResult(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Verify a Vehicle</h3>
      <form onSubmit={handleVerify} className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="block text-xs text-gray-500 mb-1">Vehicle ID</label>
          <input
            type="text"
            value={vehicleId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder="Enter vehicle UUID..."
            className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-[#F97316]/30 focus:border-[#F97316]"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !vehicleId.trim()}
          className="px-4 py-2.5 text-sm font-medium rounded-xl bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Verifying...' : 'Verify'}
        </button>
      </form>
      {result && (
        <p className={`mt-2 text-xs ${result.includes('success') ? 'text-green-600' : 'text-red-500'}`}>{result}</p>
      )}
    </div>
  )
}
