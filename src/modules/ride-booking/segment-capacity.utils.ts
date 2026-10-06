/**
 * Seat capacity utilities.
 *
 * A ride's capacity is counted for the whole ride: every booking that holds seats takes
 * them from pickup to dropoff of the *ride*, not just of its own leg. Three riders on
 * A→B fill a 3-seat A→B→C ride for B→C and A→C too. `ride.availableSeats` is therefore
 * `totalSeats - sum(seatsBooked of bookings holding seats)`, recomputed from the booking
 * rows under the ride lock, so it cannot drift.
 *
 * Per-segment `occupiedSeats` rows are still maintained for the booked range (they
 * describe who is in the car on each leg), but nothing gates on them.
 */

import type { Prisma } from '@prisma/client';

/** The slice of a transaction client the seat helpers use; a full TransactionClient satisfies it. */
export type SeatTransaction = Pick<Prisma.TransactionClient, '$queryRaw' | 'rideSegmentCapacity' | 'ride' | 'rideBooking'>;

export interface ReleaseSeatsInput {
    rideId: string;
    seatsBooked: number;
    pickupPosition?: number | null;
    dropoffPosition?: number | null;
    totalSeats: number;
}

/** Locks the ride row. Every seat read and write happens after this, in this order. */
export const lockRideForSeats = async (tx: SeatTransaction, rideId: string): Promise<void> => {
    await tx.$queryRaw`SELECT "id" FROM "Ride" WHERE "id" = ${rideId} FOR UPDATE`;
};

/**
 * Seats held on the ride by bookings other than `excludeBookingId`. `seatsReservedAt`
 * is the only source of truth for "this row holds seats" (see sumReservedSeats).
 */
export const heldSeats = async (
    tx: SeatTransaction,
    rideId: string,
    excludeBookingId?: string,
): Promise<number> => {
    const result = await tx.rideBooking.aggregate({
        _sum: { seatsBooked: true },
        where: {
            rideId,
            seatsReservedAt: { not: null },
            ...(excludeBookingId ? { id: { not: excludeBookingId } } : {}),
        },
    });
    return result._sum.seatsBooked ?? 0;
};

/** Writes `availableSeats` from the bookings that hold seats. Caller holds the ride lock. */
export const recomputeAvailableSeats = async (
    tx: SeatTransaction,
    rideId: string,
    totalSeats: number,
): Promise<number> => {
    const availableSeats = Math.max(0, totalSeats - (await heldSeats(tx, rideId)));
    await tx.ride.update({ where: { id: rideId }, data: { availableSeats } });
    return availableSeats;
};

const bookedRangeWhere = (rideId: string, pickupPosition: number, dropoffPosition: number) => ({
    rideId,
    fromPosition: { gte: pickupPosition },
    toPosition: { lte: dropoffPosition },
});

/**
 * Release seats when a booking is cancelled/rejected. The booking must already have
 * stopped holding seats (`seatsReservedAt` cleared — releaseBookingSeats does this), so
 * the recompute no longer counts it.
 */
export const releaseSegmentSeats = async (
    tx: SeatTransaction,
    input: ReleaseSeatsInput
): Promise<void> => {
    const { rideId, seatsBooked, pickupPosition, dropoffPosition, totalSeats } = input;

    // Match reservation order: ride first, then segment rows.
    await lockRideForSeats(tx, rideId);

    if (pickupPosition != null && dropoffPosition != null) {
        await tx.rideSegmentCapacity.updateMany({
            where: { ...bookedRangeWhere(rideId, pickupPosition, dropoffPosition), occupiedSeats: { gte: seatsBooked } },
            data: { occupiedSeats: { decrement: seatsBooked } },
        });
    }

    await recomputeAvailableSeats(tx, rideId, totalSeats);
};

export interface ReserveSeatsInput extends ReleaseSeatsInput {
    /**
     * The booking taking the seats, when it already exists and may already be marked as
     * holding them (stripe payment success sets seatsReservedAt in the same transaction).
     * It is left out of the "already held" count so it is not counted twice.
     */
    bookingId?: string;
}

/**
 * Takes seats for a booking, counted against the whole ride. Throws INSUFFICIENT_SEATS so
 * the surrounding transaction rolls back rather than overselling. The ride lock serialises
 * concurrent reservations and releases, so the held count read here is current.
 */
export const reserveRideSeats = async (tx: SeatTransaction, input: ReserveSeatsInput): Promise<void> => {
    const { rideId, seatsBooked, pickupPosition, dropoffPosition, totalSeats, bookingId } = input;

    await lockRideForSeats(tx, rideId);

    const held = await heldSeats(tx, rideId, bookingId);
    if (held + seatsBooked > totalSeats) {
        throw new Error('INSUFFICIENT_SEATS');
    }

    if (pickupPosition != null && dropoffPosition != null) {
        await tx.rideSegmentCapacity.updateMany({
            where: bookedRangeWhere(rideId, pickupPosition, dropoffPosition),
            data: { occupiedSeats: { increment: seatsBooked } },
        });
    }

    await tx.ride.update({
        where: { id: rideId },
        data: { availableSeats: totalSeats - held - seatsBooked },
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
 * Seats currently held on a ride, from already-loaded booking rows. Equals
 * `totalSeats - ride.availableSeats`, since capacity is counted for the whole ride.
 *
 * `seatsReservedAt` is the only source of truth for "this row holds seats": status is
 * not, because a PAYMENT_PENDING booking holds nothing and a NO_SHOW one still does.
 */
export const sumReservedSeats = (
    bookings: ReadonlyArray<{ seatsBooked: number; seatsReservedAt: Date | null }>
): number => bookings.reduce((total, booking) => total + (booking.seatsReservedAt ? booking.seatsBooked : 0), 0);
