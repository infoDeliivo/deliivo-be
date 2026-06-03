import { Request, Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { logError, logWarn, logDebug } from '../../utils/logger.js';
import {
  createVeriffSession,
  handleWebhookDecision,
  validateWebhookSignature,
  getVerificationStatus,
} from './dl-verification.service.js';

// ─── POST / — Create Veriff session (protected) ───────────────────
export const createSession = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const {
      firstName,
      lastName,
      email,
      phoneNumber,
      dateOfBirth,
      gender,
      idNumber,
      fullName,
      documentNumber,
      documentCountry,
      documentValidFrom,
      documentValidUntil,
      fullAddress,
      callback,
      endUserId,
      consents,
      tag,
    } = req.body;

    const result = await createVeriffSession({
      userId,
      firstName,
      lastName,
      email,
      phoneNumber,
      dateOfBirth,
      gender,
      idNumber,
      fullName,
      documentNumber,
      documentCountry,
      documentValidFrom,
      documentValidUntil,
      fullAddress,
      callback,
      endUserId,
      consents,
      tag,
    });

    if (!result.success) {
      const statusCode =
        result.reason === 'ALREADY_VERIFIED' ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_ERROR;
      return sendError(res, {
        message: result.reason || 'Failed to create Veriff session',
        status: statusCode,
      });
    }

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Veriff session created successfully',
      data: result.data,
    });
  } catch (err: any) {
    logError('DL verification createSession error', err);
    return sendError(res, { message: err.message || 'Server error' });
  }
};

// ─── POST /webhook — Handle Veriff decision webhook (public) ──────
export const webhook = async (req: Request, res: Response) => {
  try {
    // Validate HMAC signature
    const signature = req.headers['x-hmac-signature'] as string;

    if (!signature) {
      return sendError(res, {
        message: 'Missing webhook signature',
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    const rawBody = JSON.stringify(req.body);
    const isValid = validateWebhookSignature(rawBody, signature);

    if (!isValid) {
      logWarn('Veriff webhook: invalid HMAC signature');
      return sendError(res, {
        message: 'Invalid webhook signature',
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    const result = await handleWebhookDecision(req.body);

    if (!result.success) {
      logWarn('Veriff webhook processing failed', { reason: result.reason });
      // Still return 200 to prevent Veriff from retrying
      return res.status(200).json({ received: true, warning: result.reason });
    }

    return res.status(200).json({ received: true, status: result.status });
  } catch (err: any) {
    logError('Veriff webhook error', err);
    // Return 200 even on error to prevent Veriff retry loops
    return res.status(200).json({ received: true, error: 'Internal processing error' });
  }
};

// ─── GET /status — Get DL verification status (protected) ─────────
export const status = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;

    const result = await getVerificationStatus(userId);

    return sendSuccess(res, {
      message: 'DL verification status retrieved',
      data: result.data,
    });
  } catch (err: any) {
    logError('DL verification getStatus error', err);
    return sendError(res, { message: err.message || 'Server error' });
  }
};
