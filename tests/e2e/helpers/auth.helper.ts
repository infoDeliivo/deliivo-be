import { api } from './api.client';
import { AccountState } from './state';

interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

interface SignupVerifyResult extends AuthTokens {
  user: { id: string; email?: string; phone?: string };
}

/**
 * Create a new user via email signup, verify with the OTP returned in the
 * response (requires EXPOSE_OTP_IN_RESPONSE=true on the server).
 */
export async function signupAndVerifyEmail(email: string): Promise<SignupVerifyResult> {
  const signupRes = await api.post('/auth/signup', { method: 'email', email });
  if (signupRes.status !== 201) {
    throw new Error(
      `Signup failed for ${email}: HTTP ${signupRes.status} — ${JSON.stringify(signupRes.data)}`
    );
  }

  const code: string = signupRes.data?.data?.code;
  if (!code) {
    throw new Error(
      'OTP code not returned in signup response. ' +
      'Ensure EXPOSE_OTP_IN_RESPONSE=true is set on the server.'
    );
  }

  const verifyRes = await api.post('/auth/otp/verify', {
    identifier: email,
    code,
    purpose: 'signup',
    method: 'email',
  });

  if (verifyRes.status !== 200) {
    throw new Error(
      `OTP verification failed for ${email}: HTTP ${verifyRes.status} — ${JSON.stringify(verifyRes.data)}`
    );
  }

  return {
    accessToken: verifyRes.data.data.accessToken,
    refreshToken: verifyRes.data.data.refreshToken,
    user: verifyRes.data.data.user,
  };
}

/**
 * Log in an existing verified user via email OTP.
 * Returns fresh tokens.
 */
export async function loginWithEmail(email: string): Promise<AuthTokens> {
  const loginRes = await api.post('/auth/login', { method: 'email', identifier: email });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed for ${email}: HTTP ${loginRes.status}`);
  }

  const code: string = loginRes.data?.data?.code;
  if (!code) {
    throw new Error('OTP code not returned in login response. Ensure EXPOSE_OTP_IN_RESPONSE=true.');
  }

  const verifyRes = await api.post('/auth/otp/verify', {
    identifier: email,
    code,
    purpose: 'login',
    method: 'email',
  });

  if (verifyRes.status !== 200) {
    throw new Error(`Login OTP verification failed for ${email}: HTTP ${verifyRes.status}`);
  }

  return {
    accessToken: verifyRes.data.data.accessToken,
    refreshToken: verifyRes.data.data.refreshToken,
  };
}

/**
 * Build an AccountState object from signup result.
 */
export function toAccountState(
  result: SignupVerifyResult,
  email: string
): Omit<AccountState, 'id'> & { id: string } {
  return {
    id: result.user.id,
    email,
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
  };
}
