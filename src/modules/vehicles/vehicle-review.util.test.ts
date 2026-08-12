import { DocumentType, VehicleVerificationStatus } from '@prisma/client';
import { buildReviewReset, changeKindForDocumentType, type VehicleChangeKind } from './vehicle-review.util.js';

const RESET = {
    isVerified: false,
    verificationStatus: VehicleVerificationStatus.PENDING,
    rejectionReason: null,
    reviewedAt: null,
    reviewedById: null,
};

const ALL_CHANGES: VehicleChangeKind[] = [
    'LICENSE_PLATE',
    'VEHICLE_DETAILS',
    'KYC_DOCUMENT',
    'PRIMARY_PHOTO',
];

describe('changeKindForDocumentType', () => {
    it.each([
        [DocumentType.VEHICLE_IMAGE, 'PRIMARY_PHOTO'],
        [DocumentType.VEHICLE_IMAGE_FRONT, 'PRIMARY_PHOTO'],
        [DocumentType.VEHICLE_IMAGE_BACK, 'PRIMARY_PHOTO'],
        [DocumentType.VEHICLE_DOCUMENT, 'KYC_DOCUMENT'],
        [DocumentType.DRIVING_LICENSE, 'KYC_DOCUMENT'],
        [DocumentType.INSURANCE_DOCUMENT, 'KYC_DOCUMENT'],
    ])('grades %s as %s', (documentType, expected) => {
        expect(changeKindForDocumentType(documentType)).toBe(expected);
    });
});

describe('buildReviewReset', () => {
    // The resubmission loop: without this a rejected driver who fixes the problem stays
    // rejected forever and can never publish.
    it.each(ALL_CHANGES)('re-queues a REJECTED vehicle on a %s change', (change) => {
        expect(buildReviewReset(VehicleVerificationStatus.REJECTED, change)).toEqual(RESET);
    });

    it.each(ALL_CHANGES)('leaves a PENDING vehicle alone on a %s change', (change) => {
        expect(buildReviewReset(VehicleVerificationStatus.PENDING, change)).toBeNull();
    });

    it.each<VehicleChangeKind>(['LICENSE_PLATE', 'VEHICLE_DETAILS', 'KYC_DOCUMENT'])(
        're-queues an APPROVED vehicle on a %s change',
        (change) => {
            expect(buildReviewReset(VehicleVerificationStatus.APPROVED, change)).toEqual(RESET);
        },
    );

    // Swapping the rider-facing photo would otherwise silently revoke publish eligibility
    // over a re-crop, while leaving the plate and registry document untouched.
    it('does not re-queue an APPROVED vehicle when only the primary photo changes', () => {
        expect(buildReviewReset(VehicleVerificationStatus.APPROVED, 'PRIMARY_PHOTO')).toBeNull();
    });

    it('returns a fresh object per call so callers cannot mutate shared state', () => {
        const first = buildReviewReset(VehicleVerificationStatus.REJECTED, 'KYC_DOCUMENT');
        const second = buildReviewReset(VehicleVerificationStatus.REJECTED, 'KYC_DOCUMENT');
        expect(first).not.toBe(second);
        expect(first).toEqual(second);
    });
});
