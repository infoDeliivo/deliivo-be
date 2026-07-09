import { Request, Response } from 'express';
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { verifyLocalUploadToken } from '../../services/upload-token.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { logError } from '../../utils/logger.js';
import { TMP_PREFIX } from '../../services/s3.service.js';

/**
 * Dev-only direct-upload receiver used when STORAGE_PROVIDER=local. The client
 * PUTs raw bytes here using the HMAC-signed URL returned by the presign step.
 */
export const localUploadReceiver = async (req: Request, res: Response) => {
    try {
        const decoded = verifyLocalUploadToken(req.params.token as string);
        if (!decoded) {
            return sendError(res, { status: HttpStatus.UNAUTHORIZED, message: 'Invalid or expired upload token' });
        }

        const key = decoded.key;
        if (!key.startsWith(`${TMP_PREFIX}/`) || key.includes('..')) {
            return sendError(res, { status: HttpStatus.FORBIDDEN, message: 'Invalid upload key' });
        }

        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Empty upload body' });
        }

        const filePath = join(process.cwd(), key);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, body);

        return sendSuccess(res, { message: 'Uploaded' });
    } catch (error) {
        logError('localUploadReceiver error', error);
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Local upload failed' });
    }
};
