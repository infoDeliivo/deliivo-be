import { Request, Response } from 'express';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import {
  signupService,
  verifyOtpService,
  refreshTokenService,
  logoutService,
  loginService,
  requestOtpService,
} from './auth.service.js';
import { sendMail } from '../mail/mail.service.js';
import {
  signupOtpTemplate,
  loginOtpTemplate,
  resetOtpTemplate,
} from '../mail/mail.templates.js';
import { createOtp, verifyOtp, resendOtp } from '../otp/otp.service.js';
import {
  sendSms,
  signupOtpSmsTemplate,
  loginOtpSmsTemplate,
  resetOtpSmsTemplate,
} from '../sms/index.js';

type OtpPurpose = 'signup' | 'login' | 'reset_password';

const shouldExposeOtp =
  process.env.NODE_ENV !== 'production' && process.env.EXPOSE_OTP_IN_RESPONSE === 'true';

const getOtpTemplateByPurpose = (purpose: OtpPurpose, code: string) => {
  if (purpose === 'signup') {
    return {
      mailSubject: 'Signup OTP',
      mailTemplate: signupOtpTemplate(code),
      smsTemplate: signupOtpSmsTemplate(code),
    };
  }

  if (purpose === 'login') {
    return {
      mailSubject: 'Login OTP',
      mailTemplate: loginOtpTemplate(code),
      smsTemplate: loginOtpSmsTemplate(code),
    };
  }

  return {
    mailSubject: 'Password Reset OTP',
    mailTemplate: resetOtpTemplate(code),
    smsTemplate: resetOtpSmsTemplate(code),
  };
};

