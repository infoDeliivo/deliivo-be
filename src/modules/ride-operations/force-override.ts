import { RideStatus } from '@prisma/client';

/**
 * Driver-facing escape hatch for the in-ride steps.
 *
 * Reality on the road does not always match the state machine: the rider's OTP
 * never arrived, the app was offline, nobody confirmed a drop-off. Sending
 * `force: true` with a written reason lets the driver push the step through
 * anyway. Every forced step is audited, flagged and shown to the rider.
 */
export type ForceInput = {
    force?: boolean;
    overrideReason?: string;
};

export type ForceSummary = {
    forced: boolean;
    overrideReason: string | null;
    skippedChecks: string[];
};

export type ForceContext = {
    forced: boolean;
    overrideReason: string | null;
    /** Throws `code` when `violated`, unless the caller forced — then records the skip. */
    assertOrForce: (violated: boolean, code: string) => void;
    /** Records an advisory check that did not pass (geofence). Never throws. */
    noteSkip: (code: string) => void;
    /** Force annotations for `RideEvent.metadataJson`; empty object when not forced. */
    metadata: () => Record<string, unknown>;
    /** Force annotations for the API response, so the driver app can show what was overridden. */
    summary: () => ForceSummary;
};

/**
 * Forcing is only allowed while the ride is actually running. Before the start
 * and after the end, seat and money state is settled by other flows, so an
 * override there would corrupt it.
 */
export const FORCE_REQUIRES_RIDE_IN_PROGRESS = 'FORCE_REQUIRES_RIDE_IN_PROGRESS';

export const createForceContext = (input: ForceInput): ForceContext => {
    const forced = input.force === true;
    const overrideReason = input.overrideReason?.trim() || null;
    const skippedChecks: string[] = [];

    const record = (code: string) => {
        if (!skippedChecks.includes(code)) skippedChecks.push(code);
    };

    return {
        forced,
        overrideReason,

        assertOrForce: (violated, code) => {
            if (!violated) return;
            if (!forced) throw new Error(code);
            record(code);
        },

        noteSkip: (code) => {
            if (forced) record(code);
        },

        metadata: () => (forced
            ? {
                forced: true,
                manualOverride: true,
                overrideReason,
                skippedChecks: [...skippedChecks],
            }
            : {}),

        summary: () => ({
            forced,
            overrideReason,
            skippedChecks: [...skippedChecks],
        }),
    };
};

/** Refuse a forced action unless the ride is live. Non-forced calls pass through untouched. */
export const assertForceAllowedOnRide = (context: ForceContext, rideStatus: RideStatus) => {
    if (context.forced && rideStatus !== RideStatus.IN_PROGRESS) {
        throw new Error(FORCE_REQUIRES_RIDE_IN_PROGRESS);
    }
};
