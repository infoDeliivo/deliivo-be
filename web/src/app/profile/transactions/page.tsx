'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, ChevronLeft, CreditCard, Loader2, ReceiptText } from 'lucide-react';
import ProtectedRoute from '@/components/ProtectedRoute';
import { paymentsApi, RiderTransaction } from '@/lib/api';

function formatMoney(amount?: number, currency?: string) {
  if (typeof amount !== 'number') return '--';
  return `${currency || 'EUR'} ${amount.toFixed(2)}`;
}

function statusClass(status: string) {
  if (['PAID', 'HELD_IN_ESCROW', 'PAYOUT_ELIGIBLE', 'PAYOUT_COMPLETED'].includes(status)) return 'bg-green-50 text-green-700 border border-green-200';
  if (['PAYMENT_PENDING', 'CREATED', 'REFUND_PENDING', 'TRANSFER_CREATED'].includes(status)) return 'bg-amber-50 text-amber-700 border border-amber-200';
  if (['REFUNDED', 'PAYMENT_FAILED'].includes(status)) return 'bg-red-50 text-red-700 border border-red-200';
  return 'bg-gray-50 text-gray-600 border border-gray-200';
}

function TransactionsContent() {
  const [transactions, setTransactions] = useState<RiderTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { loadTransactions(); }, []);

  async function loadTransactions() {
    setLoading(true);
    setError('');
    try {
      const res = await paymentsApi.transactions();
      setTransactions(res.data || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-deliivo-cream">
      <header className="bg-white border-b border-orange-100 px-6 py-4 flex items-center gap-3">
        <Link href="/profile" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
          <ChevronLeft className="w-4 h-4" /> Profile
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">Transactions</h1>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-deliivo-orange" />
            <h2 className="text-sm font-semibold text-gray-900">Ride payments and refunds</h2>
          </div>
          <p className="mt-1 text-sm text-deliivo-gray">Track rider payments, booking status, refunds, and disputes.</p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-deliivo-orange" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-10 text-center">
            <CreditCard className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-deliivo-gray">No ride transactions yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {transactions.map((tx) => {
              const ride = tx.booking?.ride;
              const from = tx.booking?.pickupAddress || ride?.originAddress || 'Ride';
              const to = tx.booking?.dropoffAddress || ride?.destinationAddress || '';
              const openDispute = tx.booking?.disputes?.find((d) => !d.status.startsWith('RESOLVED'));
              return (
                <div key={tx.id} className="bg-white rounded-2xl shadow-sm p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{from.split(',')[0]}{to ? ` to ${to.split(',')[0]}` : ''}</p>
                      <p className="mt-1 text-xs text-deliivo-gray">
                        {ride ? `${new Date(ride.departureDate).toLocaleDateString()} at ${ride.departureTime}` : new Date(tx.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 text-xs text-deliivo-gray">Booking: {tx.booking?.status || 'Unknown'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold text-gray-900">{formatMoney(tx.amountTotal, tx.currency)}</p>
                      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass(tx.status)}`}>
                        {tx.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-deliivo-gray">Fare</p>
                      <p className="text-xs font-semibold text-gray-900">{formatMoney(tx.fareAmount, tx.currency)}</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-deliivo-gray">Service fee</p>
                      <p className="text-xs font-semibold text-gray-900">{formatMoney(tx.platformFeeAmount, tx.currency)}</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-deliivo-gray">Refund</p>
                      <p className="text-xs font-semibold text-gray-900">{tx.booking?.refundedAt ? formatMoney(tx.booking.refundAmount || 0, tx.currency) : 'None'}</p>
                    </div>
                  </div>

                  {openDispute && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs text-amber-800">Dispute open: {openDispute.reason.replace(/_/g, ' ')} ({openDispute.status.replace(/_/g, ' ')})</p>
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

export default function TransactionsPage() {
  return (
    <ProtectedRoute>
      <TransactionsContent />
    </ProtectedRoute>
  );
}
