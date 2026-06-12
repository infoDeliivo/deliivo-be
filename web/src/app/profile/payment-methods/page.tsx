'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, CreditCard, Plus, Trash2, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';
import { StripeProvider } from '@/lib/stripe';
import ProtectedRoute from '@/components/ProtectedRoute';
import { paymentMethodsApi, PaymentMethod } from '@/lib/api';

function PaymentMethodsContent() {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddCard, setShowAddCard] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadMethods(); }, []);

  async function loadMethods() {
    setLoading(true);
    try {
      const res = await paymentMethodsApi.list();
      setMethods(res.data || []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  async function handleSetDefault(id: string) {
    try {
      await paymentMethodsApi.setDefault(id);
      setMethods(prev => prev.map(m => ({ ...m, isDefault: m.id === id })));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    }
  }

  async function handleRemove(id: string) {
    if (!confirm('Remove this card?')) return;
    try {
      await paymentMethodsApi.remove(id);
      setMethods(prev => prev.filter(m => m.id !== id));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to remove card');
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
        <h1 className="text-lg font-semibold text-gray-900 ml-2">Payment Methods</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 py-6 flex flex-col gap-4">
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0" />
            <p className="text-sm text-red-600">{error}</p>
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
              <p className="text-sm font-semibold text-gray-900 capitalize">{m.brand} **** {m.last4}</p>
              <p className="text-xs text-deliivo-gray">Expires {String(m.expMonth).padStart(2, '0')}/{m.expYear}</p>
            </div>
            {m.isDefault ? (
              <span className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                <CheckCircle className="w-3 h-3" /> Default
              </span>
            ) : (
              <button onClick={() => handleSetDefault(m.id)} className="text-xs font-medium text-deliivo-orange hover:underline">
                Set default
              </button>
            )}
            <button onClick={() => handleRemove(m.id)} className="p-1.5 text-red-400 hover:text-red-600 rounded-full hover:bg-red-50">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}

        {showAddCard ? (
          <AddCardForm
            onSuccess={() => { setShowAddCard(false); loadMethods(); }}
            onCancel={() => setShowAddCard(false)}
          />
        ) : (
          <button onClick={() => setShowAddCard(true)} className="btn-primary w-full py-3 gap-2">
            <Plus className="w-4 h-4" /> Add payment method
          </button>
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
      const { clientSecret } = res.data;

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) throw new Error('Card element not found');

      const { error: stripeError } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (stripeError) {
        setError(stripeError.message || 'Card setup failed');
      } else {
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
