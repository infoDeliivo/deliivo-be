/**
 * Per-segment seat capacity utilities.
 *
 * Handles incrementing/decrementing seat occupancy on segment edges
 * and updating the denormalized `ride.availableSeats` field.
 */

import { Prisma } from '@prisma/client';

export interface ReleaseSeatsInput {
    rideId: string;
    seatsBooked: number;
    pickupPosition?: number | null;
    dropoffPosition?: number | null;
    totalSeats: number;
}

/**
 * Release seats when a booking is cancelled/rejected.
 * Uses per-segment capacity if available, otherwise falls back to global increment.
 */
export const releaseSegmentSeats = async (
    tx: Prisma.TransactionClient,
    input: ReleaseSeatsInput
): Promise<void> => {
    const { rideId, seatsBooked, pickupPosition, dropoffPosition, totalSeats } = input;

    // If positions are known, use per-segment release
    if (pickupPosition != null && dropoffPosition != null) {
        const edges = await tx.rideSegmentCapacity.findMany({
            where: {
                rideId,
                fromPosition: { gte: pickupPosition },
                toPosition: { lte: dropoffPosition },
            },
        });

        if (edges.length > 0) {
            await tx.rideSegmentCapacity.updateMany({
                where: {
                    rideId,
                    fromPosition: { gte: pickupPosition },
                    toPosition: { lte: dropoffPosition },
                },
                data: { occupiedSeats: { decrement: seatsBooked } },
            });

            // Recalculate denormalized availableSeats
            const allEdges = await tx.rideSegmentCapacity.findMany({ where: { rideId } });
            const maxOccupied = allEdges.length > 0
                ? Math.max(...allEdges.map((e) => e.occupiedSeats))
                : 0;
            await tx.ride.update({
                where: { id: rideId },
                data: { availableSeats: totalSeats - maxOccupied },
            });
            return;
        }
    }

    // Fallback: global seat increment
    await tx.ride.update({
        where: { id: rideId },
        data: { availableSeats: { increment: seatsBooked } },
    });
};

export interface ReleaseBookingSeatsInput extends ReleaseSeatsInput {
    bookingId: string;
}

/**
 * Release a booking's seats exactly once.
 *
 * `releaseSegmentSeats` is not idempotent, and not every booking holds seats: in stripe
 * mode seats are taken when the payment confirms, so an unpaid booking has none. Both
 * hazards are handled by claiming `seatsReservedAt` first — the row is the lock, so two
 * concurrent releases (webhook, expiry job, rider cancelling) cannot both give seats
 * back, and a booking that never reserved any is a no-op.
 *
 * Returns whether seats were actually released.
 */
export const releaseBookingSeats = async (
    tx: Prisma.TransactionClient,
    input: ReleaseBookingSeatsInput
): Promise<boolean> => {
    const claimed = await tx.rideBooking.updateMany({
        where: { id: input.bookingId, seatsReservedAt: { not: null } },
        data: { seatsReservedAt: null },
    });

    if (claimed.count === 0) return false;

    await releaseSegmentSeats(tx, input);
    return true;
};

/**
 * Seats currently held on a ride: what riders actually bought, not peak concurrent
 * occupancy. `ride.availableSeats` answers "can another rider fit" (totalSeats minus
 * the busiest edge), which under-reports sales when bookings sit on disjoint segments —
 * two riders on non-overlapping legs sell two seats with a peak of one. Driver-facing
 * "booked" counts must use this instead.
 *
 * `seatsReservedAt` is the only source of truth for "this row holds seats": status is
 * not, because a PAYMENT_PENDING booking holds nothing and a NO_SHOW one still does.
 */
export const sumReservedSeats = (
    bookings: ReadonlyArray<{ seatsBooked: number; seatsReservedAt: Date | null }>
): number => bookings.reduce((total, booking) => total + (booking.seatsReservedAt ? booking.seatsBooked : 0), 0);
