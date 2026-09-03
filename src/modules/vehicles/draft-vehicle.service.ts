import redis from '../../cache/redis.js';
import { prisma } from '../../config/index.js';
import {
    DraftVehicle,
    DraftDocument,
    LicenseInput,
    VehicleDetailsInput,
} from './vehicle.types.js';
import { DocumentType, VehicleVerificationStatus } from '@prisma/client';
import { isPrivateDocumentType } from './vehicle-documents.util.js';
import { headObject, keyFromPublicUrl } from '../../services/s3.service.js';
import { logError, logInfo } from '../../utils/logger.js';
import { hasDlDocumentOnFile } from '../dl-verification/dl-review.service.js';
import {
    REQUIRED_DOCUMENT_TYPES,
    isPrimaryImageDocumentType,
    requiresFullDocumentSet,
} from './vehicle.constants.js';

// ============================================================
//  DRAFT RESPONSE HELPER (strip step/userId, add next)
// ============================================================

const NEXT_STEP: Record<number, string> = {
    1: 'vehicle-details',
    2: 'upload-document',
    3: 'save',
};

export const formatDraftResponse = (draft: DraftVehicle) => {
    const { userId, step, ...rest } = draft;
    return {
        ...rest,
        next: NEXT_STEP[step] || null,
    };
};

// ============================================================
//  CONSTANTS
// ============================================================

// Long enough for a driver to photograph five documents on a phone. At 5 minutes the
// draft expired between two uploads and the flow died with DRAFT_NOT_FOUND. Every write
// refreshes the TTL, so this only bounds the idle gap between steps.
const DRAFT_TTL = 30 * 60; // 30 minutes

// ============================================================
//  CACHE KEY HELPER
// ============================================================

const draftKey = (userId: string) => `vehicleDraft:${userId}`;

// ============================================================
//  INTERNAL: READ / WRITE DRAFT
// ============================================================

/**
 * Get the user's vehicle draft from Redis. Throws if not found.
 */
const getDraft = async (userId: string): Promise<DraftVehicle> => {
    const key = draftKey(userId);
    const data = await redis.get(key);
    if (!data) {
        throw new Error('DRAFT_NOT_FOUND');
    }
    return JSON.parse(data) as DraftVehicle;
};

/**
 * Save (create/update) draft to Redis with TTL refresh.
 */
const saveDraft = async (draft: DraftVehicle): Promise<DraftVehicle> => {
    const key = draftKey(draft.userId);
    draft.updatedAt = new Date().toISOString();
    await redis.setex(key, DRAFT_TTL, JSON.stringify(draft));
    return draft;
};

// ============================================================
//  STEP 1: CREATE WITH LICENSE (clears any old draft)
// ============================================================

export const createWithLicense = async (
    userId: string,
    input: LicenseInput,
): Promise<DraftVehicle> => {
    // Delete any existing draft for this user
    await redis.del(draftKey(userId));

    const draft: DraftVehicle = {
        userId,
        step: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        licenseCountry: input.licenseCountry,
        licenseNumber: input.licenseNumber,
        documents: [],
    };

    return saveDraft(draft);
};

// ============================================================
//  STEP 2: UPDATE VEHICLE DETAILS (brand, model, type, color, year)
// ============================================================

export const updateVehicleDetails = async (
    userId: string,
    input: VehicleDetailsInput,
): Promise<DraftVehicle> => {
    const draft = await getDraft(userId);
    draft.brand = input.brand;
    draft.model_num = input.model_num;
    draft.model_name = input.model_name;
    draft.type = input.type;
    draft.color = input.color;
    draft.year = input.year;
    draft.step = Math.max(draft.step, 2);
    return saveDraft(draft);
};

// ============================================================
//  STEP 3: ADD / UPDATE DOCUMENT (upload image URL + type)
// ============================================================

export const addDocument = async (
    userId: string,
    documentType: DocumentType,
    source: { imageUrl?: string; imageKey?: string },
): Promise<DraftVehicle> => {
    const draft = await getDraft(userId);

    // Initialize documents array if missing (backward compat)
    if (!draft.documents) {
        draft.documents = [];
    }

    // Replace if same documentType already exists, otherwise add
    const existingIdx = draft.documents.findIndex(
        (d) => d.documentType === documentType,
    );

    // Public docs carry imageUrl; private KYC docs carry imageKey.
    const doc: DraftDocument = {
        documentType,
        imageUrl: source.imageUrl,
        imageKey: source.imageKey,
    };

    if (existingIdx >= 0) {
        draft.documents[existingIdx] = doc;
    } else {
        draft.documents.push(doc);
    }

    draft.step = Math.max(draft.step, 3);
    return saveDraft(draft);
};

// ============================================================
//  SAVE VEHICLE — Move from Redis → DB
// ============================================================

const MAX_VEHICLES_PER_USER = 1;

