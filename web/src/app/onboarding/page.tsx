'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userApi } from '@/lib/api';
import ProtectedRoute from '@/components/ProtectedRoute';

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

  const [name, setName] = useState('');
  const [nickName, setNickName] = useState('');
  const [dob, setDob] = useState('');
  const [salutation, setSalutation] = useState('');
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
        salutation: salutation || undefined,
      });
      await refreshUser();
      router.push('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to complete onboarding';
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
          <h1 className="text-2xl font-bold text-deliivo-dark">Welcome to Deliivo!</h1>
          <p className="mt-1 text-sm text-deliivo-gray">Tell us about yourself to get started.</p>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
          <form className="space-y-5" onSubmit={handleSubmit}>
            <div>
              <label htmlFor="salutation" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                Salutation
              </label>
              <select
                id="salutation"
                value={salutation}
                onChange={(e) => setSalutation(e.target.value)}
                className="input-field"
              >
                <option value="">Select...</option>
                <option value="MR">Mr</option>
                <option value="MS">Ms</option>
                <option value="MRS">Mrs</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label htmlFor="name" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                Full Name *
              </label>
              <input
                id="name"
                type="text"
                required
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="nickName" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                Nickname (optional)
              </label>
              <input
                id="nickName"
                type="text"
                placeholder="Johnny"
                value={nickName}
                onChange={(e) => setNickName(e.target.value)}
                className="input-field"
              />
            </div>

            <div>
              <label htmlFor="dob" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                Date of Birth (optional)
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

            <button type="submit" disabled={loading || !name.trim()} className="btn-primary w-full py-3 text-base disabled:opacity-50">
              {loading ? 'Saving...' : 'Complete Setup'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
