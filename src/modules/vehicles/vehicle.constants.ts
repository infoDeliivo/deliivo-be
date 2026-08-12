import { DocumentType } from '@prisma/client';

/**
 * Countries whose drivers must supply the full document set before a vehicle can be
 * saved. `licenseCountry` is stored as an ISO 3166-1 alpha-2 code ('GB', 'EE'), so
 * membership is tested against the upper-cased value. Add a code here to extend the
 * requirement to another country — no other change is needed.
 */
export const DOCUMENT_REQUIRED_COUNTRIES: ReadonlySet<string> = new Set(['EE']);

/**
 * The documents a driver in a DOCUMENT_REQUIRED_COUNTRIES country must upload:
 * a front and rear photo of the car (public, rider-visible) plus the vehicle
 * registry document (private — see PRIVATE_DOCUMENT_TYPES).
 */
export const REQUIRED_DOCUMENT_TYPES: readonly DocumentType[] = [
    DocumentType.VEHICLE_IMAGE_FRONT,
    DocumentType.VEHICLE_IMAGE_BACK,
    DocumentType.VEHICLE_DOCUMENT,
    DocumentType.INSURANCE_DOCUMENT,
];

/**
 * Document types that hold the rider-visible primary car photo. VEHICLE_IMAGE is the
 * legacy single-photo type and is treated as the front photo; both persist to
 * `vehicle.imageUrl` rather than to a VehicleDocument row.
 */
export const PRIMARY_IMAGE_DOCUMENT_TYPES: ReadonlySet<DocumentType> = new Set([
    DocumentType.VEHICLE_IMAGE,
    DocumentType.VEHICLE_IMAGE_FRONT,
]);

export const isPrimaryImageDocumentType = (documentType: DocumentType): boolean =>
    PRIMARY_IMAGE_DOCUMENT_TYPES.has(documentType);

/**
 * Whether swapping the rider-facing car photo on an APPROVED vehicle returns it to the
 * review queue. Off by default: a driver re-cropping their photo would silently lose
 * publish eligibility and be blocked mid-flow on a checklist only an admin can clear,
 * while the abuse it would catch — approved with car A, photo swapped to car B — leaves
 * the plate and registry document (what riders and the registry actually bind to)
 * untouched. Plate, detail and KYC-document changes always re-queue regardless.
 */
export const REQUEUE_APPROVED_ON_PHOTO_CHANGE = false;

/** True when the country requires the full REQUIRED_DOCUMENT_TYPES set. */
export const requiresFullDocumentSet = (licenseCountry: string): boolean =>
    DOCUMENT_REQUIRED_COUNTRIES.has(licenseCountry.trim().toUpperCase());