/**
 * Confirm every document on the draft actually exists in storage.
 *
 * Uploading is four calls (presign -> PUT -> confirm -> attach). If the client dies
 * between the PUT and the confirm, the object stays under tmp/ and the lifecycle rule
 * deletes it, yet the draft can still carry the document if a later attach succeeded —
 * producing a saved vehicle whose image URL points at nothing. This is the last place
 * that can catch it before the vehicle reaches the database.
 *
 * Only a definitive 404 counts as missing. headObject throws on any other storage error
 * (and always in local-disk mode, where there is no bucket), and a storage blip must not
 * block a driver from saving a vehicle whose documents are fine.
 */
const findMissingDocumentObjects = async (documents: DraftDocument[]): Promise<DocumentType[]> => {
    const missing: DocumentType[] = [];

    for (const doc of documents) {
        const key = doc.imageKey || (doc.imageUrl ? keyFromPublicUrl(doc.imageUrl) : null);
        if (!key) continue; // Nothing to check against — the draft holds no locator.
        try {
            const head = await headObject(key);
            if (!head.exists) missing.push(doc.documentType);
        } catch (error) {
            logError('Could not verify draft document object; allowing save', error, {
                documentType: doc.documentType,
                key,
            });
        }
    }

    return missing;
};

const shouldAutoVerifyVehicle = () => process.env.SKIP_VEHICLE_VERIFICATION === 'true';

export const saveVehicle = async (userId: string) => {
    const draft = await getDraft(userId);

    // ---- Validation ---- //
    if (!draft.licenseCountry || !draft.licenseNumber) {
        throw new Error('LICENSE_REQUIRED');
    }

    // Check user exists
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
        throw new Error('USER_NOT_FOUND');
    }

    // Check vehicle limit
    const count = await prisma.vehicle.count({
        where: { userId, deletedAt: null },
    });

    if (count >= MAX_VEHICLES_PER_USER) {
        throw new Error('MAX_VEHICLE_LIMIT_REACHED');
    }

    // Countries that mandate the full document set (front photo, rear photo, registry)
    // must supply all of it before the vehicle reaches the admin review queue.
    if (requiresFullDocumentSet(draft.licenseCountry)) {
        const supplied = new Set((draft.documents || []).map((d) => d.documentType));
        const missing = REQUIRED_DOCUMENT_TYPES.filter((type) => !supplied.has(type));
        if (missing.length > 0) {
            throw new Error(`VEHICLE_DOCUMENTS_REQUIRED:${missing.join(',')}`);
        }

        // The driving licence belongs to the person, not the car: it is checked
        // against the user, not this draft, so a second vehicle does not ask for it
        // again. An already-verified driver (Veriff or manual) needs no image.
        if (!user.dlVerified && !(await hasDlDocumentOnFile(userId))) {
            throw new Error('DL_DOCUMENT_REQUIRED');
        }
    }

    // Supporting identity/insurance documents must never become rider-visible photos.
    const vehicleImage = draft.documents?.find((d) =>
        isPrimaryImageDocumentType(d.documentType),
    );
    const mainImageUrl = vehicleImage?.imageUrl || null;

    const missingObjects = await findMissingDocumentObjects(draft.documents || []);
    if (missingObjects.length > 0) {
        logInfo('Blocking vehicle save: draft documents missing from storage', {
            userId,
            missing: missingObjects,
        });
        throw new Error(`VEHICLE_DOCUMENT_MISSING:${missingObjects.join(',')}`);
    }

    // A vehicle starts PENDING and waits for an admin decision, unless the dev bypass
    // flag auto-approves it.
    const autoApproved = shouldAutoVerifyVehicle();

    // ---- Create in DB (vehicle + documents in a transaction) ---- //
    const vehicle = await prisma.vehicle.create({
        data: {
            userId,
            licenseCountry: draft.licenseCountry,
            licenseNumber: draft.licenseNumber,
            brand: draft.brand || null,
            model_num: draft.model_num || null,
            model_name: draft.model_name || null,
            type: draft.type || null,
            color: draft.color || null,
            year: draft.year || null,
            imageUrl: mainImageUrl,
            isVerified: autoApproved,
            verificationStatus: autoApproved
                ? VehicleVerificationStatus.APPROVED
                : VehicleVerificationStatus.PENDING,
            reviewedAt: autoApproved ? new Date() : null,
            documents: {
                // The primary car photo (VEHICLE_IMAGE_FRONT, or legacy VEHICLE_IMAGE)
                // lives on vehicle.imageUrl above, not as a document row. Everything else
                // is persisted here — including the rear photo: private KYC docs persist
                // imageKey (no public URL, exposed as previewKey), public docs persist imageUrl.
                create: (draft.documents || [])
                    .filter((doc) => !isPrimaryImageDocumentType(doc.documentType))
                    .map((doc) => {
                        // Guard: a private-type document must never persist a public URL.
                        // Attach-time normalization already enforces this, but defend against
                        // stale drafts — private types keep only imageKey.
                        const priv = isPrivateDocumentType(doc.documentType);
                        return {
                            documentType: doc.documentType,
                            image: priv ? null : doc.imageUrl ?? null,
                            imageKey: doc.imageKey ?? null,
                        };
                    }),
            },
        },
        include: {
            documents: true,
        },
    });

    // ---- Cleanup: Remove draft from Redis ---- //
    await redis.del(draftKey(userId));

    return vehicle;
};
