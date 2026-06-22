'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, CreditCard, Plus, Trash2, CheckCircle, Loader2, ReceiptText } from 'lucide-react';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';
import { isStripeConfigured, StripeProvider } from '@/lib/stripe';
import ProtectedRoute from '@/components/ProtectedRoute';
import LoadFailureCard from '@/components/LoadFailureCard';
import { getApiErrorMessage, paymentMethodsApi, PaymentMethod, paymentsApi, RiderTransaction } from '@/lib/api';
import { showError, showSuccess } from '@/lib/app-feedback';
import { useTranslation } from '@/lib/i18n-context';

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
  const { t } = useTranslation();
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
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.cardsLoadFailed'));
      setError(message);
      showError(t('profile.cardsLoadError'), message);
    }
    finally { if (manageLoading) setLoading(false); }
  }

  async function loadTransactions() {
    try {
      const res = await paymentsApi.transactions();
      setTransactions(res.data || []);
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.paymentHistoryLoadFailed'));
      setError(message);
      showError(t('profile.paymentHistoryLoadError'), message);
    }
  }

  async function handleSetDefault(id: string) {
    setSettingDefaultId(id);
    setError('');
    try {
      await paymentMethodsApi.setDefault(id);
      await loadMethods();
      showSuccess(t('profile.defaultCardUpdated'), t('profile.defaultCardUpdatedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.setDefaultCardFailed'));
      setError(message);
      showError(t('profile.setDefaultCardError'), message);
    } finally {
      setSettingDefaultId(null);
    }
  }

  async function handleRemove(id: string) {
    if (!confirm(t('profile.removeCardConfirm'))) return;
    setRemovingId(id);
    setError('');
    try {
      await paymentMethodsApi.remove(id);
      await loadMethods();
      showSuccess(t('profile.cardRemoved'), t('profile.cardRemovedCopy'));
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.removeCardFailed'));
      setError(message);
      showError(t('profile.removeCardError'), message);
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
      <header className="bg-white border-b border-orange-100 px-4 py-4 flex items-center gap-3 sm:px-6">
        <Link href="/profile" className="flex items-center gap-1 text-sm text-gray-600 hover:text-deliivo-orange transition-colors">
          <ChevronLeft className="w-4 h-4" /> {t('profile.title')}
        </Link>
        <h1 className="text-lg font-semibold text-gray-900 ml-2">{t('profile.paymentsHistory')}</h1>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-6 flex flex-col gap-5">
        <div className="bg-white rounded-2xl shadow-sm p-5">
          <h2 className="text-sm font-semibold text-gray-900">{t('profile.paymentMethods')}</h2>
          <p className="mt-1 text-sm text-deliivo-gray">
            {t('profile.paymentMethodsCopy')}
          </p>
        </div>

        {error && (
          <LoadFailureCard
            title={t('profile.paymentsHistory')}
            message={error}
            onRetry={loadPage}
          />
        )}

        {methods.length > 0 && !methods.some((method) => method.isDefault) && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-900 font-medium">{t('profile.noDefaultCard')}</p>
            <p className="mt-1 text-xs text-amber-800">
              {t('profile.noDefaultCardCopy')}
            </p>
          </div>
        )}

        {methods.length === 0 && !showAddCard && (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <CreditCard className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-deliivo-gray">{t('profile.noPaymentMethods')}</p>
            <button
              type="button"
              onClick={() => setShowAddCard(true)}
              className="mt-4 rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-deliivo-dark hover:bg-gray-50"
            >
              {t('profile.addPaymentMethod')}
            </button>
          </div>
        )}

        {methods.map(m => (
          <div key={m.id} className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5 text-gray-500" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900 capitalize">{m.brand || t('profile.card')} {m.last4 ? `**** ${m.last4}` : ''}</p>
              <p className="text-xs text-deliivo-gray">
                {m.expMonth && m.expYear ? t('profile.expiresAt', { month: String(m.expMonth).padStart(2, '0'), year: m.expYear }) : t('profile.expiryNotAvailable')}
              </p>
            </div>
            {m.isDefault ? (
              <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> {t('profile.default')}
              </span>
            ) : (
              <button
                onClick={() => handleSetDefault(m.id)}
                disabled={settingDefaultId === m.id || !!removingId}
                className="text-xs font-medium text-deliivo-orange hover:underline disabled:opacity-50"
              >
                {settingDefaultId === m.id ? t('profile.saving') : t('profile.setDefault')}
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
              <h3 className="text-sm font-semibold text-yellow-900">{t('profile.stripeKeyRequired')}</h3>
              <p className="mt-1 text-sm text-yellow-800">
                {t('profile.stripeKeyRequiredCopy')}
              </p>
              <button type="button" onClick={() => setShowAddCard(false)} className="mt-4 btn-outline py-2 text-sm">
                {t('common.back')}
              </button>
            </div>
          )
        ) : (
          <button onClick={() => setShowAddCard(true)} className="btn-primary w-full py-3 gap-2">
            <Plus className="w-4 h-4" /> {t('profile.addPaymentMethod')}
          </button>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-5">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 text-deliivo-orange" />
            <h2 className="text-sm font-semibold text-gray-900">{t('profile.paymentHistory')}</h2>
          </div>
          <p className="mt-1 text-sm text-deliivo-gray">{t('profile.paymentHistoryCopy')}</p>
        </div>

        {transactions.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-8 text-center">
            <ReceiptText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-deliivo-gray">{t('profile.noTransactions')}</p>
            <button
              type="button"
              onClick={loadTransactions}
              className="mt-4 rounded-xl border border-gray-200 px-4 py-2 text-xs font-semibold text-deliivo-dark hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
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
                      <p className="mt-1 text-xs text-deliivo-gray">{t('profile.bookingStatus')}: {tx.booking?.status || t('profile.unknown')}</p>
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
                      <p className="text-[11px] text-deliivo-gray">{t('profile.fare')}</p>
                      <p className="text-xs font-semibold text-gray-900">{formatMoney(tx.fareAmount, tx.currency)}</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-deliivo-gray">{t('profile.serviceFee')}</p>
                      <p className="text-xs font-semibold text-gray-900">{formatMoney(tx.platformFeeAmount, tx.currency)}</p>
                    </div>
                    <div className="rounded-xl bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-deliivo-gray">{t('profile.refund')}</p>
                      <p className="text-xs font-semibold text-gray-900">{tx.booking?.refundedAt ? formatMoney(tx.booking.refundAmount || 0, tx.currency) : t('profile.none')}</p>
                    </div>
                  </div>

                  {openDispute && (
                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-xs text-amber-800">{t('profile.disputeOpen', { reason: openDispute.reason.replace(/_/g, ' '), status: openDispute.status.replace(/_/g, ' ') })}</p>
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {ride?.id && (
                      <Link
                        href={`/rides/${ride.id}`}
                        className="inline-flex items-center rounded-full border border-gray-200 px-3 py-1.5 text-xs font-semibold text-deliivo-dark hover:bg-gray-50"
                      >
                        {t('ride.view')}
                      </Link>
                    )}
                    {openDispute && (
                      <Link
                        href="/profile/disputes"
                        className="inline-flex items-center rounded-full border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                      >
                        {t('profile.disputes')}
                      </Link>
                    )}
                  </div>
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
  const { t } = useTranslation();
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
      if (!cardElement) throw new Error(t('profile.cardElementMissing'));

      const { error: stripeError, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) {
        setError(stripeError.message || t('profile.cardSetupFailed'));
      } else {
        const paymentMethodId = typeof setupIntent.payment_method === 'string'
          ? setupIntent.payment_method
          : setupIntent.payment_method?.id;
        if (!paymentMethodId) {
          throw new Error(t('profile.cardMethodMissing'));
        }
        await paymentMethodsApi.save(paymentMethodId, customerId);
        showSuccess(t('profile.cardSaved'), t('profile.cardSavedCopy'));
        onSuccess();
      }
    } catch (err: unknown) {
      const message = getApiErrorMessage(err, t('profile.cardSaveFailed'));
      setError(message);
      showError(t('profile.cardSaveError'), message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm p-5">
      <h3 className="text-sm font-semibold text-gray-900 mb-4">{t('profile.addCard')}</h3>
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
          <button type="button" onClick={onCancel} className="btn-outline flex-1 py-2.5 text-sm">{t('common.cancel')}</button>
          <button type="submit" disabled={saving || !stripe} className="btn-primary flex-1 py-2.5 text-sm disabled:opacity-50">
            {saving ? t('profile.saving') : t('profile.saveCard')}
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
