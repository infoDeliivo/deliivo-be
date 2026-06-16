import redis from '../../cache/redis.js';
import { prisma } from '../../config/index.js';
import {
    DraftVehicle,
    DraftDocument,
    LicenseInput,
    VehicleDetailsInput,
} from './vehicle.types.js';
import { DocumentType } from '@prisma/client';

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

const DRAFT_TTL = 300; // 5 minutes

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
    imageUrl: string,
    documentType: DocumentType,
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

    const doc: DraftDocument = { imageUrl, documentType };

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

    // Use first VEHICLE_IMAGE as the main imageUrl, fallback to first doc
    const vehicleImage = draft.documents?.find(
        (d) => d.documentType === 'VEHICLE_IMAGE',
    );
    const mainImageUrl = vehicleImage?.imageUrl || draft.documents?.[0]?.imageUrl || null;

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
            isVerified: shouldAutoVerifyVehicle(),
            documents: {
                create: (draft.documents || []).map((doc) => ({
                    imageUrl: doc.imageUrl,
                    documentType: doc.documentType,
                })),
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
