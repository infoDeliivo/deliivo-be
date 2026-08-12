import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import {
  submitDlDocument,
  listDlReviewQueue,
  approveDlDocument,
  declineDlDocument,
  requestDlResubmission,
} from './dl-review.service.js';
import type { SubmitDlDocumentInput, DeclineDlInput, ResubmitDlInput } from './dl-verification.validator.js';
import type { DlVerificationStatus } from '@prisma/client';

const STATUS_BY_CODE: Record<string, HttpStatus> = {
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  DL_SUBMISSION_NOT_FOUND: HttpStatus.NOT_FOUND,
  DL_DOCUMENT_MISSING: HttpStatus.BAD_REQUEST,
  ALREADY_VERIFIED: HttpStatus.CONFLICT,
  DL_SUBMISSION_SUPERSEDED: HttpStatus.CONFLICT,
  DL_VERIFIED_ELSEWHERE: HttpStatus.CONFLICT,
};

const MESSAGE_BY_CODE: Record<string, string> = {
  USER_NOT_FOUND: 'User not found',
  DL_SUBMISSION_NOT_FOUND: 'No licence submission found for this user',
  DL_DOCUMENT_MISSING: 'This submission has no licence image to review',
  ALREADY_VERIFIED: 'This driving licence is already verified',
  DL_SUBMISSION_SUPERSEDED:
    'This submission was closed because the driver verified through Veriff — reload the queue',
  DL_VERIFIED_ELSEWHERE:
    'This driver is already verified through Veriff, so this submission cannot be decided',
};

/** Maps the service's thrown codes onto HTTP, falling back to a 500. */
const fail = (res: Response, error: unknown, fallback: string) => {
  const code = error instanceof Error ? error.message : '';
  if (STATUS_BY_CODE[code]) {
    return sendError(res, { status: STATUS_BY_CODE[code], message: MESSAGE_BY_CODE[code] });
  }
  logError(fallback, error);
  return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: fallback });
};

// ─── POST /dl-verification/document — driver submits a licence photo ───
export const submitDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { documentImageKey } = req.body as SubmitDlDocumentInput;
    const record = await submitDlDocument(req.user.id, documentImageKey);

    return sendSuccess(res, {
      status: HttpStatus.CREATED,
      message: 'Driving licence submitted for review',
      data: { record },
    });
  } catch (error: unknown) {
    return fail(res, error, 'Failed to submit driving licence');
  }
};

// ─── GET /admin/dl-verifications — the review queue ────────────────────
export const listQueue = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as DlVerificationStatus | undefined;
    const result = await listDlReviewQueue({
      // 'ALL' is the absence of a filter, not a value the query understands.
      status: status && status !== ('ALL' as DlVerificationStatus) ? status : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    return sendSuccess(res, { message: 'Licence review queue fetched', data: result });
  } catch (error: unknown) {
    return fail(res, error, 'Failed to fetch the licence review queue');
  }
};

// ─── POST /admin/dl-verifications/:userId/approve ──────────────────────
export const approve = async (req: AuthRequest, res: Response) => {
  try {
    const result = await approveDlDocument(req.params.userId as string, req.user?.id ?? null);
    return sendSuccess(res, { message: 'Driving licence approved', data: result });
  } catch (error: unknown) {
    return fail(res, error, 'Failed to approve the driving licence');
  }
};

// ─── POST /admin/dl-verifications/:userId/decline ──────────────────────
export const decline = async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body as DeclineDlInput;
    const result = await declineDlDocument(
      req.params.userId as string,
      reason,
      req.user?.id ?? null,
    );
    return sendSuccess(res, { message: 'Driving licence declined', data: result });
  } catch (error: unknown) {
    return fail(res, error, 'Failed to decline the driving licence');
  }
};

export const requestResubmission = async (req: AuthRequest, res: Response) => {
  try {
    const { reason } = req.body as ResubmitDlInput;
    const result = await requestDlResubmission(
      req.params.userId as string,
      reason,
      req.user?.id ?? null,
    );
    return sendSuccess(res, { message: 'Driving licence resubmission requested', data: result });
  } catch (error: unknown) {
    return fail(res, error, 'Failed to request driving licence resubmission');
  }
};
