'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useEffect, useCallback } from "react";
import { FaGoogle, FaApple, FaPhone } from "react-icons/fa";
import { authApi, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Step = 'identifier' | 'otp';
type Method = 'email' | 'phone';

export default function SignInPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('identifier');
  const [method, setMethod] = useState<Method>('email');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Google OAuth setup
  const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

  const handleGoogleCallback = useCallback(async (response: { credential: string }) => {
    setGoogleLoading(true);
    setError('');
    try {
      const res = await apiFetch<{
        data: { accessToken: string; refreshToken: string; next: 'onboarding' | 'home' };
      }>('/api/v1/auth/google', {
        method: 'POST',
        body: JSON.stringify({ idToken: response.credential }),
      });
      await login(res.data.accessToken, res.data.refreshToken);
      if (res.data.next === 'onboarding') {
        router.push('/onboarding');
      } else {
        router.push('/');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
    }
  }, [login, router]);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || typeof window === 'undefined') return;
    // Load Google Identity Services script
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => {
      (window as unknown as { google: { accounts: { id: { initialize: (config: unknown) => void } } } }).google?.accounts?.id?.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleCallback,
      });
    };
    document.head.appendChild(script);
    return () => { document.head.removeChild(script); };
  }, [GOOGLE_CLIENT_ID, handleGoogleCallback]);

  function triggerGoogleSignIn() {
    const google = (window as unknown as { google?: { accounts?: { id?: { prompt: () => void } } } }).google;
    if (google?.accounts?.id?.prompt) {
      google.accounts.id.prompt();
    } else {
      setError('Google Sign-In not available. Check API key configuration.');
    }
  }

  const handleSubmitIdentifier = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(method, identifier);
      if (res.data?.code) setDevCode(res.data.code);
      setStep('otp');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.verifyOtp(identifier, otp, 'login', method);
      await login(res.data.accessToken, res.data.refreshToken);
      if (res.data.next === 'onboarding') {
        router.push('/onboarding');
      } else {
        router.push('/');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setError('');
    try {
      const res = await authApi.resendOtp(identifier, 'login', method);
      if (res.data?.code) setDevCode(res.data.code);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to resend';
      setError(msg);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-deliivo-cream px-4 py-12">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-deliivo-orange text-white font-bold text-sm shadow-md shadow-deliivo-orange/30">
            D
          </div>
          <span className="text-xl font-bold tracking-tight text-deliivo-dark">Deliivo</span>
        </div>

        <div className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-black/5">
          {/* Illustration */}
          <div className="mb-7 h-36 w-full overflow-hidden rounded-2xl bg-gradient-to-br from-primary-400 via-deliivo-orange to-primary-700 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-white/90">
              <svg viewBox="0 0 120 64" className="w-28 h-auto" fill="none" aria-hidden="true">
                <rect x="0" y="46" width="120" height="18" rx="3" fill="white" fillOpacity="0.15" />
                <rect x="10" y="53" width="16" height="3" rx="1.5" fill="white" fillOpacity="0.4" />
                <rect x="36" y="53" width="16" height="3" rx="1.5" fill="white" fillOpacity="0.4" />
                <rect x="62" y="53" width="16" height="3" rx="1.5" fill="white" fillOpacity="0.4" />
                <rect x="88" y="53" width="16" height="3" rx="1.5" fill="white" fillOpacity="0.4" />
                <rect x="28" y="28" width="64" height="22" rx="6" fill="white" fillOpacity="0.9" />
                <path d="M42 28 L50 12 L70 12 L78 28 Z" fill="white" fillOpacity="0.75" />
                <rect x="52" y="15" width="16" height="11" rx="2" fill="#F97316" fillOpacity="0.6" />
                <circle cx="44" cy="50" r="8" fill="#1A1A2E" />
                <circle cx="44" cy="50" r="4" fill="white" fillOpacity="0.6" />
                <circle cx="76" cy="50" r="8" fill="#1A1A2E" />
                <circle cx="76" cy="50" r="4" fill="white" fillOpacity="0.6" />
                <rect x="88" y="33" width="5" height="4" rx="1" fill="#FDE68A" />
              </svg>
              <span className="text-xs font-semibold tracking-wide opacity-80">
                Baltic Carpooling
              </span>
            </div>
          </div>

          {step === 'identifier' ? (
            <>
              <h1 className="mb-1 text-2xl font-bold tracking-tight text-deliivo-dark">
                Sign in to your account
              </h1>
              <p className="mb-6 text-sm text-deliivo-gray">
                {method === 'email'
                  ? 'Enter your email to receive a verification code.'
                  : 'Enter your phone number to receive an OTP.'}
              </p>

              <form className="space-y-4" onSubmit={handleSubmitIdentifier}>
                <div>
                  <label htmlFor="identifier" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                    {method === 'email' ? 'Email address' : 'Phone number'}
                  </label>
                  <input
                    id="identifier"
                    type={method === 'email' ? 'email' : 'tel'}
                    autoComplete={method === 'email' ? 'email' : 'tel'}
                    required
                    placeholder={method === 'email' ? 'you@example.com' : '+44 7700 900000'}
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="input-field"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base disabled:opacity-50">
                  {loading ? 'Sending...' : 'Continue'}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium text-deliivo-gray">OR</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <div className="space-y-3">
                {method === 'email' ? (
                  <button
                    type="button"
                    onClick={() => { setMethod('phone'); setIdentifier(''); setError(''); }}
                    className="btn-outline w-full gap-2.5 py-3 text-sm"
                  >
                    <FaPhone className="h-4 w-4 shrink-0" />
                    Sign in with Phone
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setMethod('email'); setIdentifier(''); setError(''); }}
                    className="btn-outline w-full gap-2.5 py-3 text-sm"
                  >
                    Sign in with Email
                  </button>
                )}

                <button
                  type="button"
                  onClick={triggerGoogleSignIn}
                  disabled={googleLoading || !GOOGLE_CLIENT_ID}
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-deliivo-dark transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  <FaGoogle className="h-4 w-4 shrink-0 text-[#4285F4]" />
                  {googleLoading ? 'Signing in...' : 'Continue with Google'}
                </button>

                <button
                  type="button"
                  disabled
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-deliivo-dark transition-colors hover:bg-gray-50 disabled:opacity-50"
                  title="Apple Sign-In coming soon"
                >
                  <FaApple className="h-4 w-4 shrink-0" />
                  Continue with Apple
                </button>
              </div>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-2xl font-bold tracking-tight text-deliivo-dark">
                Enter verification code
              </h1>
              <p className="mb-2 text-sm text-deliivo-gray">
                We sent a 4-digit code to <strong>{identifier}</strong>
              </p>

              {devCode && (
                <p className="mb-4 text-xs bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-yellow-800">
                  Dev mode — OTP: <strong>{devCode}</strong>
                </p>
              )}

              <form className="space-y-4" onSubmit={handleVerifyOtp}>
                <div>
                  <label htmlFor="otp" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                    Verification Code
                  </label>
                  <input
                    id="otp"
                    type="text"
                    inputMode="numeric"
                    maxLength={4}
                    required
                    placeholder="1234"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="input-field text-center text-2xl tracking-[0.5em] font-bold"
                  />
                </div>

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={loading || otp.length < 4} className="btn-primary w-full py-3 text-base disabled:opacity-50">
                  {loading ? 'Verifying...' : 'Verify & Sign In'}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { setStep('identifier'); setOtp(''); setError(''); setDevCode(null); }}
                  className="text-sm text-deliivo-gray hover:text-deliivo-dark"
                >
                  &larr; Change {method}
                </button>
                <button
                  type="button"
                  onClick={handleResendOtp}
                  className="text-sm font-semibold text-deliivo-orange hover:text-deliivo-orange-dark"
                >
                  Resend code
                </button>
              </div>
            </>
          )}

          <p className="mt-6 text-center text-sm text-deliivo-gray">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="font-semibold text-deliivo-orange hover:text-deliivo-orange-dark transition-colors">
              Sign up
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
