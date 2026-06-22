'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userApi } from '@/lib/api';
import ProtectedRoute from '@/components/ProtectedRoute';
import { useTranslation } from '@/lib/i18n-context';

export default function OnboardingPage() {
  return (
    <ProtectedRoute>
      <OnboardingForm />
    </ProtectedRoute>
  );
}

function OnboardingForm() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const { t } = useTranslation();

  const [name, setName] = useState('');
  const [nickName, setNickName] = useState('');
  const [dob, setDob] = useState('');
  const [salutation, setSalutation] = useState('');
  const [gender, setGender] = useState<'MALE' | 'FEMALE' | 'NON_BINARY' | 'OTHER' | 'PREFER_NOT_TO_SAY' | ''>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await userApi.completeOnboarding({
        name,
        nickName: nickName || undefined,
        dob: dob || undefined,
        salutation,
        gender: gender || undefined,
      });
      await refreshUser();
      router.push('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('onboarding.failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-deliivo-cream px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-deliivo-orange text-white font-bold text-xl shadow-lg shadow-deliivo-orange/30">
            D
          </div>
          <h1 className="text-2xl font-bold text-deliivo-dark">{t('onboarding.title')}</h1>
          <p className="mt-1 text-sm text-deliivo-gray">{t('onboarding.subtitle')}</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="salutation" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                {t('onboarding.salutation')} *
              </label>
              <select
                id="salutation"
                value={salutation}
                onChange={(e) => setSalutation(e.target.value)}
                required
                className="input-field"
              >
                <option value="">{t('onboarding.select')}</option>
                <option value="MR">{t('onboarding.mr')}</option>
                <option value="MS">{t('onboarding.ms')}</option>
                <option value="MRS">{t('onboarding.mrs')}</option>
                <option value="MX">{t('onboarding.mx')}</option>
                <option value="OTHER">{t('onboarding.other')}</option>
              </select>
            </div>

            <div>
              <label htmlFor="gender" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                {t('onboarding.gender')} *
              </label>
              <select
                id="gender"
                value={gender}
                onChange={(e) => setGender(e.target.value as typeof gender)}
                required
                className="input-field"
              >
                <option value="">{t('onboarding.select')}</option>
                <option value="FEMALE">{t('onboarding.female')}</option>
                <option value="MALE">{t('onboarding.male')}</option>
                <option value="NON_BINARY">{t('onboarding.nonBinary')}</option>
                <option value="OTHER">{t('onboarding.other')}</option>
                <option value="PREFER_NOT_TO_SAY">{t('onboarding.preferNotSay')}</option>
              </select>
              <p className="mt-1 text-xs text-deliivo-gray">{t('onboarding.genderCopy')}</p>
            </div>

            <div>
              <label htmlFor="name" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                {t('onboarding.fullName')} *
              </label>
              <input
                id="name"
                type="text"
                required
                placeholder={t('onboarding.fullNamePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="nickName" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                {t('onboarding.nickname')}
              </label>
              <input
                id="nickName"
                type="text"
                placeholder={t('onboarding.nicknamePlaceholder')}
                value={nickName}
                onChange={(e) => setNickName(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="dob" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                {t('onboarding.dob')}
              </label>
              <input
                id="dob"
                type="date"
                value={dob}
                onChange={(e) => setDob(e.target.value)}
                className="input-field"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button type="submit" disabled={loading || !name.trim() || !salutation || !gender} className="btn-primary w-full py-3 text-base disabled:opacity-50">
              {loading ? t('onboarding.saving') : t('onboarding.complete')}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
