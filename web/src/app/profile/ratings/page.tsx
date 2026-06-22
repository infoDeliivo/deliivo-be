'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Star, Loader2 } from 'lucide-react'
import ProtectedRoute from '@/components/ProtectedRoute'
import { userApi } from '@/lib/api'
import { useTranslation } from '@/lib/i18n-context'

interface ProfileRating {
  average: number | null;
  total: number;
  label: string | null;
}

function StarRow({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={`w-4 h-4 ${i < count ? 'fill-[#F97316] text-[#F97316]' : 'text-gray-200'}`}
        />
      ))}
    </div>
  )
}

function RatingsContent() {
  const { t } = useTranslation()
  const [rating, setRating] = useState<ProfileRating | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    userApi.getMyProfile()
      .then(res => {
        const data = res.data as unknown as { rating?: ProfileRating }
        setRating(data.rating || null)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    )
  }

  const avg = rating?.average ?? 0
  const total = rating?.total ?? 0
  const roundedAvg = Math.round(avg)

  return (
    <div className="min-h-screen bg-[#FFF8F0]">
      <header className="bg-white border-b border-orange-100 px-4 py-4 flex items-center gap-3 sm:px-6">
        <Link
          href="/profile"
          className="flex items-center gap-1 text-sm text-gray-600 hover:text-[#F97316] transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          {t('common.back')}
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">{t('profile.ratings')}</h1>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-8 flex flex-col gap-5">
        {/* Overall score */}
        <div className="bg-white rounded-2xl shadow-sm p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
            <div className="text-center">
              <p className="text-5xl font-bold text-[#F97316]">{avg > 0 ? avg.toFixed(1) : '--'}</p>
              <StarRow count={roundedAvg} />
              <p className="text-xs text-gray-400 mt-1">{t('profile.reviewsCount', { total, plural: total !== 1 ? 's' : '' })}</p>
            </div>

            <div className="flex-1 flex flex-col gap-2">
              {rating?.label && (
                <p className="text-sm font-medium text-gray-700">{rating.label}</p>
              )}
              <p className="text-sm text-gray-500">
                {total === 0
                  ? t('profile.noReviewsYet')
                  : t('profile.basedOnReviews', { total, plural: total !== 1 ? 's' : '' })
                }
              </p>
            </div>
          </div>
        </div>

        {total === 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <Star className="w-12 h-12 text-orange-200 mx-auto mb-3" />
            <p className="text-sm text-gray-500">{t('profile.completeRidesForRatings')}</p>
            <Link href="/search" className="mt-3 inline-block text-sm font-semibold text-[#F97316] hover:underline">
              {t('home.findRide')}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

export default function RatingsPage() {
  return (
    <ProtectedRoute>
      <RatingsContent />
    </ProtectedRoute>
  )
}