export const signup = async (req: Request, res: Response) => {
  try {
    const { method, email, phone } = req.body as {
      method: 'email' | 'phone';
      email?: string;
      phone?: string;
    };
    const identifier = method === 'email' ? email : phone;

    if (!identifier) {
      return sendError(res, {
        message: 'Identifier is required',
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const result = await signupService(method, identifier);
    if (result.success === false) {
      return sendError(res, {
        message: result.reason || 'Failed to create user',
        status: HttpStatus.CONFLICT,
      });
    }

    const { code, success, reason } = await createOtp(identifier, 'signup', method);

    if (success === false || code === undefined || code === null) {
      return sendError(res, {
        message: reason || 'Failed to generate OTP',
        status: HttpStatus.INTERNAL_ERROR,
      });
    }

    if (method === 'email') {
      await sendMail({
        to: identifier,
        subject: 'Signup OTP',
        html: signupOtpTemplate(code),
      });
    } else if (method === 'phone') {
      const smsResult = await sendSms(identifier, signupOtpSmsTemplate(code));
      if (!smsResult.success) {
        return sendError(res, {
          message: smsResult.error || 'Failed to queue OTP SMS',
          status: HttpStatus.INTERNAL_ERROR,
        });
      }
    }

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Signup successful, verify OTP',
      data: {
        next: 'verify_otp',
        ...(shouldExposeOtp && { code }),
      },
    });
  } catch (err: any) {
    if (err.message === 'USER_EXISTS') {
      return sendError(res, {
        status: HttpStatus.CONFLICT,
        message: 'User already exists',
      });
    }

    return sendError(res, { message: err.message || 'Server error' });
  }
};
export const requestOtp = async (req: Request, res: Response) => {
  try {
    const { method, identifier, purpose } = req.body as {
      method: 'email' | 'phone';
      identifier: string;
      purpose: OtpPurpose;
    };

    const { user, success } = await requestOtpService(identifier, purpose, method);
    if (!success) {
      return sendError(res, {
        status: HttpStatus.CONFLICT,
        message: 'User already exists',
      });
    }
    const otp = await createOtp(identifier, purpose, method);

    if (otp.success === false || otp.code === undefined || otp.code === null) {
      return sendError(res, { message: otp.reason || 'Failed to generate OTP' });
    }

    const code = otp.code;
    const template = getOtpTemplateByPurpose(purpose, code);

    if (method === 'email') {
      await sendMail({
        to: identifier,
        subject: template.mailSubject,
        html: template.mailTemplate,
      });
    } else if (method === 'phone') {
      const smsResult = await sendSms(identifier, template.smsTemplate);
      if (!smsResult.success) {
        return sendError(res, {
          message: smsResult.error || 'Failed to queue OTP SMS',
          status: HttpStatus.INTERNAL_ERROR,
        });
      }
    }

    return sendSuccess(res, {
      message: 'OTP sent successfully',
      data: {
        next: 'verify_otp',
        ...(shouldExposeOtp && { code }),
      },
    });
  } catch (err) {
    console.error('Request OTP error:', err);
    return sendError(res, { message: 'Server error' });
  }
};
export const verifyOtpCont = async (req: Request, res: Response) => {
  try {
    const { identifier, code, purpose, method } = req.body as {
      identifier: string;
      code: string;
      purpose: OtpPurpose;
      method: 'email' | 'phone';
    };

    const verifyResult = await verifyOtp(identifier, purpose, code, method);

    if (!verifyResult.success) {
      let errorMessage: string;
      if (verifyResult.reason === 'expired') {
        errorMessage = 'OTP expired';
      } else if (verifyResult.reason === 'too_many_attempts') {
        errorMessage = 'Too many wrong attempts';
      } else {
        errorMessage = 'Invalid OTP';
      }
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: errorMessage,
      });
    }
    const result = await verifyOtpService(identifier, code, purpose, method);
    if ('success' in result && !result.success) {
      return sendError(res, {
        status: HttpStatus.BAD_REQUEST,
        message: 'Invalid or expired OTP',
      });
    }

    if ('tokens' in result && result.user && result.success) {
      return sendSuccess(res, {
        message: 'Verification successful',
        data: {
          ...result.tokens,
          user: {
            id: result.user.id,
            email: result.user.email,
            role: 'USER',
          },
          next: result.next,
        },
      });
    }

    return sendError(res, { message: 'Server error' });
  } catch {
    return sendError(res, { message: 'Server error' });
  }
};
export const login = async (req: Request, res: Response) => {
  try {
    const { method, identifier } = req.body as {
      method: 'email' | 'phone';
      identifier: string;
    };
    if (method !== 'email' && method !== 'phone') {
      return res.status(400).json({ message: 'Invalid login request' });
    }

    const { user } = await loginService(method, identifier);
    if (!user) {
      return sendError(res, {
        status: HttpStatus.NOT_FOUND,
        message: 'User not found',
      });
    }
    if (!user.isVerified) {
      return sendError(res, {
        status: HttpStatus.FORBIDDEN,
        message: 'User not verified',
      });
    }
    const otp = await createOtp(identifier, 'login', method);

    if (otp.success === false || otp.code === undefined || otp.code === null) {
      return sendError(res, { message: otp.reason || 'Failed to generate OTP' });
    }

    const code = otp.code;

    if (method === 'email') {
      await sendMail({
        to: identifier,
        subject: 'Login OTP',
        html: loginOtpTemplate(code),
      });
    } else if (method === 'phone') {
      const smsResult = await sendSms(identifier, loginOtpSmsTemplate(code));
      if (!smsResult.success) {
        return sendError(res, {
          message: smsResult.error || 'Failed to queue OTP SMS',
          status: HttpStatus.INTERNAL_ERROR,
        });
      }
    }

    return sendSuccess(res, {
      message: 'OTP sent for login',
      data: {
        next: 'verify_otp',
        ...(shouldExposeOtp && { code }),
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    return sendError(res, { message: 'Server error' });
  }
};

export const refreshToken = async (req: Request, res: Response) => {
  try {
    const tokens = await refreshTokenService(req.body.refreshToken);
    if (!tokens.success) {
      return sendError(res, {
        status: HttpStatus.UNAUTHORIZED,
        message: tokens.reason || 'Invalid refresh token',
      });
    }
    return sendSuccess(res, { data: tokens.tokens });
  } catch (err) {
    console.error('Refresh token error:', err);
    return sendError(res, {
      status: HttpStatus.UNAUTHORIZED,
      message: 'Invalid refresh token',
    });
  }
};

export const resendOtpCont = async (req: Request, res: Response) => {
  try {
    const { identifier, purpose, method } = req.body as {
      identifier: string;
      purpose: OtpPurpose;
      method: 'email' | 'phone';
    };
    const resendOtpResult = await resendOtp(identifier, purpose, method);
    if (!resendOtpResult.success) {
      let errorMessage: string;
      if (resendOtpResult.reason === 'cooldown') {
        errorMessage = 'Please wait before requesting another OTP';
      } else {
        errorMessage = 'Unable to resend OTP';
      }
      return sendError(res, {
        status: HttpStatus.TOO_MANY_REQUESTS,
        message: errorMessage,
      });
    }

    const result = resendOtpResult;
    const template = getOtpTemplateByPurpose(purpose, result.otp);

    if (method === 'email') {
      await sendMail({
        to: identifier,
        subject: `Resend ${template.mailSubject}`,
        html: template.mailTemplate,
      });
    } else if (method === 'phone') {
      const smsResult = await sendSms(identifier, template.smsTemplate);
      if (!smsResult.success) {
        return sendError(res, {
          message: smsResult.error || 'Failed to queue OTP SMS',
          status: HttpStatus.INTERNAL_ERROR,
        });
      }
    }

    return sendSuccess(res, {
      message: result.reused ? 'OTP resent' : 'New OTP generated',
      status: HttpStatus.OK,
      data: {
        ...(shouldExposeOtp && { code: result.otp }),
      },
    });
  } catch {
    return sendError(res, { message: 'Server error' });
  }
};

export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = req.body;

  const result = await logoutService(refreshToken);
  if (!result.success) {
    return sendError(res, {
      status: HttpStatus.BAD_REQUEST,
      message: `Invalid refresh token: ${result.reason}`,
    });
  }
  return sendSuccess(res, { message: 'Logged out successfully' });
};
