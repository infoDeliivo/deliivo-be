'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ChevronLeft, ExternalLink, Loader2, Wallet } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import LoadFailureCard from '@/components/LoadFailureCard';
import { ConnectStatus, DriverEarningItem, DriverEarnings, getApiErrorMessage, paymentsApi, payoutsApi } from '@/lib/api';
import { showError, showSuccess } from '@/lib/app-feedback';
import { useTranslation } from '@/lib/i18n-context';

function formatMoney(amount?: number, currency?: string) {
  if (typeof amount !== 'number') return '--';
  return `${currency && currency !== 'ALL' ? `${currency} ` : ''}${amount.toFixed(2)}`;
}

function isPaid(item: DriverEarningItem) {
  return ['PAYOUT_COMPLETED', 'TRANSFER_CREATED'].includes(item.status)
    || item.payoutItems?.some((payout) => payout.status === 'COMPLETED' || payout.batch?.status === 'COMPLETED');
}

function statusClass(status: string) {
  if (['PAYOUT_COMPLETED', 'TRANSFER_CREATED'].includes(status)) return 'bg-green-50 text-green-700 border border-green-200';
  if (['PAYOUT_ELIGIBLE', 'HELD_IN_ESCROW', 'PAID'].includes(status)) return 'bg-blue-50 text-blue-700 border border-blue-200';
  if (['REFUNDED', 'PAYMENT_FAILED'].includes(status)) return 'bg-red-50 text-red-700 border border-red-200';
  return 'bg-amber-50 text-amber-700 border border-amber-200';
}

export default function EarningsPage() {
  return (
    <ProtectedRoute>
      <EarningsContent />
    </ProtectedRoute>
  );
}

