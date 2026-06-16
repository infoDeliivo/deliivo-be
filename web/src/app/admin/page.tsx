'use client'

import { useState, useEffect } from 'react'
import { Users, Car, DollarSign, CalendarCheck, TrendingUp, Loader2, AlertCircle } from 'lucide-react'
import { adminApi, AdminStats } from '@/lib/api'

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    adminApi.getStats()
      .then(res => setStats(res.data))
      .catch(err => setError(err instanceof Error ? err.message : 'Failed to load stats'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
        <p className="text-sm text-red-600">{error}</p>
      </div>
    )
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

      {/* Stat cards */}
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
    </div>
  )
}
