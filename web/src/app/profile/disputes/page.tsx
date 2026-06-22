'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  AlertTriangle,
  Plus,
  Loader2,
  CheckCircle2,
  Clock,
  X,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { disputesApi, Dispute } from '@/lib/api';
import { useTranslation } from '@/lib/i18n-context';
import LoadFailureCard from '@/components/LoadFailureCard';
import { publicConfig } from '@/lib/public-config';

function getStatusConfig(t: (key: string) => string, status: string) {
  const config: Record<string, { label: string; className: string; icon: typeof Clock }> = {
    OPEN: { label: t('profile.disputeOpenLabel'), className: 'bg-yellow-50 text-yellow-700 border border-yellow-200', icon: Clock },
    EVIDENCE_COLLECTED: { label: t('profile.disputeEvidenceCollected'), className: 'bg-blue-50 text-blue-700 border border-blue-200', icon: Clock },
    NEEDS_MANUAL_REVIEW: { label: t('profile.disputeManualReview'), className: 'bg-orange-50 text-orange-700 border border-orange-200', icon: Clock },
    WAITING_FOR_USER_RESPONSE: { label: t('profile.disputeNeedsResponse'), className: 'bg-amber-50 text-amber-700 border border-amber-200', icon: Clock },
    AUTO_RESOLVED_RIDER_REFUND: { label: t('profile.disputeRefundApproved'), className: 'bg-green-50 text-green-700 border border-green-200', icon: CheckCircle2 },
    AUTO_RESOLVED_DRIVER_PAYOUT: { label: t('profile.disputePayoutApproved'), className: 'bg-green-50 text-green-700 border border-green-200', icon: CheckCircle2 },
    RESOLVED_REFUND: { label: t('profile.disputeRefunded'), className: 'bg-green-50 text-green-700 border border-green-200', icon: CheckCircle2 },
    RESOLVED_PAYOUT: { label: t('profile.disputePaidOut'), className: 'bg-green-50 text-green-700 border border-green-200', icon: CheckCircle2 },
    RESOLVED_SPLIT: { label: t('profile.disputeSplit'), className: 'bg-green-50 text-green-700 border border-green-200', icon: CheckCircle2 },
    ESCALATED: { label: t('profile.disputeEscalated'), className: 'bg-red-50 text-red-600 border border-red-200', icon: X },
  };
  return config[status] || config.OPEN;
}

function DisputesContent() {
  const { t } = useTranslation();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ rideId: '', bookingId: '', reason: '', description: '' });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadDisputes(); }, []);

  async function loadDisputes() {
    setLoading(true);
    setError('');
    try {
      const res = await disputesApi.getMyDisputes();
      setDisputes(res.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.disputesLoadFailed'));
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formData.rideId || !formData.bookingId || !formData.reason) return;
    setSubmitting(true);
    setError('');
    try {
      await disputesApi.create({
        rideId: formData.rideId,
        bookingId: formData.bookingId,
        reason: formData.reason,
        description: formData.description || undefined,
      });
      setShowForm(false);
      setFormData({ rideId: '', bookingId: '', reason: '', description: '' });
      loadDisputes();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.disputeCreateFailed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/profile" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
            <ChevronLeft className="w-4 h-4" /> {t('profile.title')}
          </Link>
          <h1 className="text-lg font-semibold text-gray-900 ml-2">{t('profile.disputes')}</h1>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-3.5 py-2 text-sm font-semibold text-white hover:bg-orange-600 transition-colors"
        >
          <Plus className="w-4 h-4" /> {t('profile.new')}
        </button>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
        {error && (
          <LoadFailureCard
            title={showForm ? t('profile.createDispute') : t('profile.disputes')}
            message={`${error}${!showForm ? ` Contact ${publicConfig.supportEmail} if the dispute record still does not appear.` : ''}`}
            onRetry={showForm ? undefined : loadDisputes}
          />
        )}

        {/* Create Form Modal */}
        {showForm && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">{t('profile.createDispute')}</h3>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('profile.rideId')}</label>
                <input
                  type="text"
                  value={formData.rideId}
                  onChange={(e) => setFormData(prev => ({ ...prev, rideId: e.target.value }))}
                  placeholder={t('profile.enterRideId')}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('profile.bookingId')}</label>
                <input
                  type="text"
                  value={formData.bookingId}
                  onChange={(e) => setFormData(prev => ({ ...prev, bookingId: e.target.value }))}
                  placeholder={t('profile.enterBookingId')}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('profile.reason')}</label>
                <select
                  value={formData.reason}
                  onChange={(e) => setFormData(prev => ({ ...prev, reason: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20"
                  required
                >
                  <option value="">{t('profile.selectReason')}</option>
                  <option value="NO_SHOW">{t('profile.driverNoShow')}</option>
                  <option value="LATE_ARRIVAL">{t('profile.lateArrival')}</option>
                  <option value="UNSAFE_DRIVING">{t('profile.unsafeDriving')}</option>
                  <option value="WRONG_ROUTE">{t('profile.wrongRoute')}</option>
                  <option value="OVERCHARGE">{t('profile.overcharge')}</option>
                  <option value="VEHICLE_MISMATCH">{t('profile.vehicleMismatch')}</option>
                  <option value="OTHER">{t('profile.other')}</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">{t('profile.descriptionOptional')}</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder={t('profile.disputeDescriptionPlaceholder')}
                  rows={3}
                  className="w-full rounded-xl border border-gray-200 px-3.5 py-2.5 text-sm focus:border-deliivo-orange focus:outline-none focus:ring-2 focus:ring-deliivo-orange/20 resize-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="mt-1 w-full rounded-xl bg-deliivo-orange py-2.5 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50 transition-colors"
              >
                {submitting ? t('profile.submitting') : t('profile.submitDispute')}
              </button>
            </form>
          </div>
        )}

        {/* Disputes List */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
          </div>
        ) : disputes.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 flex flex-col items-center gap-3 text-center">
            <AlertTriangle className="w-12 h-12 text-orange-200" />
            <p className="text-gray-500 text-sm">{t('profile.noDisputes')}</p>
            <div className="flex flex-wrap justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={loadDisputes}
                className="rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-deliivo-dark hover:bg-gray-50"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="rounded-xl bg-deliivo-orange px-4 py-2 text-xs font-semibold text-white hover:bg-orange-600"
              >
                {t('profile.new')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {disputes.map((d) => {
              const statusConf = getStatusConfig(t, d.status);
              return (
                <div key={d.id} className="bg-white rounded-2xl shadow-sm p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{d.reason.replace(/_/g, ' ')}</p>
                      {d.description && <p className="text-xs text-deliivo-gray mt-1 line-clamp-2">{d.description}</p>}
                      <p className="text-xs text-gray-400 mt-2">
                        {new Date(d.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                      {d.ride && (
                        <Link href={`/rides/${d.ride.id}`} className="mt-1 inline-flex text-xs font-medium text-deliivo-orange hover:underline">
                          {d.ride.originAddress.split(',')[0]} {t('profile.to')} {d.ride.destinationAddress.split(',')[0]}
                        </Link>
                      )}
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${statusConf.className}`}>
                      {statusConf.label}
                    </span>
                  </div>
                  {d.resolution && (
                    <div className="mt-3 rounded-xl bg-green-50 border border-green-100 px-3 py-2">
                      <p className="text-xs text-green-700"><span className="font-semibold">{t('profile.resolution')}:</span> {d.resolution}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DisputesPage() {
  return (
    <ProtectedRoute>
      <DisputesContent />
    </ProtectedRoute>
  );
}
