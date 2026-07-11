/**
 * Presigned-upload configuration. Single source of truth for allowed types,
 * size limits, and per-target folder/visibility/persistence behavior.
 */

export const UPLOAD_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
export const PRESIGN_TTL = 300; // seconds

export const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'] as const;

export type UploadTarget =
    | 'avatar'
    | 'vehicle_image'
    | 'vehicle_document'
    | 'chat_image'
    | 'vehicle_draft_document'
    | 'vehicle_draft_document_private';

export interface TargetConfig {
    folder: string;
    visibility: 'public' | 'private';
    needsVehicle: boolean;
    needsDocumentType: boolean;
}

export const TARGETS: Record<UploadTarget, TargetConfig> = {
    avatar: {
        folder: 'avatar',
        visibility: 'public',
        needsVehicle: false,
        needsDocumentType: false,
    },
    vehicle_image: {
        folder: 'vehicle',
        visibility: 'public',
        needsVehicle: true,
        needsDocumentType: false,
    },
    vehicle_document: {
        folder: 'vehicle-documents',
        visibility: 'private',
        needsVehicle: true,
        needsDocumentType: true,
    },
    // Public one-shot uploads: confirm promotes the object and returns { url, key };
    // the caller then attaches the URL via its own endpoint (chat send / draft save).
    chat_image: {
        folder: 'chat',
        visibility: 'public',
        needsVehicle: false,
        needsDocumentType: false,
    },
    vehicle_draft_document: {
        folder: 'vehicle',
        visibility: 'public',
        needsVehicle: false,
        needsDocumentType: false,
    },
    // Private one-shot draft upload for sensitive KYC documents (driving licence,
    // insurance). Confirm promotes the object to the private vehicle-documents/ folder
    // (no public ACL) and returns only { key }; the caller stores that key on the draft.
    // On draft save it becomes VehicleDocument.imageKey (served via GET /uploads/read).
    vehicle_draft_document_private: {
        folder: 'vehicle-documents',
        visibility: 'private',
        needsVehicle: false,
        needsDocumentType: false,
    },
};
