import { WAIT_TIME_MINUTES } from './ride-operations.types.js';

/**
 * When a driver may mark a rider as a no-show: WAIT_TIME_MINUTES after they reported arriving
 * at the pickup (`waitTimerStartedAt`). Local ride simulation lifts the wait so the whole
 * lifecycle can be exercised in one session.
 *
 * Returns null when no wait timer has started; markNoShow then has nothing to enforce.
 * Shared by markNoShow (enforcement) and the driver's ride payload (countdown), so the UI and
 * the rule cannot drift apart.
 */
export const noShowAvailableAt = (waitTimerStartedAt: Date | null): Date | null => {
    if (!waitTimerStartedAt) return null;
    if (process.env.ALLOW_RIDE_SIMULATION === 'true') return waitTimerStartedAt;
    return new Date(waitTimerStartedAt.getTime() + WAIT_TIME_MINUTES * 60_000);
};
