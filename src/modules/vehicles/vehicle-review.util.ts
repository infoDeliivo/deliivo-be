import { DocumentType, Prisma, VehicleVerificationStatus } from '@prisma/client';
import { REQUEUE_APPROVED_ON_PHOTO_CHANGE } from './vehicle.constants.js';

/**
 * The kind of driver edit being applied to an already-persisted vehicle. Which edits
 * invalidate an admin's decision depends on what that decision was based on, so the
 * caller names the change rather than the util guessing from a field diff.
 */
export type VehicleChangeKind =
    | 'LICENSE_PLATE'
    | 'VEHICLE_DETAILS'
    | 'KYC_DOCUMENT'
    | 'PRIMARY_PHOTO';

/**
 * The exact field set that returns a vehicle to the admin review queue. Spread into the
 * same `vehicle.update` as the edit itself so the status change and the edit land in one
 * write and cannot diverge.
 */
export type ReviewResetFields = Pick<
    Prisma.VehicleUncheckedUpdateInput,
    'isVerified' | 'verificationStatus' | 'rejectionReason' | 'reviewedAt' | 'reviewedById'
>;

const REVIEW_RESET: ReviewResetFields = {
    isVerified: false,
    verificationStatus: VehicleVerificationStatus.PENDING,
    rejectionReason: null,
    reviewedAt: null,
    reviewedById: null,
};

/**
 * Maps a document being added or removed to the change it represents. Car photos are
 * rider-facing decoration; every other type is material to the review. Removal is graded
 * the same as addition — losing the registry document invalidates the decision exactly as
 * replacing it does.
 */
export const changeKindForDocumentType = (documentType: DocumentType): VehicleChangeKind => {
    switch (documentType) {
        case DocumentType.VEHICLE_IMAGE:
        case DocumentType.VEHICLE_IMAGE_FRONT:
        case DocumentType.VEHICLE_IMAGE_BACK:
            return 'PRIMARY_PHOTO';
        default:
            return 'KYC_DOCUMENT';
    }
};

/**
 * Decides whether a driver edit returns the vehicle to the queue.
 *
 * - REJECTED → always re-queues. This is the resubmission loop: without it a rejected
 *   driver who fixes the problem stays rejected forever and can never publish.
 * - PENDING → returns null. Already queued; re-writing the same status would churn the
 *   row and reset nothing meaningful.
 * - APPROVED → re-queues for changes that invalidate what the admin actually verified
 *   (plate, vehicle details, registry/licence documents), but not for swapping the
 *   rider-facing car photo. See REQUEUE_APPROVED_ON_PHOTO_CHANGE for the rationale.
 *
 * Returns null rather than an empty object so callers can spread `...(reset ?? {})`
 * without emitting a no-op write.
 */
export const buildReviewReset = (
    current: VehicleVerificationStatus,
    change: VehicleChangeKind,
): ReviewResetFields | null => {
    if (current === VehicleVerificationStatus.REJECTED) {
        return { ...REVIEW_RESET };
    }

    if (current === VehicleVerificationStatus.PENDING) {
        return null;
    }

    if (change === 'PRIMARY_PHOTO' && !REQUEUE_APPROVED_ON_PHOTO_CHANGE) {
        return null;
    }

    return { ...REVIEW_RESET };
};
