import { Response } from 'express';
import { AuthRequest } from '../../types/auth.js';
import { sendSuccess, sendError, HttpStatus } from '../../utils/index.js';
import { logError, logInfo } from '../../utils/logger.js';
import {
    getPresignedUploadUrl,
    headObject,
    promoteObject,
    getPresignedDownloadUrl,
    deleteObject,
    buildPublicUrl,
    ownerIdFromKey,
    TMP_PREFIX,
    PERMANENT_PREFIX,
} from '../../services/s3.service.js';
import { deleteCache, cacheKeys } from '../../services/cache.service.js';
import * as VehicleService from '../vehicles/vehicle.service.js';
import { updateAvatarService, clearAvatarService } from '../user/user.service.js';
import {
    TARGETS,
    UploadTarget,
    PRESIGN_TTL,
    UPLOAD_MAX_SIZE,
    ALLOWED_CONTENT_TYPES,
} from './uploads.constants.js';

/**
 * Best-effort delete of the object a public image just replaced. A failure here must
 * never fail the request — the new object is already saved; the stale one is only cost.
 */
const reapPrevious = async (previousKey: string | undefined, newKey: string): Promise<void> => {
    if (!previousKey || previousKey === newKey) return;
    try {
        await deleteObject(previousKey);
    } catch (error) {
        logError('Failed to delete replaced upload object', error);
    }
};

/* ================= STEP 1: PRESIGN ================= */
export const getPresign = async (req: AuthRequest, res: Response) => {
    try {
        const { target, contentType, fileExtension, vehicleId } = req.body as {
            target: UploadTarget;
            contentType: string;
            fileExtension: string;
            vehicleId?: string;
        };
        const cfg = TARGETS[target];

        if (cfg.needsVehicle) {
            const owns = await VehicleService.userOwnsVehicle(req.user.id, vehicleId!);
            if (!owns) {
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Vehicle not found' });
            }
        }

        const { tmpKey, uploadUrl, expiresIn } = await getPresignedUploadUrl({
            folder: cfg.folder,
            ownerId: req.user.id,
            contentType,
            fileExtension,
            expiresIn: PRESIGN_TTL,
        });

        return sendSuccess(res, {
            status: HttpStatus.OK,
            message: 'Presigned upload URL generated',
            data: {
                key: tmpKey,
                uploadUrl,
                method: 'PUT',
                headers: { 'Content-Type': contentType },
                expiresIn,
            },
        });
    } catch (error) {
        logError('getPresign controller error', error);
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to generate upload URL' });
    }
};

/* ================= STEP 2: CONFIRM ================= */
export const confirmUpload = async (req: AuthRequest, res: Response) => {
    try {
        const { target, key, vehicleId, documentType } = req.body as {
            target: UploadTarget;
            key: string;
            vehicleId?: string;
            documentType?: any;
        };
        const cfg = TARGETS[target];

        // 1. Ownership: the staged key must belong to this caller + target folder.
        const expectedPrefix = `${TMP_PREFIX}/${cfg.folder}/${req.user.id}/`;
        if (!key.startsWith(expectedPrefix)) {
            return sendError(res, { status: HttpStatus.FORBIDDEN, message: 'Invalid upload key' });
        }

        // 2. Vehicle ownership for vehicle-scoped targets.
        if (cfg.needsVehicle) {
            const owns = await VehicleService.userOwnsVehicle(req.user.id, vehicleId!);
            if (!owns) {
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Vehicle not found' });
            }
        }

        // 3. Verify the object was actually uploaded, and validate type/size.
        const head = await headObject(key);
        if (!head.exists) {
            return sendError(res, {
                status: HttpStatus.BAD_REQUEST,
                message: 'Uploaded file not found. Upload to the presigned URL before confirming.',
            });
        }
        if (head.contentType && !(ALLOWED_CONTENT_TYPES as readonly string[]).includes(head.contentType)) {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'Unsupported file type' });
        }
        if (head.contentLength != null && head.contentLength > UPLOAD_MAX_SIZE) {
            return sendError(res, { status: HttpStatus.BAD_REQUEST, message: 'File exceeds the 5MB limit' });
        }

        // 4. Promote tmp/ → uploads/.
        const permanentKey = `${PERMANENT_PREFIX}${key.slice(TMP_PREFIX.length)}`;
        await promoteObject(key, permanentKey, TARGETS[target].visibility === 'public');

        // 5. Persist per target.
        if (target === 'avatar') {
            const url = buildPublicUrl(permanentKey);
            const result = await updateAvatarService(req.user.id, url, permanentKey);
            if (!result.success) {
                return sendError(res, { status: HttpStatus.BAD_REQUEST, message: result.reason || 'Unable to update avatar' });
            }
            await reapPrevious(result.previousKey, permanentKey);
            await Promise.all([
                deleteCache(cacheKeys.user(req.user.id)),
                deleteCache(cacheKeys.userProfile(req.user.id)),
                deleteCache(cacheKeys.publicProfile(req.user.id)),
            ]);
            return sendSuccess(res, { message: 'Avatar updated successfully', data: { avatarUrl: url } });
        }

        if (target === 'vehicle_image') {
            const url = buildPublicUrl(permanentKey);
            const result = await VehicleService.updateVehicle(req.user.id, vehicleId!, {
                imageUrl: url,
                imageKey: permanentKey,
            });
            if (!result.success) {
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: result.message });
            }
            await reapPrevious(result.previousImageKey, permanentKey);
            await Promise.all([
                deleteCache(cacheKeys.vehicle(vehicleId!)),
                deleteCache(cacheKeys.userVehicles(req.user.id)),
            ]);
            return sendSuccess(res, { message: 'Vehicle image updated successfully', data: { imageUrl: url } });
        }

        // Private one-shot draft upload (KYC docs). Promoted to the private folder with
        // no public ACL; return only the key. The caller stores it on the draft and it
        // becomes VehicleDocument.imageKey on save — never a public URL.
        if (target === 'vehicle_draft_document_private') {
            return sendSuccess(res, {
                message: 'Upload confirmed',
                data: { key: permanentKey },
            });
        }

        // Public one-shot targets: return the promoted URL; the caller attaches it via
        // its own endpoint (chat send-image / vehicle draft save). No owner record here.
        if (target === 'chat_image' || target === 'vehicle_draft_document') {
            const url = buildPublicUrl(permanentKey);
            return sendSuccess(res, {
                message: 'Upload confirmed',
                data: { url, key: permanentKey },
            });
        }

        // vehicle_document (private)
        const doc = await VehicleService.addVehicleDocument(req.user.id, vehicleId!, {
            imageKey: permanentKey,
            documentType,
        });
        // The list cache backs /profile/vehicle; leaving it stale hides the re-queued
        // review status this upload just triggered.
        await Promise.all([
            deleteCache(cacheKeys.vehicle(vehicleId!)),
            deleteCache(cacheKeys.userVehicles(req.user.id)),
        ]);
        return sendSuccess(res, {
            status: HttpStatus.CREATED,
            message: 'Document uploaded successfully',
            data: { documentId: doc.id, documentType: doc.documentType },
        });
    } catch (error: any) {
        logError('confirmUpload controller error', error);
        return sendError(res, {
            status: error.message === 'VEHICLE_NOT_FOUND' ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_ERROR,
            message: error.message === 'VEHICLE_NOT_FOUND' ? 'Vehicle not found' : 'Failed to confirm upload',
        });
    }
};

