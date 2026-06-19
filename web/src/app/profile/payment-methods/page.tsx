'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, CreditCard, Plus, Trash2, CheckCircle, Loader2, AlertCircle, ReceiptText } from 'lucide-react';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';
import { isStripeConfigured, StripeProvider } from '@/lib/stripe';
import ProtectedRoute from '@/components/ProtectedRoute';
import { paymentMethodsApi, PaymentMethod, paymentsApi, RiderTransaction } from '@/lib/api';

function formatMoney(amount?: number, currency?: string) {
  if (typeof amount !== 'number') return '--';
  return `${currency || 'EUR'} ${amount.toFixed(2)}`;
}

function paymentStatusClass(status: string) {
  if (['PAID', 'HELD_IN_ESCROW', 'PAYOUT_ELIGIBLE', 'PAYOUT_COMPLETED'].includes(status)) return 'bg-green-50 text-green-700 border border-green-200';
  if (['PAYMENT_PENDING', 'CREATED', 'REFUND_PENDING', 'TRANSFER_CREATED'].includes(status)) return 'bg-amber-50 text-amber-700 border border-amber-200';
  if (['REFUNDED', 'PAYMENT_FAILED'].includes(status)) return 'bg-red-50 text-red-700 border border-red-200';
  return 'bg-gray-50 text-gray-600 border border-gray-200';
}

function PaymentMethodsContent() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [transactions, setTransactions] = useState<RiderTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [error, setError] = useState('');
  const [settingDefaultId, setSettingDefaultId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => { loadPage(); }, []);

  async function loadPage() {
    setLoading(true);
    await Promise.all([loadMethods(false), loadTransactions()]);
    setLoading(false);
  }

  async function loadMethods(manageLoading = true) {
    if (manageLoading) setLoading(true);
    try {
      const res = await paymentMethodsApi.list();
      setMethods(res.data || []);
    } catch { /* ignore */ }
    finally { if (manageLoading) setLoading(false); }
  }

  async function loadTransactions() {
    try {
      const res = await paymentsApi.transactions();
      setTransactions(res.data || []);
    } catch { /* ignore */ }
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id);
    setError('');
    try {
      await paymentMethodsApi.setDefault(id);
      await loadMethods();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Remove this card?')) return;
    setRemovingId(id);
    setError('');
    try {
      await paymentMethodsApi.remove(id);
      await loadMethods();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove card');
    } finally {
      setRemovingId(null);
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
        <h1 className="text-lg font-semibold text-gray-900 ml-2">Payments & History</h1>
      </header>

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900">Saved cards</h2>
          <p className="mt-1 text-sm text-deliivo-gray">
            These cards are used during rider booking. Keep one default card so checkout can proceed without extra selection.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {methods.length > 0 && !methods.some((method) => method.isDefault) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900 font-medium">No default card selected.</p>
            <p className="mt-1 text-xs text-amber-800">
              Choose a default card to make ride booking faster.
            </p>
          </div>
        )}

        {methods.length === 0 && !showAddCard && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <CreditCard className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-deliivo-gray">No payment methods saved yet.</p>
          </div>
        )}

        {methods.map(m => (
          <div key={m.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5 text-gray-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 capitalize">{m.brand || 'Card'} {m.last4 ? `**** ${m.last4}` : ''}</p>
              <p className="text-xs text-deliivo-gray">
                {m.expMonth && m.expYear ? `Expires ${String(m.expMonth).padStart(2, '0')}/${m.expYear}` : 'Expiry not available'}
              </p>
            </div>
            {m.isDefault ? (
              <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Default
              </span>
            ) : (
              <button
                onClick={() => handleSetDefault(m.id)}
                disabled={settingDefaultId === m.id || !!removingId}
                className="text-xs font-medium text-deliivo-orange hover:underline disabled:opacity-50"
              >
                {settingDefaultId === m.id ? 'Saving...' : 'Set default'}
              </button>
            )}
            <button
              onClick={() => handleRemove(m.id)}
              disabled={removingId === m.id || !!settingDefaultId}
              className="p-1.5 text-red-400 hover:text-red-600 rounded-full hover:bg-red-50 disabled:opacity-50"
            >
              {removingId === m.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
            </button>
          </div>
        ))}

        {showAddCard ? (
          isStripeConfigured() ? (
            <AddCardForm
              onSuccess={() => { setError(''); setShowAddCard(false); loadMethods(); }}
              onCancel={() => setShowAddCard(false)}
            />
          ) : (
            <div className="rounded-2xl border border-yellow-100 bg-yellow-50 p-5">
              <h3 className="text-sm font-semibold text-yellow-900">Stripe publishable key required</h3>
              <p className="mt-1 text-sm text-yellow-800">
                Add NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY to the root .env file, then rebuild the web app to enable card entry.
              </p>
              <button type="button" onClick={() => setShowAddCard(false)} className="mt-4 btn-outline py-2 text-sm">
                Back
              </button>
            </div>
          )
        ) : (
          <button onClick={() => setShowAddCard(true)} className="btn-primary w-full py-3 gap-2">
            <Plus className="w-4 h-4" /> Add payment method
          </button>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-deliivo-orange" />
            <h2 className="text-sm font-semibold text-gray-900">Payment history</h2>
          </div>
          <p className="mt-1 text-sm text-deliivo-gray">Ride payments, driver approval state, refunds, and disputes.</p>
        </div>

        {transactions.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <ReceiptText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
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
                      <span className={`mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${paymentStatusClass(tx.status)}`}>
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

function AddCardForm({ onSuccess, onCancel }: { onSuccess: () => void; onCancel: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSaving(true);
    setError('');

    try {
      // Get setup intent client secret from backend
      const res = await paymentMethodsApi.createSetupIntent();
      const { clientSecret, customerId } = res.data;

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) {
        setError(stripeError.message || 'Card setup failed');
      } else {
        const paymentMethodId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;
        if (!paymentMethodId) {
          throw new Error('Stripe did not return a payment method');
        }
        await paymentMethodsApi.save(paymentMethodId, customerId);
        onSuccess();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save card');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">Add a card</h3>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-xl border border-gray-200 px-4 py-3">
          <CardElement options={{
            style: {
              base: {
                fontSize: '14px',
                color: '#1a1a2e',
                '::placeholder': { color: '#9ca3af' },
              },
            },
          }} />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
        )}

        <div className="flex gap-3">
          <button type="button" onClick={onCancel} className="btn-outline flex-1 py-2.5 text-sm">Cancel</button>
          <button type="submit" disabled={saving || !stripe} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">
            {saving ? 'Saving...' : 'Save card'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function PaymentMethodsPage() {
  return (
    <ProtectedRoute>
      <StripeProvider>
        <PaymentMethodsContent />
      </StripeProvider>
    </ProtectedRoute>
  );
}
