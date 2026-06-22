'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Car, Plus, Trash2, ArrowLeft, Upload, CheckCircle } from 'lucide-react';
import { vehicleApi, Vehicle, VehicleType } from '@/lib/api';
import ProtectedRoute from '@/components/ProtectedRoute';
import Navbar from '@/components/Navbar';
import { useTranslation } from '@/lib/i18n-context';

export default function VehiclePage() {
  return (
    <ProtectedRoute>
      <Navbar />
      <VehicleContent />
    </ProtectedRoute>
  );
}

function VehicleContent() {
  const { t } = useTranslation();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Draft form state
  const [step, setStep] = useState(1);
  const [licenseCountry, setLicenseCountry] = useState('EE');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [brand, setBrand] = useState('');
  const [modelNum, setModelNum] = useState('');
  const [modelName, setModelName] = useState('');
  const [type, setType] = useState<VehicleType>('sedan');
  const [color, setColor] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchVehicles();
  }, []);

  const fetchVehicles = async () => {
    try {
      const res = await vehicleApi.list();
      setVehicles(res.data?.vehicles || []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleCreateDraft = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await vehicleApi.createDraft(licenseCountry, licenseNumber);
      setStep(2);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.vehicleDraftFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Document upload state
  const [documents, setDocuments] = useState<{ imageUrl: string; documentType: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const vehicleTypes: { value: VehicleType; label: string }[] = [
    { value: 'sedan', label: t('profile.vehicleTypeSedan') },
    { value: 'hatchback', label: t('profile.vehicleTypeHatchback') },
    { value: 'suv', label: t('profile.vehicleTypeSuv') },
    { value: 'minibus', label: t('profile.vehicleTypeMinibus') },
    { value: 'coupe', label: t('profile.vehicleTypeCoupe') },
    { value: 'convertible', label: t('profile.vehicleTypeConvertible') },
    { value: 'pickup', label: t('profile.vehicleTypePickup') },
    { value: 'van', label: t('profile.vehicleTypeVan') },
    { value: 'truck', label: t('profile.vehicleTypeTruck') },
  ];

  const handleSaveDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      await vehicleApi.updateDraftDetails({ brand, model_num: modelNum, model_name: modelName, type, color, year });
      setStep(3); // Go to document upload step
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.vehicleDetailsFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDocUpload = async (file: File, documentType: string) => {
    setUploading(true);
    setError('');
    try {
      const res = await vehicleApi.uploadDraftDocument(file, documentType);
      setDocuments(prev => [...prev, { imageUrl: res.data.imageUrl, documentType: res.data.documentType }]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.vehicleUploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleFinalizeDraft = async () => {
    setSaving(true);
    setError('');
    try {
      await vehicleApi.saveDraft();
      await fetchVehicles();
      setShowAddForm(false);
      setStep(1);
      resetForm();
      setDocuments([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('profile.vehicleSaveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('profile.deleteVehicleConfirm'))) return;
    setDeleting(id);
    try {
      await vehicleApi.delete(id);
      setVehicles((v) => v.filter((veh) => veh.id !== id));
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  };

  const resetForm = () => {
    setLicenseCountry('EE');
    setLicenseNumber('');
    setBrand('');
    setModelNum('');
    setModelName('');
    setType('sedan');
    setColor('');
    setYear(new Date().getFullYear());
    setError('');
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-200 border-t-primary-500" />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/profile" className="rounded-full p-2 hover:bg-gray-100">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-2xl font-bold">{t('profile.yourVehicles')}</h1>
      </div>

      {vehicles.length > 0 && (
        <div className="mb-6 space-y-4">
          {vehicles.map((v) => (
            <div key={v.id} className="card flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gray-100">
                {v.imageUrl ? (
                  <img src={v.imageUrl} alt="" className="h-16 w-16 rounded-xl object-cover" />
                ) : (
                  <Car size={24} className="text-deliivo-gray" />
                )}
              </div>
              <div className="flex-1">
                <h3 className="font-semibold">{v.brand} {v.model_name || v.model_num}</h3>
                <p className="text-sm text-deliivo-gray">
                  {v.color} &middot; {v.type} &middot; {v.year}
                </p>
                {v.isVerified && (
                  <span className="text-xs text-green-600 font-medium">{t('profile.verified')}</span>
                )}
              </div>
              <button
                onClick={() => handleDelete(v.id)}
                disabled={deleting === v.id}
                className="rounded-full p-2 text-red-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
      )}

      {showAddForm ? (
        <div className="card">
          <h2 className="mb-4 text-lg font-bold">{t('profile.addVehicle')}</h2>

          {step === 1 && (
            <form onSubmit={handleCreateDraft} className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.country')}</label>
                <input type="text" value={licenseCountry} onChange={(e) => setLicenseCountry(e.target.value)} placeholder={t('profile.countryPlaceholder')} className="input-field" required />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.licenseNumber')}</label>
                <input type="text" value={licenseNumber} onChange={(e) => setLicenseNumber(e.target.value)} placeholder={t('profile.licenseNumberPlaceholder')} className="input-field" required />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => { setShowAddForm(false); resetForm(); }} className="btn-outline flex-1 py-2 text-sm">{t('common.cancel')}</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 py-2 text-sm disabled:opacity-50">{saving ? t('profile.creating') : t('profile.next')}</button>
              </div>
            </form>
          )}

          {step === 2 && (
            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.brand')}</label>
                  <input type="text" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Toyota" className="input-field" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.modelNumber')}</label>
                  <input type="text" value={modelNum} onChange={(e) => setModelNum(e.target.value)} placeholder="Avanza" className="input-field" required />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.modelName')}</label>
                  <input type="text" value={modelName} onChange={(e) => setModelName(e.target.value)} placeholder="Avanza G" className="input-field" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.type')}</label>
                  <select value={type} onChange={(e) => setType(e.target.value as VehicleType)} className="input-field" required>
                    {vehicleTypes.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.color')}</label>
                  <input type="text" value={color} onChange={(e) => setColor(e.target.value)} placeholder="Black" className="input-field" required />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">{t('profile.year')}</label>
                  <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} min={1990} max={new Date().getFullYear()} className="input-field" required />
                </div>
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(1)} className="btn-outline flex-1 py-2 text-sm">{t('common.back')}</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 py-2 text-sm disabled:opacity-50">{saving ? t('profile.saving') : t('profile.next')}</button>
              </div>
            </form>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-deliivo-gray">Upload documents (optional). You can skip and save directly.</p>

              {/* Upload buttons */}
              {['VEHICLE_IMAGE', 'DRIVING_LICENSE', 'INSURANCE_DOCUMENT'].map(docType => (
                <div key={docType} className="flex items-center gap-3">
                  <label className={`flex-1 flex items-center gap-2 cursor-pointer rounded-xl border border-dashed border-gray-300 px-4 py-3 text-sm hover:border-deliivo-orange transition-colors ${documents.some(d => d.documentType === docType) ? 'border-green-400 bg-green-50' : ''}`}>
                    {documents.some(d => d.documentType === docType) ? (
                      <CheckCircle size={16} className="text-green-500 shrink-0" />
                    ) : (
                      <Upload size={16} className="text-deliivo-gray shrink-0" />
                    )}
                    <span>{docType.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploading}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleDocUpload(f, docType);
                      }}
                    />
                  </label>
                </div>
              ))}

              {uploading && <p className="text-xs text-deliivo-gray">Uploading...</p>}
              {error && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

              <div className="flex gap-3">
                <button type="button" onClick={() => setStep(2)} className="btn-outline flex-1 py-2 text-sm">Back</button>
                <button type="button" onClick={handleFinalizeDraft} disabled={saving} className="btn-primary flex-1 py-2 text-sm disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Vehicle'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <button onClick={() => setShowAddForm(true)} className="btn-primary w-full gap-2 py-3">
          <Plus size={18} />
          Add Vehicle
        </button>
      )}
    </main>
  );
}
