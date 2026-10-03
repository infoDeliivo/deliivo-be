import { releaseSegmentSeats } from './segment-capacity.utils';

function fixture() {
  const events: string[] = [];
  const tx = {
    $queryRaw: jest.fn().mockImplementation(async () => {
      events.push('ride-lock');
      return [];
    }),
    rideSegmentCapacity: {
      findMany: jest.fn().mockImplementation(async () => {
        events.push('read-capacity');
        return [{ occupiedSeats: 1 }];
      }),
      updateMany: jest.fn().mockImplementation(async () => {
        events.push('write-capacity');
        return { count: 1 };
      }),
    },
    ride: {
      update: jest.fn().mockImplementation(async () => {
        events.push('write-ride');
      }),
      updateMany: jest.fn(),
    },
  };
  return { tx, events };
}

describe('seat-release lock order', () => {
  it('locks the ride before reading or updating capacity', async () => {
    const { tx, events } = fixture();
    await releaseSegmentSeats(tx, {
      rideId: 'ride',
      seatsBooked: 1,
      pickupPosition: 0,
      dropoffPosition: 1,
      totalSeats: 3,
    });
    expect(events).toEqual([
      'ride-lock',
      'read-capacity',
      'write-capacity',
      'read-capacity',
      'write-ride',
    ]);
    expect(tx.ride.update).toHaveBeenCalledWith({
      where: { id: 'ride' },
      data: { availableSeats: 2 },
    });
  });
  it('also locks before the legacy global-seat fallback', async () => {
    const { tx, events } = fixture();
    await releaseSegmentSeats(tx, { rideId: 'ride', seatsBooked: 1, totalSeats: 3 });
    expect(events).toEqual(['ride-lock', 'write-ride']);
  });
  it('does not touch capacity while another reservation holds the ride lock', async () => {
    const { tx } = fixture();
    let unlock!: () => void;
    tx.$queryRaw.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          unlock = resolve;
        }),
    );
    const release = releaseSegmentSeats(tx, {
      rideId: 'ride',
      seatsBooked: 1,
      pickupPosition: 0,
      dropoffPosition: 1,
      totalSeats: 3,
    });
    expect(tx.rideSegmentCapacity.findMany).not.toHaveBeenCalled();
    unlock();
    await release;
    expect(tx.rideSegmentCapacity.updateMany).toHaveBeenCalledTimes(1);
  });
  it('does not update seats after a lock failure', async () => {
    const { tx } = fixture();
    tx.$queryRaw.mockRejectedValueOnce(new Error('lock unavailable'));
    await expect(
      releaseSegmentSeats(tx, { rideId: 'ride', seatsBooked: 1, totalSeats: 3 }),
    ).rejects.toThrow('lock unavailable');
    expect(tx.ride.update).not.toHaveBeenCalled();
  });
});

import { sumReservedSeats } from './segment-capacity.utils.js';

const reserved = (seatsBooked: number) => ({ seatsBooked, seatsReservedAt: new Date() });
const unreserved = (seatsBooked: number) => ({ seatsBooked, seatsReservedAt: null });

describe('sumReservedSeats', () => {
    it('returns 0 for a ride with no bookings', () => {
        expect(sumReservedSeats([])).toBe(0);
    });

    it('counts only bookings that hold seats', () => {
        expect(sumReservedSeats([reserved(1), unreserved(2), reserved(1)])).toBe(2);
    });

    it('sums seats, not booking rows', () => {
        expect(sumReservedSeats([reserved(3), reserved(2)])).toBe(5);
    });

    it('counts a segment booking alongside whole-route ones', () => {
        // The reported regression: two whole-route riders plus one segment rider on a
        // 3-seat ride. The driver must see 3, whichever legs the segment covers.
        expect(sumReservedSeats([reserved(1), reserved(1), reserved(1)])).toBe(3);
    });

    it('reports seats sold even when peak occupancy is lower', () => {
        // Two riders on disjoint legs: availableSeats (totalSeats - peak) would say one
        // seat is taken, but two were sold.
        const bookings = [reserved(1), reserved(1)];
        const totalSeats = 3;
        const peakOccupied = 1;

        expect(sumReservedSeats(bookings)).toBe(2);
        expect(totalSeats - peakOccupied).toBe(2); // availableSeats, a different question
    });
});
