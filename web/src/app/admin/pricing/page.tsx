'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, Loader2, Plus, RefreshCw, Save, ToggleLeft, ToggleRight } from 'lucide-react';
import LoadFailureCard from '@/components/LoadFailureCard';
import { adminApi, AdminPricingConfig, getApiErrorMessage } from '@/lib/api';

type PricingForm = {
  regionCode: string;
  currency: string;
  minRatePerKm: string;
  recommendedRatePerKm: string;
  maxRatePerKm: string;
  minimumSeatPrice: string;
  roundingStrategy: string;
  active: boolean;
  validFrom: string;
  validTo: string;
};

const emptyForm = (regionCode = 'BALTIC'): PricingForm => ({
  regionCode,
  currency: 'EUR',
  minRatePerKm: '0.20',
  recommendedRatePerKm: '0.35',
  maxRatePerKm: '0.60',
  minimumSeatPrice: '3.00',
  roundingStrategy: 'NEAREST_EURO',
  active: true,
  validFrom: '',
  validTo: '',
});

const formatInputDate = (value?: string | null) => {
  if (!value) return '';
  return value.slice(0, 16);
};

export default function AdminPricingPage() {
  const [configs, setConfigs] = useState<AdminPricingConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<PricingForm>(emptyForm());

  useEffect(() => {
    loadConfigs();
  }, []);

  const selectedConfig = useMemo(
    () => configs.find((config) => config.id === selectedId) || null,
    [configs, selectedId],
  );

  async function loadConfigs(silent = false) {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const res = await adminApi.getPricingConfigs();
      setConfigs(res.data || []);
      if (!selectedId && res.data?.length) {
        setSelectedId(res.data[0].id);
        hydrateForm(res.data[0]);
      } else if (selectedId) {
        const current = res.data.find((item) => item.id === selectedId);
        if (current) hydrateForm(current);
      }
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to load pricing configs'));
    } finally {
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }

  function hydrateForm(config: AdminPricingConfig) {
    setForm({
      regionCode: config.regionCode,
      currency: config.currency,
      minRatePerKm: String(config.minRatePerKm),
      recommendedRatePerKm: String(config.recommendedRatePerKm),
      maxRatePerKm: String(config.maxRatePerKm),
      minimumSeatPrice: String(config.minimumSeatPrice),
      roundingStrategy: config.roundingStrategy,
      active: config.active,
      validFrom: formatInputDate(config.validFrom),
      validTo: formatInputDate(config.validTo || ''),
    });
  }

  function startCreate() {
    setSelectedId(null);
    setForm(emptyForm());
  }

  function selectConfig(config: AdminPricingConfig) {
    setSelectedId(config.id);
    hydrateForm(config);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      const payload = {
        regionCode: form.regionCode.trim(),
        currency: form.currency.trim().toUpperCase(),
        minRatePerKm: Number(form.minRatePerKm),
        recommendedRatePerKm: Number(form.recommendedRatePerKm),
        maxRatePerKm: Number(form.maxRatePerKm),
        minimumSeatPrice: Number(form.minimumSeatPrice),
        roundingStrategy: form.roundingStrategy,
        active: form.active,
        ...(form.validFrom ? { validFrom: new Date(form.validFrom).toISOString() } : {}),
        ...(form.validTo ? { validTo: new Date(form.validTo).toISOString() } : { validTo: null }),
      };

      if (selectedConfig) {
        await adminApi.updatePricingConfig(selectedConfig.id, payload);
      } else {
        await adminApi.createPricingConfig(payload);
      }

      await loadConfigs(true);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err, 'Failed to save pricing config'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-8 w-8 animate-spin text-[#F97316]" />
      </div>
    );
  }

  if (error && configs.length === 0) {
    return (
      <LoadFailureCard
        title="Pricing configs unavailable"
        message={error}
        onRetry={() => loadConfigs()}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Pricing</h1>
          <p className="mt-0.5 text-sm text-gray-500">Manage regional pricing configs used for preview and validation.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={startCreate}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:text-[#F97316]"
          >
            <Plus className="h-4 w-4" />
            New config
          </button>
          <button
            type="button"
            onClick={() => loadConfigs(true)}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:border-[#F97316] hover:text-[#F97316] disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <BadgeDollarSign className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">Config list</h2>
          </div>
          <div className="mt-4 space-y-3">
            {configs.map((config) => (
              <button
                key={config.id}
                type="button"
                onClick={() => selectConfig(config)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                  selectedId === config.id
                    ? 'border-[#F97316] bg-orange-50/40'
                    : 'border-gray-100 bg-gray-50 hover:border-[#F97316] hover:bg-orange-50/20'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-gray-900">{config.regionCode}</p>
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${config.active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {config.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {config.currency} | min {config.minRatePerKm} | rec {config.recommendedRatePerKm} | max {config.maxRatePerKm}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      Valid from {new Date(config.validFrom).toLocaleString()}
                      {config.validTo ? ` · valid to ${new Date(config.validTo).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs text-gray-500">
                    <span>{config.roundingStrategy}</span>
                    <span>Seat floor {config.minimumSeatPrice}</span>
                  </div>
                </div>
              </button>
            ))}
            {configs.length === 0 && (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
                No pricing configs found.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4 text-[#F97316]" />
            <h2 className="text-sm font-semibold text-gray-900">{selectedConfig ? 'Edit config' : 'Create config'}</h2>
          </div>
          <div className="mt-4 space-y-3">
            <Field label="Region code" value={form.regionCode} onChange={(value) => setForm((prev) => ({ ...prev, regionCode: value }))} />
            <Field label="Currency" value={form.currency} onChange={(value) => setForm((prev) => ({ ...prev, currency: value }))} />
            <Field label="Min rate / km" type="number" value={form.minRatePerKm} onChange={(value) => setForm((prev) => ({ ...prev, minRatePerKm: value }))} />
            <Field label="Recommended rate / km" type="number" value={form.recommendedRatePerKm} onChange={(value) => setForm((prev) => ({ ...prev, recommendedRatePerKm: value }))} />
            <Field label="Max rate / km" type="number" value={form.maxRatePerKm} onChange={(value) => setForm((prev) => ({ ...prev, maxRatePerKm: value }))} />
            <Field label="Minimum seat price" type="number" value={form.minimumSeatPrice} onChange={(value) => setForm((prev) => ({ ...prev, minimumSeatPrice: value }))} />
            <label className="block">
              <span className="text-xs font-medium text-gray-500">Rounding strategy</span>
              <select
                value={form.roundingStrategy}
                onChange={(e) => setForm((prev) => ({ ...prev, roundingStrategy: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#F97316]"
              >
                <option value="NEAREST_EURO">NEAREST_EURO</option>
                <option value="NEAREST_HALF_EURO">NEAREST_HALF_EURO</option>
                <option value="DECIMAL">DECIMAL</option>
              </select>
            </label>
            <label className="flex items-center justify-between rounded-xl border border-gray-200 px-3 py-3">
              <div>
                <p className="text-sm font-semibold text-gray-900">Active</p>
                <p className="text-xs text-gray-500">Activate this config for preview and validation.</p>
              </div>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, active: !prev.active }))}
                className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700"
              >
                {form.active ? <ToggleRight className="h-5 w-5 text-green-600" /> : <ToggleLeft className="h-5 w-5 text-gray-400" />}
                {form.active ? 'Yes' : 'No'}
              </button>
            </label>
            <Field label="Valid from" type="datetime-local" value={form.validFrom} onChange={(value) => setForm((prev) => ({ ...prev, validFrom: value }))} />
            <Field label="Valid to" type="datetime-local" value={form.validTo} onChange={(value) => setForm((prev) => ({ ...prev, validTo: value }))} />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#F97316] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#ea6f00] disabled:opacity-50"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save config
            </button>
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Editing one config updates the active policy. Creating a new active config deactivates any existing active config for the same region.
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#F97316]"
      />
    </label>
  );
}
