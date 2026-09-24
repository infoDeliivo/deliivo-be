/** `contact_change` is only issued by the authenticated add/change-contact flow, never by public auth routes. */
export type OtpPurpose = 'signup' | 'login' | 'reset_password' | 'contact_change';

export interface VerifyOtpResult {
  success: boolean;
  reason?: 'invalid_otp' | 'expired' | 'too_many_attempts';
}

export interface ResendOtpResult {
  success: boolean;
  otp?: string;
  reused?: boolean;
  reason?: 'cooldown' | 'limit_reached';
}
