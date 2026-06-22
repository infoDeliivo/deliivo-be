'use client';

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FaGoogle, FaApple } from "react-icons/fa";
import { authApi } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

type Step = 'form' | 'otp';
type Method = 'email' | 'phone';

export default function SignUpPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [step, setStep] = useState<Step>('form');
  const [method, setMethod] = useState<Method>('email');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const identifier = method === 'email' ? email : phone;

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.signup(method, identifier);
      if (res.data?.code) setDevCode(res.data.code);
      setStep('otp');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Signup failed';
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
      const res = await authApi.verifyOtp(identifier, otp, 'signup', method);
      await login(res.data.accessToken, res.data.refreshToken);
      router.push('/onboarding');
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
      const res = await authApi.resendOtp(identifier, 'signup', method);
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
          {step === 'form' ? (
            <>
              <h1 className="mb-1 text-2xl font-bold tracking-tight text-deliivo-dark">
                Create your account
              </h1>
              <p className="mb-6 text-sm text-deliivo-gray">
                Join Deliivo and start carpooling today.
              </p>

              {/* Method toggle */}
              <div className="mb-6 flex rounded-full bg-gray-100 p-1">
                <button
                  type="button"
                  onClick={() => setMethod('email')}
                  className={`flex-1 rounded-full py-2 text-sm font-medium transition-all ${
                    method === 'email' ? 'bg-white shadow-sm text-deliivo-dark' : 'text-deliivo-gray'
                  }`}
                >
                  Email
                </button>
                <button
                  type="button"
                  onClick={() => setMethod('phone')}
                  className={`flex-1 rounded-full py-2 text-sm font-medium transition-all ${
                    method === 'phone' ? 'bg-white shadow-sm text-deliivo-dark' : 'text-deliivo-gray'
                  }`}
                >
                  Phone
                </button>
              </div>

              <form className="space-y-4" onSubmit={handleSignup}>
                {method === 'email' ? (
                  <div>
                    <label htmlFor="email" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                      Email address
                    </label>
                    <input
                      id="email"
                      type="email"
                      autoComplete="email"
                      required
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="input-field"
                    />
                  </div>
                ) : (
                  <div>
                    <label htmlFor="phone" className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-deliivo-gray">
                      Phone number
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      autoComplete="tel"
                      required
                      placeholder="+44 7700 900000"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="input-field"
                    />
                  </div>
                )}

                {error && (
                  <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
                )}

                <button type="submit" disabled={loading} className="btn-primary w-full py-3 text-base disabled:opacity-50">
                  {loading ? 'Creating account...' : 'Sign up'}
                </button>
              </form>

              <div className="my-6 flex items-center gap-3">
                <div className="h-px flex-1 bg-gray-200" />
                <span className="text-xs font-medium text-deliivo-gray">OR</span>
                <div className="h-px flex-1 bg-gray-200" />
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-deliivo-dark transition-colors hover:bg-gray-50"
                >
                  <FaGoogle className="h-4 w-4 shrink-0 text-[#4285F4]" />
                  Continue with Google
                </button>

                <button
                  type="button"
                  className="flex w-full items-center justify-center gap-2.5 rounded-full border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-deliivo-dark transition-colors hover:bg-gray-50"
                >
                  <FaApple className="h-4 w-4 shrink-0" />
                  Continue with Apple
                </button>
              </div>

              <p className="mt-6 text-center text-xs text-deliivo-gray">
                By signing up, you agree to our{" "}
                <Link href="/terms" className="underline hover:text-deliivo-orange">Terms</Link> and{" "}
                <Link href="/privacy" className="underline hover:text-deliivo-orange">Privacy Policy</Link>.
              </p>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-2xl font-bold tracking-tight text-deliivo-dark">
                Verify your {method}
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
                  {loading ? 'Verifying...' : 'Verify & Continue'}
                </button>
              </form>

              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { setStep('form'); setOtp(''); setError(''); setDevCode(null); }}
                  className="text-sm text-deliivo-gray hover:text-deliivo-dark"
                >
                  &larr; Back
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
            Already have an account?{" "}
            <Link href="/auth/signin" className="font-semibold text-deliivo-orange hover:text-deliivo-orange-dark transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
