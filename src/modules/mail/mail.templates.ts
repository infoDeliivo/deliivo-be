export const loginOtpTemplate = (otp: string) => `
  <div style="font-family: Arial, sans-serif; padding: 20px">
    <h2>Login Verification</h2>
    <p>Use the OTP below to login:</p>

    <h1 style="letter-spacing: 6px">${otp}</h1>

    <p style="color: #555">
      This OTP is valid for <b>5 minutes</b>.  
      Do not share it with anyone.
    </p>
  </div>
`;

export const signupOtpTemplate = (otp: string) => `
  <div style="font-family: Arial, sans-serif; padding: 20px">
    <h2>Signup Verification</h2>
    <p>Verify your email using the OTP below:</p>

    <h1 style="letter-spacing: 6px">${otp}</h1>

    <p style="color: #555">
      This OTP is valid for <b>5 minutes</b>.
    </p>
  </div>
`;
export const contactVerifyOtpTemplate = (otp: string) => `
  <div style="font-family: Arial, sans-serif; padding: 20px">
    <h2>Email Verification</h2>
    <p>Use the OTP below to add this email address to your account:</p>

    <h1 style="letter-spacing: 6px">${otp}</h1>

    <p style="color: #555">
      This OTP is valid for <b>5 minutes</b>. If you did not request this, you can ignore this email.
    </p>
  </div>
`;
export const otpSuccessTemplate = (purpose: 'login' | 'signup') => `
  <div style="font-family: Arial, sans-serif; padding: 20px">
    <h2>${purpose === 'login' ? 'Login Successful' : 'Signup Successful'}</h2>

    <p>
      Your ${purpose === 'login' ? 'login' : 'account verification'} 
      was completed successfully.
    </p>

    <p style="color: #555">
      If this was not you, please contact support immediately.
    </p>
  </div>
`;

export const signupWelcomeTemplate = (name?: string) => `
  <div style="font-family: Arial, sans-serif; padding: 20px">
    <h2>Welcome ${name ?? 'to our platform'} 🎉</h2>

    <p>Your account has been successfully created.</p>

    <p>
      You can now login and complete your profile to get started.
    </p>

    <p style="margin-top: 20px">
      🚀 We’re excited to have you with us!
    </p>
  </div>
`;

export const resetOtpTemplate = (otp: string) => `
  <div style="font-family: Arial, sans-serif; padding: 20px">
    <h2>Password Reset Request</h2>

    <p>
      You requested to reset your password.  
      Use the OTP below to continue:
    </p>

    <h1 style="letter-spacing: 6px">${otp}</h1>

    <p style="color: #555">
      This OTP is valid for <b>5 minutes</b>.  
      If you did not request this, please ignore this email.
    </p>
  </div>
`;
