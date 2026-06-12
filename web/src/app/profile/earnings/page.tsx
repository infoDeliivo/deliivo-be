'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  ChevronLeft,
  Wallet,
  TrendingUp,
  Clock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  AlertCircle,
  Car,
} from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { paymentsApi, payoutsApi, ConnectStatus, DriverEarnings, DriverBalance, PayoutRecord } from '@/lib/api';
import { DollarSign } from 'lucide-react';

function EarningsContent() {
  const [connectStatus, setConnectStatus] = useState<ConnectStatus | null>(null);
  const [earnings, setEarnings] = useState<DriverEarnings | null>(null);
  const [balance, setBalance] = useState<DriverBalance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [onboarding, setOnboarding] = useState(false);
  const [requestingPayout, setRequestingPayout] = useState(false);
  const [payoutResult, setPayoutResult] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const [statusRes, earningsRes, balanceRes, payoutsRes] = await Promise.allSettled([
        paymentsApi.connectStatus(),
        payoutsApi.getEarnings(),
        payoutsApi.getBalance(),
        payoutsApi.getHistory(),
      ]);

      if (statusRes.status === 'fulfilled') setConnectStatus(statusRes.value.data);
      if (earningsRes.status === 'fulfilled') setEarnings(earningsRes.value.data);
      if (balanceRes.status === 'fulfilled') setBalance(balanceRes.value.data);
      if (payoutsRes.status === 'fulfilled') setPayouts(payoutsRes.value.data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectOnboard() {
    setOnboarding(true);
    try {
      const res = await paymentsApi.connectOnboard();
      // Redirect to Stripe Connect onboarding
      window.location.href = res.data.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start onboarding');
      setOnboarding(false);
    }
  }

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

      <div className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-5">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Stripe Connect Status */}
        {connectStatus && !connectStatus.onboardingComplete && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                <Wallet className="w-5 h-5 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-gray-900">Set up payouts</h3>
                <p className="text-xs text-deliivo-gray mt-0.5">
                  Connect your bank account via Stripe to receive payouts for your rides.
                </p>
                <button
                  onClick={handleConnectOnboard}
                  disabled={onboarding}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {onboarding ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
                  {onboarding ? 'Redirecting...' : 'Connect with Stripe'}
                </button>
              </div>
            </div>
          </div>
        )}

        {connectStatus?.onboardingComplete && (
          <div className="flex items-center gap-2 rounded-xl bg-green-50 border border-green-100 px-4 py-2.5">
            <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
            <p className="text-sm text-green-700 font-medium">Stripe connected — payouts enabled</p>
          </div>
        )}

        {/* Request Payout */}
        {connectStatus?.onboardingComplete && balance && balance.available > 0 && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Request Payout</h3>
                <p className="text-xs text-deliivo-gray mt-0.5">
                  Transfer your available balance to your bank account.
                </p>
              </div>
              <button
                onClick={async () => {
                  setRequestingPayout(true);
                  setPayoutResult(null);
                  try {
                    const res = await payoutsApi.requestPayout();
                    setPayoutResult(`Payout ${res.data.status}${res.data.amount ? ` — ${balance.currency} ${res.data.amount.toFixed(2)}` : ''}`);
                    loadData();
                  } catch (err: unknown) {
                    setPayoutResult(err instanceof Error ? err.message : 'Payout request failed');
                  } finally {
                    setRequestingPayout(false);
                  }
                }}
                disabled={requestingPayout}
                className="flex items-center gap-1.5 rounded-xl bg-deliivo-orange px-4 py-2.5 text-sm font-semibold text-white hover:bg-deliivo-orange/90 disabled:opacity-50 transition-colors"
              >
                {requestingPayout ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
                Request
              </button>
            </div>
            {payoutResult && (
              <p className={`mt-2 text-xs ${payoutResult.includes('fail') ? 'text-red-600' : 'text-green-600'}`}>{payoutResult}</p>
            )}
          </div>
        )}

        {/* Balance Cards */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-deliivo-gray font-medium uppercase tracking-wide">Available</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">
              {balance ? `${balance.currency} ${balance.available.toFixed(2)}` : '--'}
            </p>
          </div>
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <p className="text-xs text-deliivo-gray font-medium uppercase tracking-wide">Pending</p>
            <p className="text-2xl font-bold text-deliivo-orange mt-1">
              {balance ? `${balance.currency} ${balance.pending.toFixed(2)}` : '--'}
            </p>
          </div>
        </div>

        {/* Earnings Summary */}
        {earnings && (
          <div className="bg-white rounded-2xl shadow-sm p-5">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-deliivo-orange" />
              <h3 className="text-sm font-semibold text-gray-900">Earnings Overview</h3>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-deliivo-gray">Total earned</p>
                <p className="text-lg font-bold text-gray-900">{earnings.currency} {earnings.totalEarnings.toFixed(2)}</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-deliivo-gray">Total rides</p>
                <p className="text-lg font-bold text-gray-900 flex items-center gap-1 justify-end">
                  <Car className="w-4 h-4 text-deliivo-gray" /> {earnings.totalRides}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Payout History */}
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-deliivo-orange" />
            <h3 className="text-sm font-semibold text-gray-900">Payout History</h3>
          </div>

          {payouts.length === 0 ? (
            <p className="text-sm text-deliivo-gray text-center py-6">No payouts yet</p>
          ) : (
            <div className="flex flex-col gap-2">
              {payouts.map((p) => (
                <div key={p.id} className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.currency} {p.amount.toFixed(2)}</p>
                    <p className="text-xs text-deliivo-gray">{new Date(p.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
                  </div>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    p.status === 'paid' ? 'bg-green-50 text-green-700 border border-green-200' :
                    p.status === 'pending' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
                    'bg-gray-50 text-gray-600 border border-gray-200'
                  }`}>
                    {p.status}
                  </span>
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
