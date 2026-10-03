import logger from '../../utils/logger.js';
import { createNotification } from '../notification/notification.service.js';
import { createDispute } from '../dispute/dispute.service.js';
import { DISPUTE_STATUSES } from '../dispute/dispute.constants.js';
import type { ForceContext } from './force-override.js';

/** Human-readable label per forceable operation, used in the rider's notification. */
const ACTION_LABELS: Record<string, string> = {
    DRIVER_ARRIVED: 'marked themselves as arrived',
    PICKUP_OTP_VERIFIED: 'boarded you without a valid pickup OTP',
    DROP_OTP_VERIFIED: 'completed your drop-off without a valid OTP',
    NO_SHOW_MARKED: 'marked you as a no-show',
    DROPOFF_CONFIRMED_DRIVER: 'confirmed your drop-off',
    DROPOFF_CONFIRMED_RIDER: 'confirmed the drop-off on your behalf',
    RIDE_FINISHED: 'finished the ride',
};

/**
 * Operations where a forced action can cost someone money, so it also opens a
 * dispute for a human to look at. Everything else is covered by the SUSPICIOUS
 * ride event alone.
 */
const HIGH_RISK_ACTIONS = new Set([
    'PICKUP_OTP_VERIFIED',
    'DROP_OTP_VERIFIED',
    'NO_SHOW_MARKED',
]);

type ForcedActionParams = {
    context: ForceContext;
    action: string;
    rideId: string;
    bookingId: string;
    /** The rider to warn. Omitted only when there is nobody to warn. */
    passengerId?: string | null;
    /** Whoever forced the action — the dispute is raised in their name. */
    actorId: string;
};

const notifyForcedAction = async ({ context, action, rideId, bookingId, passengerId }: ForcedActionParams) => {
    if (!passengerId) return;

    const label = ACTION_LABELS[action] ?? 'overrode a step of your booking';
    const reason = context.overrideReason ? ` Reason given: "${context.overrideReason}"` : '';

    await createNotification({
        userId: passengerId,
        type: 'booking.forced_action',
        title: 'A step of your ride was overridden',
        body: `The driver ${label}.${reason} Contact support if this is wrong.`,
        data: {
            rideId,
            bookingId,
            action,
            forced: true,
            overrideReason: context.overrideReason,
            skippedChecks: context.summary().skippedChecks,
            deepLink: `app://booking/${bookingId}`,
        },
    });
};

const openReviewDispute = async ({ context, action, rideId, bookingId, actorId }: ForcedActionParams) => {
    if (!HIGH_RISK_ACTIONS.has(action)) return;

    try {
        await createDispute({
            rideId,
            bookingId,
            raisedBy: actorId,
            reason: `FORCED_${action}`,
            description: context.overrideReason ?? undefined,
            status: DISPUTE_STATUSES.NEEDS_MANUAL_REVIEW,
        });
    } catch (error) {
        // A duplicate flag, or any dispute-side failure, must never fail the
        // driver's operation — the SUSPICIOUS ride event still records it.
        logger.warn('Failed to open review dispute for forced ride action', {
            rideId,
            bookingId,
            action,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};

/**
 * Side effects owed to everyone else when a driver forces a step: the rider is
 * told, and the high-risk overrides are queued for manual review.
 *
 * Never throws — a failure here must not roll back an operation the driver has
 * already been told succeeded.
 */
export const handleForcedAction = async (params: ForcedActionParams) => {
    if (!params.context.forced) return;

    try {
        await notifyForcedAction(params);
    } catch (error) {
        logger.warn('Failed to notify passenger of forced ride action', {
            bookingId: params.bookingId,
            action: params.action,
            error: error instanceof Error ? error.message : String(error),
        });
    }

    await openReviewDispute(params);
};
