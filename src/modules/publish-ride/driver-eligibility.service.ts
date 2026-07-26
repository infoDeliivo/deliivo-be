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

export type PublishRequirementKey =
    | 'TOS'
    | 'DL_VERIFICATION'
    | 'IDENTITY_MATCH'
    | 'BANK_ACCOUNT'
    | 'VEHICLE'
    | 'VEHICLE_VERIFICATION';

/**
 * Review state for an unsatisfied VEHICLE_VERIFICATION requirement. A reason code alone
 * cannot carry the admin's free-text rejection note, so the note travels alongside it.
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
    /** Set only on an unsatisfied VEHICLE_VERIFICATION; absent everywhere else. */
    vehicle?: VehicleVerificationContext;
}

export interface PublishEligibility {
    eligible: boolean;
    requirements: PublishRequirement[];
}

/**
 * `START` is the entry point of the publish flow (POST /publish-ride/draft/origin) and
 * omits the Terms of Service gate — accepting the terms is the consent given when
 * committing the ride, not a prerequisite for drafting one. `PUBLISH` evaluates
 * everything.
 */
export type EligibilityStage = 'START' | 'PUBLISH';

const skipDlVerification = (): boolean => process.env.SKIP_DL_VERIFICATION === 'true';

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
 * Built inline rather than through `requirement()` because this is the one gate whose
 * reason code varies with the review outcome, and the only one that carries context back
 * to the driver: a rejected vehicle needs a different code and the admin's note, so the
 * driver knows what to fix instead of waiting on an approval that will never come.
 */
const buildVehicleVerificationRequirement = (
    vehicle: { verificationStatus: VehicleVerificationStatus; rejectionReason: string | null } | null,
    skipped: boolean,
): PublishRequirement => {
    const satisfied = vehicle?.verificationStatus === VehicleVerificationStatus.APPROVED;

    if (skipped || satisfied) {
        return {
            key: 'VEHICLE_VERIFICATION',
            satisfied: true,
            skipped,
            reason: null,
            actionUrl: null,
        };
    }

    const rejected = vehicle?.verificationStatus === VehicleVerificationStatus.REJECTED;

    return {
        key: 'VEHICLE_VERIFICATION',
        satisfied: false,
        skipped: false,
        reason: rejected ? 'VEHICLE_REJECTED' : 'VEHICLE_NOT_VERIFIED',
        actionUrl: '/api/v1/vehicles',
        ...(vehicle
            ? {
                  vehicle: {
                      verificationStatus: vehicle.verificationStatus,
                      rejectionReason: vehicle.rejectionReason,
                  },
              }
            : {}),
    };
};

/**
 * Evaluate every publish requirement for a driver. Never throws for an unmet
 * requirement — the caller decides whether to block or merely display.
 */
export const getDriverPublishEligibility = async (
    driverId: string,
    stage: EligibilityStage = 'PUBLISH',
): Promise<PublishEligibility> => {
    const dlSkipped = skipDlVerification();
    const bankSkipped = skipBankCheck();
    const vehicleVerificationSkipped = skipVehicleVerification();

    const [driver, vehicle] = await Promise.all([
        prisma.user.findUnique({
            where: { id: driverId },
            select: {
                tosAcceptedAt: true,
                dlVerified: true,
                stripeOnboardingComplete: true,
            },
        }),
        prisma.vehicle.findFirst({
            where: { userId: driverId, deletedAt: null },
            select: { id: true, verificationStatus: true, rejectionReason: true },
        }),
    ]);

    // A Veriff decision can come back approved while the document identity does not match
    // the entered profile — that is withheld as IDENTITY_MISMATCH and must be reported as
    // its own reason, not as a generic "not verified".
    const identityMismatch =
        !dlSkipped && !driver?.dlVerified
            ? Boolean(
                  await prisma.dlVerification.findFirst({
                      where: { userId: driverId, status: 'IDENTITY_MISMATCH' },
                      orderBy: { createdAt: 'desc' },
                      select: { id: true },
                  }),
              )
            : false;

    const requirements: PublishRequirement[] = [];

    if (stage === 'PUBLISH') {
        requirements.push(
            requirement(
                'TOS',
                Boolean(driver?.tosAcceptedAt),
                'TOS_NOT_ACCEPTED',
                '/api/v1/auth/accept-tos',
            ),
        );
    }

    requirements.push(
        requirement(
            'DL_VERIFICATION',
            Boolean(driver?.dlVerified),
            'DRIVER_NOT_VERIFIED',
            '/api/v1/dl-verification',
            dlSkipped,
        ),
        requirement(
            'IDENTITY_MATCH',
            !identityMismatch,
            'DL_IDENTITY_MISMATCH',
            '/api/v1/dl-verification',
            dlSkipped,
        ),
        requirement(
            'BANK_ACCOUNT',
            Boolean(driver?.stripeOnboardingComplete),
            'BANK_ACCOUNT_REQUIRED',
            '/api/v1/payments/connect/onboard',
            bankSkipped,
        ),
        // A vehicle must always exist. Only the admin approval of it can be bypassed.
        requirement('VEHICLE', Boolean(vehicle), 'VEHICLE_REQUIRED', '/api/v1/vehicles/draft'),
        buildVehicleVerificationRequirement(vehicle, vehicleVerificationSkipped),
    );

    return {
        eligible: requirements.every((item) => item.satisfied),
        requirements,
    };
};

/**
 * Throw the first unmet requirement's error code. Codes are plain Error messages to match
 * the convention the publish-ride controllers already map to HTTP statuses.
 */
export const assertDriverCanPublish = async (
    driverId: string,
    stage: EligibilityStage,
): Promise<void> => {
    const { eligible, requirements } = await getDriverPublishEligibility(driverId, stage);
    if (eligible) return;

    const blocker = requirements.find((item) => !item.satisfied);
    throw new Error(blocker?.reason ?? 'DRIVER_NOT_ELIGIBLE');
};
