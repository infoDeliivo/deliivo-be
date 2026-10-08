import type { DlVerificationStatus, VehicleVerificationStatus } from '@prisma/client';

/**
 * Per-user verification summary for the admin users list. Everything here is derived
 * from rows already selected by `listUsers`, so the list stays a single query.
 */

export type AdminDlState = 'NONE' | Exclude<DlVerificationStatus, 'SUPERSEDED'>;
export type AdminVehicleState = 'NONE' | VehicleVerificationStatus;
export type AdminPayoutState = 'NOT_STARTED' | 'INCOMPLETE' | 'READY';
export type AdminPendingKind = 'DL_REVIEW' | 'VEHICLE_REVIEW';

export interface AdminPendingItem {
    kind: AdminPendingKind;
    count: number;
}

export interface AdminUserVerificationSummary {
    dl: AdminDlState;
    vehicle: {
        state: AdminVehicleState;
        pending: number;
        approved: number;
        rejected: number;
    };
    payout: {
        state: AdminPayoutState;
        /** Stripe reported a name or date-of-birth that does not match the profile. */
        mismatch: boolean;
    };
    /** Items waiting on an admin decision; empty when nothing needs review. */
    pending: AdminPendingItem[];
}

export interface DlRecordInput {
    status: DlVerificationStatus;
    documentImageKey: string | null;
    updatedAt: Date;
}

export interface VehicleInput {
    verificationStatus: VehicleVerificationStatus;
}

export interface PayoutInput {
    stripeAccountId: string | null;
    stripeOnboardingComplete: boolean;
    stripeNameMatch: boolean | null;
    stripeDobMatch: boolean | null;
}

/** The latest settled-or-open DL record; superseded rows never describe the user's state. */
export const deriveDlState = (records: readonly DlRecordInput[]): AdminDlState => {
    let latest: DlRecordInput | null = null;
    for (const record of records) {
        if (record.status === 'SUPERSEDED') continue;
        if (!latest || record.updatedAt > latest.updatedAt) latest = record;
    }
    return latest ? (latest.status as Exclude<DlVerificationStatus, 'SUPERSEDED'>) : 'NONE';
};

/**
 * Callers pass only non-deleted vehicles. A pending vehicle outranks the others because
 * it is the one an admin has to act on.
 */
export const deriveVehicleState = (vehicles: readonly VehicleInput[]): AdminUserVerificationSummary['vehicle'] => {
    const counts = { pending: 0, approved: 0, rejected: 0 };
    for (const vehicle of vehicles) {
        if (vehicle.verificationStatus === 'PENDING') counts.pending += 1;
        else if (vehicle.verificationStatus === 'APPROVED') counts.approved += 1;
        else counts.rejected += 1;
    }
    const state: AdminVehicleState = counts.pending > 0
        ? 'PENDING'
        : counts.approved > 0
            ? 'APPROVED'
            : counts.rejected > 0
                ? 'REJECTED'
                : 'NONE';
    return { state, ...counts };
};

export const derivePayoutState = (user: PayoutInput): AdminUserVerificationSummary['payout'] => {
    const state: AdminPayoutState = !user.stripeAccountId
        ? 'NOT_STARTED'
        : user.stripeOnboardingComplete
            ? 'READY'
            : 'INCOMPLETE';
    return { state, mismatch: user.stripeNameMatch === false || user.stripeDobMatch === false };
};

/**
 * Same rules as the admin review queues: a DL row is reviewable only when it carries an
 * uploaded image (see `listDlReviewQueue`) — a Veriff session in PENDING is Veriff's
 * decision, not the admin's.
 */
export const derivePendingReview = (
    dlRecords: readonly DlRecordInput[],
    vehicles: readonly VehicleInput[],
): AdminPendingItem[] => {
    const pending: AdminPendingItem[] = [];
    const dlCount = dlRecords.filter((record) => record.status === 'PENDING' && record.documentImageKey !== null).length;
    if (dlCount > 0) pending.push({ kind: 'DL_REVIEW', count: dlCount });
    const vehicleCount = vehicles.filter((vehicle) => vehicle.verificationStatus === 'PENDING').length;
    if (vehicleCount > 0) pending.push({ kind: 'VEHICLE_REVIEW', count: vehicleCount });
    return pending;
};

export const buildVerificationSummary = (
    user: PayoutInput & { dlVerifications: readonly DlRecordInput[]; vehicles: readonly VehicleInput[] },
): AdminUserVerificationSummary => ({
    dl: deriveDlState(user.dlVerifications),
    vehicle: deriveVehicleState(user.vehicles),
    payout: derivePayoutState(user),
    pending: derivePendingReview(user.dlVerifications, user.vehicles),
});
