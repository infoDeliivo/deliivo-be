import { VehicleVerificationStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';

/**
 * Driver publish eligibility.
 *
 * Every requirement a driver must satisfy before a ride can go live is evaluated here,
 * in one place, so the gate at the start of the publish flow and the gate at the final
 * publish step can never drift apart.
 *
 * The flow is checked twice on purpose: once when the draft is created, so a driver is
 * not walked through twelve steps only to be rejected at the end, and once at publish,
 * because a licence can expire or a Connect account can be restricted while the draft is
 * still alive.
 */

/**
 * Three gates, one per thing the driver has to do: verify a licence, set up payouts, get a
 * vehicle on the road. Anything finer — which half of the licence check failed, whether the
 * vehicle is missing or merely unreviewed — is a reason code on one of these, not a gate of
 * its own. A driver reading the list should count the tasks left, not decode the model.
 */
export type PublishRequirementKey = 'DL_VERIFICATION' | 'BANK_ACCOUNT' | 'VEHICLE';

/**
 * Review state for an unsatisfied VEHICLE requirement. A reason code alone cannot carry the
 * admin's free-text rejection note, so the note travels alongside it.
 */
export interface VehicleVerificationContext {
    verificationStatus: VehicleVerificationStatus;
    rejectionReason: string | null;
}

export interface PublishRequirement {
    key: PublishRequirementKey;
    satisfied: boolean;
    /** True when an environment bypass flag disabled this gate. */
    skipped: boolean;
    /** Error code when unsatisfied, null otherwise. */
    reason: string | null;
    /** Where the app should send the driver to resolve it. */
    actionUrl: string | null;
    /** Set only on an unsatisfied VEHICLE that exists; absent everywhere else. */
    vehicle?: VehicleVerificationContext;
}

export interface PublishEligibility {
    eligible: boolean;
    requirements: PublishRequirement[];
}

/**
 * Bank onboarding is meaningless when payments are bypassed or Connect is mocked, and
 * the E2E suite runs in exactly that configuration.
 */
const skipBankCheck = (): boolean =>
    process.env.BOOKING_PAYMENT_MODE === 'bypass' ||
    process.env.STRIPE_CONNECT_MOCK_MODE === 'true';

const skipVehicleVerification = (): boolean =>
    process.env.SKIP_VEHICLE_VERIFICATION === 'true';

const requirement = (
    key: PublishRequirementKey,
    satisfied: boolean,
    reason: string,
    actionUrl: string | null,
    skipped = false,
): PublishRequirement => ({
    key,
    satisfied: skipped ? true : satisfied,
    skipped,
    reason: skipped || satisfied ? null : reason,
    actionUrl: skipped || satisfied ? null : actionUrl,
});

/**
 * Built inline rather than through `requirement()` because this gate covers a driver's whole
 * road to a usable vehicle — none added, one awaiting review, one an admin turned down — and
 * each step needs its own code and destination. Reporting them as two requirements told a
 * driver with no vehicle that it was both missing and unverified, which is one problem stated
 * twice.
 *
 * `skipped` only bypasses the admin approval half: a vehicle must always exist.
 */
const buildVehicleRequirement = (
    vehicle: { verificationStatus: VehicleVerificationStatus; rejectionReason: string | null } | null,
    approvalSkipped: boolean,
): PublishRequirement => {
    if (!vehicle) {
        return {
            key: 'VEHICLE',
            satisfied: false,
            skipped: false,
            reason: 'VEHICLE_REQUIRED',
            actionUrl: '/api/v1/vehicles/draft',
        };
    }

    const approved = vehicle.verificationStatus === VehicleVerificationStatus.APPROVED;

    if (approvalSkipped || approved) {
        return {
            key: 'VEHICLE',
            satisfied: true,
            skipped: approvalSkipped && !approved,
            reason: null,
            actionUrl: null,
        };
    }

    const rejected = vehicle.verificationStatus === VehicleVerificationStatus.REJECTED;

    return {
        key: 'VEHICLE',
        satisfied: false,
        skipped: false,
        // A rejected vehicle needs its own code and the admin's note, so the driver knows what
        // to fix instead of waiting on an approval that will never come.
        reason: rejected ? 'VEHICLE_REJECTED' : 'VEHICLE_NOT_VERIFIED',
        actionUrl: '/api/v1/vehicles',
        vehicle: {
            verificationStatus: vehicle.verificationStatus,
            rejectionReason: vehicle.rejectionReason,
        },
    };
};

/**
 * Evaluate every publish requirement for a driver. Never throws for an unmet
 * requirement — the caller decides whether to block or merely display.
 */
export const getDriverPublishEligibility = async (
    driverId: string,
): Promise<PublishEligibility> => {
    const bankSkipped = skipBankCheck();
    const vehicleVerificationSkipped = skipVehicleVerification();

    const [driver, vehicle] = await Promise.all([
        prisma.user.findUnique({
            where: { id: driverId },
            select: {
                dlVerified: true,
                stripeOnboardingComplete: true,
            },
        }),
        prisma.vehicle.findFirst({
            where: { userId: driverId, deletedAt: null },
            select: { id: true, verificationStatus: true, rejectionReason: true },
        }),
    ]);

    // A Veriff decision can come back approved while the document identity does not match the
    // entered profile — that is withheld as IDENTITY_MISMATCH. It is the reason the licence
    // gate failed, not a second gate: the driver fixes it in the same place, so it rides on
    // DL_VERIFICATION as a distinct code rather than a generic "not verified".
    const identityMismatch =
        !driver?.dlVerified
            ? Boolean(
                  await prisma.dlVerification.findFirst({
                      where: { userId: driverId, status: 'IDENTITY_MISMATCH' },
                      orderBy: { createdAt: 'desc' },
                      select: { id: true },
                  }),
              )
            : false;

    // A submitted licence sits unverified until the Veriff decision webhook lands, which can
    // take minutes. Without a code of its own that window is indistinguishable from having
    // never started, so the driver is told to "verify your licence" for work already done and
    // submits again. IDENTITY_MISMATCH still wins: it is actionable now, waiting is not.
    //
    // `submittedAt`, not merely status PENDING: the row is created the moment a session opens,
    // so PENDING alone would also cover a driver who opened the flow and walked away. Telling
    // that driver to wait strands them on a session that will never produce a decision, with
    // no way back to the button that would start a real one.
    const licenceUnderReview =
        !driver?.dlVerified && !identityMismatch
            ? Boolean(
                  await prisma.dlVerification.findFirst({
                      where: { userId: driverId, status: 'PENDING', submittedAt: { not: null } },
                      orderBy: { createdAt: 'desc' },
                      select: { id: true },
                  }),
              )
            : false;

    const licenceReason = identityMismatch
        ? 'DL_IDENTITY_MISMATCH'
        : licenceUnderReview
          ? 'DL_VERIFICATION_PENDING'
          : 'DRIVER_NOT_VERIFIED';

    const requirements: PublishRequirement[] = [
        // KYC gate — never skippable, whatever the environment.
        requirement(
            'DL_VERIFICATION',
            Boolean(driver?.dlVerified),
            licenceReason,
            // Under review there is nothing to re-submit, so the driver is pointed at the
            // status endpoint to poll rather than back into a second Veriff session.
            licenceUnderReview ? '/api/v1/dl-verification/status' : '/api/v1/dl-verification',
        ),
        requirement(
            'BANK_ACCOUNT',
            Boolean(driver?.stripeOnboardingComplete),
            'BANK_ACCOUNT_REQUIRED',
            '/api/v1/payments/connect/onboard',
            bankSkipped,
        ),
        buildVehicleRequirement(vehicle, vehicleVerificationSkipped),
    ];

    return {
        eligible: requirements.every((item) => item.satisfied),
        requirements,
    };
};

/**
 * Throw the first unmet requirement's error code. Codes are plain Error messages to match
 * the convention the publish-ride controllers already map to HTTP statuses.
 */
export const assertDriverCanPublish = async (driverId: string): Promise<void> => {
    const { eligible, requirements } = await getDriverPublishEligibility(driverId);
    if (eligible) return;

    const blocker = requirements.find((item) => !item.satisfied);
    throw new Error(blocker?.reason ?? 'DRIVER_NOT_ELIGIBLE');
};
