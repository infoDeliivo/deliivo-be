import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { HttpStatus, sendError, sendSuccess } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import {
    AdminUserArchiveError,
    AdminUserArchiveErrorCode,
    archiveUser as archiveUserService,
    purgeUser as purgeUserService,
    restoreUser as restoreUserService,
} from './admin-user-archive.service.js';
import { AdminArchiveUserInput, AdminPurgeUserInput } from './admin.validator.js';

const ERROR_RESPONSES: Record<AdminUserArchiveErrorCode, { status: HttpStatus; message: string }> = {
    USER_NOT_FOUND: { status: HttpStatus.NOT_FOUND, message: 'User not found' },
    CANNOT_ARCHIVE_ADMIN: { status: HttpStatus.FORBIDDEN, message: 'Cannot archive an admin account' },
    ALREADY_ARCHIVED: { status: HttpStatus.CONFLICT, message: 'User is already archived' },
    NOT_ARCHIVED: { status: HttpStatus.CONFLICT, message: 'User is not archived' },
    PURGE_CONFIRMATION_MISMATCH: { status: HttpStatus.BAD_REQUEST, message: "The phone or email you typed does not match this user" },
    PURGE_INCOMPLETE: { status: HttpStatus.INTERNAL_ERROR, message: 'The user was anonymised but permanent deletion did not finish' },
};

const handleError = (res: Response, error: unknown, fallback: string) => {
    if (error instanceof AdminUserArchiveError) {
        return sendError(res, ERROR_RESPONSES[error.code]);
    }
    logError(`[ADMIN] ${fallback}`, error);
    // cancelUserActivity refuses while a ride-request checkout is in flight; its message is
    // written for the person retrying, so pass it through.
    if (error instanceof Error && error.message.startsWith('A ride request payment is still being processed')) {
        return sendError(res, { status: HttpStatus.CONFLICT, message: error.message });
    }
    return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: fallback });
};

export const archiveUser = async (req: AuthRequest, res: Response) => {
    try {
        const { reason } = req.body as AdminArchiveUserInput;
        const result = await archiveUserService(req.user.id, req.params.id as string, reason);
        return sendSuccess(res, { message: 'User archived', data: result });
    } catch (error) {
        return handleError(res, error, 'Failed to archive user');
    }
};

export const restoreUser = async (req: AuthRequest, res: Response) => {
    try {
        const result = await restoreUserService(req.user.id, req.params.id as string);
        return sendSuccess(res, { message: 'User restored', data: result });
    } catch (error) {
        return handleError(res, error, 'Failed to restore user');
    }
};

export const purgeUser = async (req: AuthRequest, res: Response) => {
    try {
        const result = await purgeUserService(req.user.id, req.params.id as string, req.body as AdminPurgeUserInput);
        return sendSuccess(res, { message: 'User permanently deleted', data: result });
    } catch (error) {
        return handleError(res, error, 'Failed to permanently delete user');
    }
};
