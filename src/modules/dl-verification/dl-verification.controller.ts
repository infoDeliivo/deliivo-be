import { Request, Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { logError, logWarn, logDebug } from '../../utils/logger.js';
import {
  createVeriffSession,
  registerVeriffSession,
  handleWebhookDecision,
  validateWebhookSignature,
  getVerificationStatus,
} from './dl-verification.service.js';
import type { RegisterSessionInput } from './dl-verification.validator.js';

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
      // PROFILE_INCOMPLETE and NAME_DOES_NOT_MATCH_PROFILE are the caller's to fix, so
      // they are 400s rather than a generic failure.
      const badRequest =
        result.reason === 'PROFILE_INCOMPLETE' ||
        result.reason === 'NAME_DOES_NOT_MATCH_PROFILE';
      const statusCode = badRequest
        ? HttpStatus.BAD_REQUEST
        : result.reason === 'ALREADY_VERIFIED'
          ? HttpStatus.CONFLICT
          : HttpStatus.INTERNAL_ERROR;
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

// ─── POST /register — Attach a browser-created session (protected) ─
export const registerSession = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user.id;
    const { sessionId, sessionUrl } = req.body as RegisterSessionInput;

    const result = await registerVeriffSession({ userId, sessionId, sessionUrl });

    if (!result.success) {
      const conflict =
        result.reason === 'ALREADY_VERIFIED' ||
        result.reason === 'SESSION_OWNED_BY_ANOTHER_USER';
      return sendError(res, {
        message: result.reason || 'Failed to register Veriff session',
        status: conflict ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_ERROR,
      });
    }

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Veriff session registered successfully',
      data: result.data,
    });
  } catch (err: unknown) {
    logError('DL verification registerSession error', err);
    return sendError(res, {
      message: err instanceof Error ? err.message : 'Server error',
    });
  }
};

// Veriff signs the bytes it sent, so the signature can only be checked against the
// raw body. This route is mounted with express.raw() before express.json(); a body
// that is not a Buffer means that ordering was broken and the digest would be
// computed over a re-serialisation instead.
const getRawBody = (req: Request): Buffer | null =>
  Buffer.isBuffer(req.body) ? req.body : null;

const parseWebhookBody = (raw: Buffer): unknown => {
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return null;
  }
};

// ─── POST /webhook — Handle Veriff decision webhook (public) ──────
export const webhook = async (req: Request, res: Response) => {
  try {
    // Validate HMAC signature
    const headerSignature = req.headers['x-hmac-signature'];
    const signature = Array.isArray(headerSignature) ? headerSignature[0] : headerSignature;

    if (!signature) {
      return sendError(res, {
        message: 'Missing webhook signature',
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    const rawBody = getRawBody(req);

    if (!rawBody) {
      logError('Veriff webhook: raw body unavailable — check the express.raw() mount order');
      return sendError(res, {
        message: 'Invalid webhook payload',
        status: HttpStatus.BAD_REQUEST,
      });
    }

    const isValid = validateWebhookSignature(rawBody, signature);

    if (!isValid) {
      logWarn('Veriff webhook: invalid HMAC signature');
      return sendError(res, {
        message: 'Invalid webhook signature',
        status: HttpStatus.UNAUTHORIZED,
      });
    }

    const body = parseWebhookBody(rawBody);

    if (body === null || typeof body !== 'object') {
      logWarn('Veriff webhook: signed payload is not valid JSON');
      return res.status(200).json({ received: true, warning: 'INVALID_PAYLOAD' });
    }

    const result = await handleWebhookDecision(body);

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
