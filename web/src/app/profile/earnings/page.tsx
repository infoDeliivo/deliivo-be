'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Clock,
  CreditCard,
  DollarSign,
  ExternalLink,
  Loader2,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { ConnectStatus, DriverBalance, DriverEarnings, PayoutRecord, paymentsApi, payoutsApi } from '@/lib/api';

function formatMoney(amount?: number, currency?: string) {
  if (typeof amount !== 'number') return '--';
  return `${currency && currency !== 'ALL' ? `${currency} ` : ''}${amount.toFixed(2)}`;
}

function payoutBadgeClass(status: string) {
  if (status === 'COMPLETED') return 'bg-green-50 text-green-700 border border-green-200';
  if (status === 'PROCESSING' || status === 'PENDING') return 'bg-amber-50 text-amber-700 border border-amber-200';
  if (status === 'FAILED') return 'bg-red-50 text-red-700 border border-red-200';
  return 'bg-gray-50 text-gray-600 border border-gray-200';
}

function EarningsContent() {
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();

  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [earnings, setEarnings] = useState<DriverEarnings | null>(null);
  const [balance, setBalance] = useState<DriverBalance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutResult, setPayoutResult] = useState<string | null>(null);

  useEffect(() => {
    const stripeConnectState = searchParams.get('stripe_connect');
    if (stripeConnectState === 'return') {
      setInfoMessage('Returned from Stripe onboarding. Refreshing payout status.');
    } else if (stripeConnectState === 'refresh') {
      setInfoMessage('Stripe asked for onboarding refresh. Continue payout setup below.');
    } else if (stripeConnectState === 'mock') {
      setInfoMessage('Mock Stripe Connect onboarding completed.');
    } else {
      setInfoMessage('');
    }

    loadData();
  }, [searchParamKey]);

  async function loadData() {
    setLoading(true);
    setError('');

    const [statusRes, earningsRes, balanceRes, payoutsRes] = await Promise.allSettled([
      paymentsApi.connectStatus(),
      payoutsApi.getEarnings(),
      payoutsApi.getBalance(),
      payoutsApi.getHistory(),
    ]);

    const failed: string[] = [];

    if (statusRes.status === 'fulfilled') setConnectStatus(statusRes.value.data);
    else failed.push('connect status');

    if (earningsRes.status === 'fulfilled') setEarnings(earningsRes.value.data);
    else failed.push('earnings');

    if (balanceRes.status === 'fulfilled') setBalance(balanceRes.value.data);
    else failed.push('balance');

    if (payoutsRes.status === 'fulfilled') setPayouts(payoutsRes.value.data);
    else failed.push('payout history');

    if (failed.length === 4) {
      setError('Failed to load earnings and payout details.');
    } else if (failed.length > 0) {
      setError(`Some payout details could not be loaded: ${failed.join(', ')}.`);
    }

    setLoading(false);
  }

  async function handleConnectOnboard() {
    setOnboarding(true);
    setError('');
    try {
      const res = await paymentsApi.connectOnboard();
      window.location.href = res.data.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start onboarding');
      setOnboarding(false);
    }
  }

  async function handleRequestPayout() {
    setRequestingPayout(true);
    setPayoutResult(null);
    try {
      const res = await payoutsApi.requestPayout();
      if (res.data.status === 'COMPLETED' || res.data.status === 'PROCESSING') {
        setPayoutResult(`Payout ${res.data.status.toLowerCase()} for ${formatMoney(res.data.amount, balance?.currency)}.`);
      } else if (res.data.status === 'NO_ELIGIBLE_PAYMENTS') {
        setPayoutResult('No eligible payout amount is available yet.');
      } else {
        setPayoutResult(`Payout status: ${res.data.status}.`);
      }
      await loadData();
    } catch (err: unknown) {
      setPayoutResult(err instanceof Error ? err.message : 'Payout request failed');
    } finally {
      setRequestingPayout(false);
    }
  }

  const payoutsReady = Boolean(connectStatus?.connected && connectStatus?.onboardingComplete && connectStatus?.payoutsEnabled);
  const connectInProgress = Boolean(connectStatus?.connected && !payoutsReady);
  const currentBalance = balance?.balance ?? 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-deliivo-cream flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-3">
        <Link href="/profile" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
          <ChevronLeft className="w-4 h-4" /> Profile
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">Earnings & Payouts</h1>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5">
        {infoMessage && (
          <div className="flex items-center gap-2 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
            <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-700">{infoMessage}</p>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <div className={`rounded-2xl border p-5 shadow-sm ${
          payoutsReady ? 'border-green-100 bg-green-50' : 'border-amber-200 bg-white'
        }`}>
          <div className="flex items-start gap-3">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl shrink-0 ${
              payoutsReady ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>
              <Wallet className="h-5 w-5" />
            </div>
            <div className="flex-1">
              <h2 className="text-sm font-semibold text-gray-900">
                {payoutsReady ? 'Payout account ready' : connectInProgress ? 'Payout setup in progress' : 'Set up payouts'}
              </h2>
              <p className="mt-1 text-sm text-deliivo-gray">
                {payoutsReady
                  ? 'Stripe Connect is active and payouts can be requested from this page.'
                  : 'Connect Stripe before relying on driver payouts or publishing new rides.'}
              </p>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="rounded-xl border border-gray-100 bg-white px-3 py-3">
                  <p className="text-xs font-medium text-deliivo-gray">Details submitted</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{connectStatus?.detailsSubmitted ? 'Yes' : 'No'}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-3 py-3">
                  <p className="text-xs font-medium text-deliivo-gray">Charges enabled</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{connectStatus?.chargesEnabled ? 'Yes' : 'No'}</p>
                </div>
                <div className="rounded-xl border border-gray-100 bg-white px-3 py-3">
                  <p className="text-xs font-medium text-deliivo-gray">Payouts enabled</p>
                  <p className="mt-1 text-sm font-semibold text-gray-900">{connectStatus?.payoutsEnabled ? 'Yes' : 'No'}</p>
                </div>
              </div>

              {connectStatus?.accountId && (
                <p className="mt-3 text-xs text-deliivo-gray">Stripe account: {connectStatus.accountId}</p>
              )}

              {!payoutsReady && (
                <button
                  onClick={handleConnectOnboard}
                  disabled={onboarding}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2 text-sm font-semibold text-white hover:bg-deliivo-orange-dark disabled:opacity-50 transition-colors"
                >
                  {onboarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  {onboarding ? 'Redirecting...' : connectInProgress ? 'Continue Stripe setup' : 'Connect with Stripe'}
                </button>
              )}
            </div>
          </div>
        </div>

        {payoutsReady && currentBalance > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Request payout</h3>
                <p className="text-xs text-deliivo-gray mt-0.5">
                  Move your currently available driver balance to Stripe.
                </p>
              </div>
              <button
                onClick={handleRequestPayout}
                disabled={requestingPayout}
                className="flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-deliivo-orange-dark disabled:opacity-50 transition-colors"
              >
                {requestingPayout ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                Request
              </button>
            </div>
            {payoutResult && (
              <p className={`mt-3 text-xs ${payoutResult.toLowerCase().includes('failed') ? 'text-red-600' : 'text-green-600'}`}>
                {payoutResult}
              </p>
            )}
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-3">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-deliivo-gray font-medium uppercase tracking-wide">Current balance</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatMoney(balance?.balance, balance?.currency)}</p>
            <p className="mt-1 text-xs text-deliivo-gray">Driver ledger balance</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-deliivo-gray font-medium uppercase tracking-wide">Pending balance</p>
            <p className="text-2xl font-bold text-deliivo-orange mt-1">{formatMoney(earnings?.pendingBalance, balance?.currency)}</p>
            <p className="mt-1 text-xs text-deliivo-gray">Earned minus paid out and refunded</p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-deliivo-gray font-medium uppercase tracking-wide">Paid out</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{formatMoney(earnings?.totalPaidOut, balance?.currency)}</p>
            <p className="mt-1 text-xs text-deliivo-gray">Transferred to Stripe</p>
          </div>
        </div>

        {earnings && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="w-4 h-4 text-deliivo-orange" />
              <h3 className="text-sm font-semibold text-gray-900">Earnings overview</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium text-deliivo-gray">Total earned</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{formatMoney(earnings.totalEarned, balance?.currency)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium text-deliivo-gray">Refunded or reversed</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{formatMoney(earnings.totalRefunded, balance?.currency)}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs font-medium text-deliivo-gray">Ledger entries</p>
                <p className="mt-1 text-lg font-bold text-gray-900">{earnings.entriesCount}</p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-deliivo-orange" />
              <h3 className="text-sm font-semibold text-gray-900">Payout history</h3>
            </div>
            <Link href="/profile/payment-methods" className="text-xs font-semibold text-deliivo-orange hover:underline inline-flex items-center gap-1">
              <CreditCard className="w-3.5 h-3.5" />
              Cards
            </Link>
          </div>

          {payouts.length === 0 ? (
            <p className="text-sm text-deliivo-gray text-center py-6">No payout batches yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {payouts.map((payout) => (
                <div key={payout.id} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{formatMoney(payout.amountTotal, payout.currency)}</p>
                      <p className="mt-1 text-xs text-deliivo-gray">
                        {new Date(payout.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {' '}with {payout.items.length} booking{payout.items.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                    <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${payoutBadgeClass(payout.status)}`}>
                      {payout.status}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="text-xs text-deliivo-gray">
                      <span className="font-medium text-gray-900">Transfer ID:</span> {payout.stripeTransferId || 'Not created yet'}
                    </div>
                    <div className="text-xs text-deliivo-gray">
                      <span className="font-medium text-gray-900">Items completed:</span> {payout.items.filter((item) => item.status === 'COMPLETED').length}/{payout.items.length}
                    </div>
                  </div>
                  {payout.failureReason && (
                    <p className="mt-2 text-xs text-red-600">{payout.failureReason}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function EarningsPage() {
  return (
    <ProtectedRoute>
      <EarningsContent />
    </ProtectedRoute>
  );
}