/* ================= READ (private targets → signed GET URL) ================= */
export const readUrl = async (req: AuthRequest, res: Response) => {
    try {
        const { key } = req.query as unknown as { key: string };

        // Authorize by the owner id embedded in the key. A user may only read objects
        // stored under their own owner segment. 404 (not 403) so we never confirm whether
        // someone else's key exists.
        //
        // Admins are exempt: reviewing a vehicle means opening the registry document,
        // which is stored privately under the driver's owner segment. Every such read is
        // logged so privileged access to private KYC documents stays auditable.
        const isOwner = ownerIdFromKey(key) === req.user.id;
        const isAdmin = req.user.role === 'ADMIN';

        if (!isOwner && !isAdmin) {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Document not found' });
        }

        if (!isOwner) {
            logInfo('[UPLOADS] admin read of private document', {
                adminId: req.user.id,
                ownerId: ownerIdFromKey(key),
                key,
            });
        }

        const url = await getPresignedDownloadUrl(key, PRESIGN_TTL);
        return sendSuccess(res, {
            message: 'Signed read URL generated',
            data: { url, expiresIn: PRESIGN_TTL },
        });
    } catch (error) {
        logError('readUrl controller error', error);
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to generate read URL' });
    }
};

/* ================= DELETE (remove a persisted image) ================= */
export const deleteUpload = async (req: AuthRequest, res: Response) => {
    try {
        const { target, vehicleId, key } = req.query as unknown as {
            target: 'avatar' | 'vehicle_image' | 'vehicle_document';
            vehicleId?: string;
            key?: string;
        };

        if (target === 'avatar') {
            const result = await clearAvatarService(req.user.id);
            if (!result.success) {
                return sendError(res, { status: HttpStatus.BAD_REQUEST, message: result.reason || 'Unable to remove avatar' });
            }
            await reapPrevious(result.previousKey, '');
            await Promise.all([
                deleteCache(cacheKeys.user(req.user.id)),
                deleteCache(cacheKeys.userProfile(req.user.id)),
                deleteCache(cacheKeys.publicProfile(req.user.id)),
            ]);
            return sendSuccess(res, { message: 'Avatar removed successfully' });
        }

        if (target === 'vehicle_image') {
            const result = await VehicleService.clearVehicleImage(req.user.id, vehicleId!);
            if (!result.success) {
                return sendError(res, { status: HttpStatus.NOT_FOUND, message: result.message });
            }
            await reapPrevious(result.previousImageKey, '');
            await Promise.all([
                deleteCache(cacheKeys.vehicle(vehicleId!)),
                deleteCache(cacheKeys.userVehicles(req.user.id)),
            ]);
            return sendSuccess(res, { message: 'Vehicle image removed successfully' });
        }

        // vehicle_document
        const doc = await VehicleService.deleteVehicleDocument(req.user.id, vehicleId!, key!);
        if (!doc) {
            return sendError(res, { status: HttpStatus.NOT_FOUND, message: 'Document not found' });
        }
        await reapPrevious(doc.imageKey ?? undefined, '');
        await Promise.all([
            deleteCache(cacheKeys.vehicle(vehicleId!)),
            deleteCache(cacheKeys.userVehicles(req.user.id)),
        ]);
        return sendSuccess(res, { message: 'Document removed successfully' });
    } catch (error) {
        logError('deleteUpload controller error', error);
        return sendError(res, { status: HttpStatus.INTERNAL_ERROR, message: 'Failed to delete upload' });
    }
};
