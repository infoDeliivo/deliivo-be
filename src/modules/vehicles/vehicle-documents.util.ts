import { DocumentType } from '@prisma/client';
import {
    keyFromPublicUrl,
    promoteObject,
    PERMANENT_PREFIX,
} from '../../services/s3.service.js';
import { logError } from '../../utils/logger.js';

/**
 * Document types that must NEVER be publicly accessible. Stored as a private object
 * key (imageKey) and served only via short-lived signed URLs (GET /uploads/read).
 * VEHICLE_IMAGE is the rider-visible car photo and stays public.
 */
export const PRIVATE_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set([
    DocumentType.DRIVING_LICENSE,
    DocumentType.INSURANCE_DOCUMENT,
    DocumentType.VEHICLE_DOCUMENT,
]);

export const isPrivateDocumentType = (documentType: DocumentType): boolean =>
    PRIVATE_DOCUMENT_TYPES.has(documentType);

const PRIVATE_FOLDER = 'vehicle-documents';

const isPrivateKey = (key: string): boolean =>
    key.split('/')[1] === PRIVATE_FOLDER && key.split('/')[0] === PERMANENT_PREFIX;

// Canonical private key: uploads/vehicle-documents/<ownerId>/<file> — owner as the
// 3rd segment so GET /uploads/read authorizes (ownerIdFromKey).
const buildPrivateKey = (ownerId: string, sourceKey: string): string => {
    const filename = sourceKey.split('/').pop() ?? sourceKey;
    return `${PERMANENT_PREFIX}/${PRIVATE_FOLDER}/${ownerId}/${filename}`;
};

export type DocumentSource = { imageUrl?: string; imageKey?: string };

/**
 * Guarantee that a document is stored with the correct visibility, regardless of what
 * the client sent. Public types keep their public URL. Private types are forced to a
 * private object key: if the client passed a public URL (or a public-folder key), the
 * object is copied into the private folder (no public ACL) and the public original is
 * deleted, so a private document can never remain world-readable.
 *
 * Returns the source to persist: private types -> { imageKey }, public types -> { imageUrl }.
 */
export const normalizeDocumentSource = async (
    ownerId: string,
    documentType: DocumentType,
    source: DocumentSource,
): Promise<DocumentSource> => {
    if (!isPrivateDocumentType(documentType)) {
        // Public document (VEHICLE_IMAGE): keep the public URL as-is.
        return { imageUrl: source.imageUrl };
    }

    // Private document: resolve the current object key from whatever was provided.
    const currentKey = source.imageKey ?? (source.imageUrl ? keyFromPublicUrl(source.imageUrl) : null);
    if (!currentKey) {
        throw new Error('PRIVATE_DOCUMENT_KEY_UNRESOLVED');
    }

    // Already a private-folder key uploaded via the private target — nothing to move.
    if (isPrivateKey(currentKey)) {
        return { imageKey: currentKey };
    }

    // Client sent a public object for a private type — re-key it into the private folder.
    const privateKey = buildPrivateKey(ownerId, currentKey);
    try {
        await promoteObject(currentKey, privateKey, false); // copy private, delete public original
    } catch (error) {
        logError('normalizeDocumentSource: failed to re-key private document', error);
        throw new Error('PRIVATE_DOCUMENT_REKEY_FAILED');
    }
    return { imageKey: privateKey };
};
