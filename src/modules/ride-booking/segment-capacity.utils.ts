/**
 * Per-segment seat capacity utilities.
 *
 * Handles incrementing/decrementing seat occupancy on segment edges
 * and updating the denormalized `ride.availableSeats` field.
 */

type PrismaTransaction = {
    rideSegmentCapacity: {
        findMany: (args: any) => Promise<any[]>;
        updateMany: (args: any) => Promise<any>;
    };
    ride: {
        update: (args: any) => Promise<any>;
        updateMany: (args: any) => Promise<any>;
    };
};

interface ReleaseSeatsInput {
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
    tx: PrismaTransaction,
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
                ? Math.max(...allEdges.map((e: any) => e.occupiedSeats))
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
