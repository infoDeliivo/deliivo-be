import { VehicleType, DocumentType } from '@prisma/client';

/* ================= DRAFT DOCUMENT ================= */
// A draft document is either public (imageUrl, e.g. VEHICLE_IMAGE) or private
// (imageKey, e.g. DRIVING_LICENSE / INSURANCE_DOCUMENT). Exactly one is set.
export interface DraftDocument {
    documentType: DocumentType;
    imageUrl?: string;
    imageKey?: string;
}

/* ================= DRAFT VEHICLE (Redis) ================= */
export interface DraftVehicle {
    userId: string;
    step: number;
    createdAt: string;
    updatedAt: string;

    // Step 1 — License
    licenseCountry?: string;
    licenseNumber?: string;

    // Step 2 — Vehicle Details
    brand?: string;
    model_num?: string;
    model_name?: string;
    type?: VehicleType;
    color?: string;
    year?: number;

    // Step 3 — Documents (multiple)
    documents: DraftDocument[];
}

/* ================= VEHICLE RESPONSE ================= */
export interface VehicleDocumentResponse {
    id: string;
    documentType: DocumentType;
    // S3 object key. Private docs have no public URL — pass this to
    // GET /uploads/read?key=<previewKey> to obtain a short-lived signed view URL.
    previewKey: string | null;
    // Public URL for public documents; null for private documents (use previewKey).
    image: string | null;
    createdAt: Date;
}

/* ================= STEP INPUT TYPES ================= */
export interface LicenseInput {
    licenseCountry: string;
    licenseNumber: string;
}

export interface VehicleDetailsInput {
    brand: string;
    model_num: string;
    model_name: string;
    type: VehicleType;
    color: string;
    year: number;
}
