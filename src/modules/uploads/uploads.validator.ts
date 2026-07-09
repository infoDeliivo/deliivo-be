import { z } from 'zod';
import { DocumentType } from '@prisma/client';
import { ALLOWED_CONTENT_TYPES, ALLOWED_EXTENSIONS, TARGETS, UploadTarget } from './uploads.constants.js';

const targetEnum = z.enum([
    'avatar',
    'vehicle_image',
    'vehicle_document',
    'chat_image',
    'vehicle_draft_document',
]);

const requireTargetFields = (
    val: { target: UploadTarget; vehicleId?: string; documentType?: DocumentType },
    ctx: z.RefinementCtx,
) => {
    const cfg = TARGETS[val.target];
    if (cfg.needsVehicle && !val.vehicleId) {
        ctx.addIssue({ code: 'custom', path: ['vehicleId'], message: 'vehicleId is required for this target' });
    }
    if (cfg.needsDocumentType && !val.documentType) {
        ctx.addIssue({ code: 'custom', path: ['documentType'], message: 'documentType is required for vehicle_document' });
    }
};

export const presignSchema = z
    .object({
        target: targetEnum,
        contentType: z.enum(ALLOWED_CONTENT_TYPES),
        fileExtension: z.enum(ALLOWED_EXTENSIONS),
        vehicleId: z.string().uuid().optional(),
        documentType: z.nativeEnum(DocumentType).optional(),
    })
    .strict()
    .superRefine(requireTargetFields);

export const confirmSchema = z
    .object({
        target: targetEnum,
        key: z.string().min(1),
        vehicleId: z.string().uuid().optional(),
        documentType: z.nativeEnum(DocumentType).optional(),
    })
    .strict()
    .superRefine(requireTargetFields);

// Read is only meaningful for private targets (documents/driving-license).
export const readSchema = z
    .object({
        target: z.literal('vehicle_document'),
        key: z.string().min(1),
        vehicleId: z.string().uuid(),
    })
    .strict();

// Delete a persisted image. avatar/vehicle_image clear the owner field; vehicle_document
// removes the row (identified by key). chat_image/vehicle_draft_document are not persisted.
export const deleteSchema = z
    .object({
        target: z.enum(['avatar', 'vehicle_image', 'vehicle_document']),
        vehicleId: z.string().uuid().optional(),
        key: z.string().min(1).optional(),
    })
    .strict()
    .superRefine((val, ctx) => {
        if ((val.target === 'vehicle_image' || val.target === 'vehicle_document') && !val.vehicleId) {
            ctx.addIssue({ code: 'custom', path: ['vehicleId'], message: 'vehicleId is required for this target' });
        }
        if (val.target === 'vehicle_document' && !val.key) {
            ctx.addIssue({ code: 'custom', path: ['key'], message: 'key is required for vehicle_document' });
        }
    });