function EarningsContent() {
  const { t } = useTranslation();
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [earnings, setEarnings] = useState<DriverEarnings | null>(null);
  const [items, setItems] = useState<DriverEarningItem[]>([]);
  const [activeTab, setActiveTab] = useState<'pending' | 'paid'>('pending');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [statusRes, earningsRes, itemRes] = await Promise.all([
        paymentsApi.connectStatus(),
        payoutsApi.getEarnings(),
        payoutsApi.getEarningItems(),
      ]);
      setConnectStatus(statusRes.data);
      setEarnings(earningsRes.data);
      setItems(itemRes.data || []);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.earningsLoadFailed'));
      setError(message);
      showError(t('profile.earningsLoadError'), message);
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectOnboard() {
    setOnboarding(true);
    setError('');
    try {
      const res = await paymentsApi.connectOnboard();
      window.location.href = res.data.url;
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.payoutSetupFailed'));
      setError(message);
      showError(t('profile.payoutSetupError'), message);
      setOnboarding(false);
    }
  }

  async function handleRequestPayout() {
    setRequesting(true);
    setMessage('');
    try {
      const res = await payoutsApi.requestPayout();
      setMessage(res.data.amount ? t('profile.payoutRequestedAmount', { amount: formatMoney(res.data.amount, 'EUR') }) : t('profile.payoutStatus', { status: res.data.status }));
      await loadData();
      showSuccess(t('profile.payoutRequested'), res.data.amount ? t('profile.amount', { amount: formatMoney(res.data.amount, 'EUR') }) : t('profile.statusValue', { status: res.data.status }));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.payoutRequestFailed'));
      setMessage(message);
      showError(t('profile.payoutRequestFailed'), message);
    } finally {
      setRequesting(false);
    }
  }

  const pendingItems = useMemo(() => items.filter((item) => !isPaid(item)), [items]);
  const paidItems = useMemo(() => items.filter(isPaid), [items]);
  const visibleItems = activeTab === 'pending' ? pendingItems : paidItems;
  const currency = items[0]?.currency || 'EUR';
  const eligiblePending = useMemo(
    () => pendingItems.reduce((sum, item) => sum + (item.status === 'PAYOUT_ELIGIBLE' ? item.fareAmount : 0), 0),
    [pendingItems],
  );
  const payoutsReady = Boolean(connectStatus?.connected && connectStatus?.onboardingComplete && connectStatus?.payoutsEnabled);

  if (loading) {
    return <div className="min-h-screen bg-deliivo-cream flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" /></div>;
  }

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-4 py-4 flex items-center gap-3 sm:px-6">
        <Link href="/profile" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
          <ChevronLeft className="w-4 h-4" /> {t('profile.title')}
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">{t('profile.earnings')}</h1>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-5">
        {error && (
          <LoadFailureCard
            title={t('profile.earnings')}
            message={error}
            onRetry={loadData}
          />
        )}

        <section className={`rounded-2xl border p-5 shadow-sm ${payoutsReady ? 'border-green-100 bg-green-50' : 'border-amber-200 bg-white'}`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${payoutsReady ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-sm font-semibold text-gray-900">{payoutsReady ? t('profile.payoutReady') : t('profile.setUpPayouts')}</h2>
                <p className="mt-1 text-sm text-deliivo-gray">
                  {payoutsReady ? t('profile.payoutReadyCopy') : t('profile.setUpPayoutsCopy')}
                </p>
              </div>
            </div>
            {!payoutsReady && (
              <button
                onClick={handleConnectOnboard}
                disabled={onboarding}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2 text-sm font-semibold text-white hover:bg-deliivo-orange-dark disabled:opacity-50"
              >
                {onboarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                {t('profile.connect')}
              </button>
            )}
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase text-deliivo-gray">{t('profile.totalEarnings')}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{formatMoney(earnings?.totalEarned, currency)}</p>
            <p className="mt-1 text-xs text-deliivo-gray">{t('profile.totalEarningsCopy')}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase text-deliivo-gray">{t('profile.pending')}</p>
            <p className="mt-1 text-2xl font-bold text-deliivo-orange">{formatMoney(earnings?.pendingBalance, currency)}</p>
            <p className="mt-1 text-xs text-deliivo-gray">{t('profile.currentlyEligible', { amount: formatMoney(eligiblePending, currency) })}</p>
          </div>
          <div className="rounded-2xl bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase text-deliivo-gray">{t('profile.paid')}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">{formatMoney(earnings?.totalPaidOut, currency)}</p>
            <p className="mt-1 text-xs text-deliivo-gray">{t('profile.paidCopy')}</p>
          </div>
        </section>

        {payoutsReady && pendingItems.some((item) => item.status === 'PAYOUT_ELIGIBLE') && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">{t('profile.requestPayout')}</h3>
                <p className="mt-1 text-xs text-deliivo-gray">{t('profile.requestPayoutCopy')}</p>
              </div>
              <button onClick={handleRequestPayout} disabled={requesting} className="btn-primary px-4 py-2 text-sm disabled:opacity-50">
                {requesting ? t('profile.requesting') : t('profile.requestPayout')}
              </button>
            </div>
            {message && <p className="mt-3 text-xs text-deliivo-gray">{message}</p>}
          </section>
        )}

        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('pending')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === 'pending' ? 'bg-deliivo-orange text-white' : 'bg-gray-50 text-deliivo-gray'}`}
            >
              {t('profile.pendingTab', { count: pendingItems.length })}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('paid')}
              className={`rounded-xl px-4 py-2 text-sm font-semibold ${activeTab === 'paid' ? 'bg-deliivo-orange text-white' : 'bg-gray-50 text-deliivo-gray'}`}
            >
              {t('profile.paidTab', { count: paidItems.length })}
            </button>
          </div>

          {visibleItems.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-sm text-deliivo-gray">{activeTab === 'pending' ? t('profile.noPendingEarnings') : t('profile.noPaidEarnings')}</p>
              <button
                type="button"
                onClick={loadData}
                className="mt-4 rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-deliivo-dark hover:bg-gray-50"
              >
                Refresh
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleItems.map((item) => {
                const ride = item.booking?.ride;
                const from = item.booking?.pickupAddress || ride?.originAddress || 'Ride';
                const to = item.booking?.dropoffAddress || ride?.destinationAddress || '';
                return (
                  <div key={item.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{from.split(',')[0]}{to ? ` to ${to.split(',')[0]}` : ''}</p>
                        <p className="mt-1 text-xs text-deliivo-gray">
                          {ride ? `${new Date(ride.departureDate).toLocaleDateString()} at ${ride.departureTime}` : new Date(item.createdAt).toLocaleString()}
                        </p>
                        <p className="mt-1 text-xs text-deliivo-gray">{t('profile.passenger')}: {item.booking?.passenger?.name || t('profile.rider')}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-bold text-gray-900">{formatMoney(item.fareAmount, item.currency)}</p>
                        <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(item.status)}`}>
                          {item.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                    {item.booking?.refundedAt && <p className="mt-3 text-xs text-red-600">{t('profile.refunded')}: {formatMoney(item.booking.refundAmount || 0, item.currency)}</p>}
                    {item.payoutItems?.[0]?.batch?.stripeTransferId && <p className="mt-3 text-xs text-deliivo-gray">{t('profile.transfer')}: {item.payoutItems[0].batch?.stripeTransferId}</p>}
                    {ride?.id && (
                      <div className="mt-4">
                        <Link
                          href={`/rides/${ride.id}`}
                          className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-deliivo-dark hover:bg-white"
                        >
                          {t('ride.view')}
                        </Link>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {payoutsReady && <p className="flex items-center gap-1 text-xs text-green-700"><CheckCircle2 className="h-3.5 w-3.5" /> {t('profile.stripeConnectReady')}</p>}
      </main>
    </div>
  );
}
