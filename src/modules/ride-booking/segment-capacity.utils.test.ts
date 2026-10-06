import { releaseSegmentSeats, reserveRideSeats, SeatTransaction } from './segment-capacity.utils';

function fixture(held = 0) {
  const events: string[] = [];
  const mocks = {
    $queryRaw: jest.fn().mockImplementation(async () => {
      events.push('ride-lock');
      return [];
    }),
    rideSegmentCapacity: {
      updateMany: jest.fn().mockImplementation(async () => {
        events.push('write-capacity');
        return { count: 1 };
      }),
    },
    rideBooking: {
      aggregate: jest.fn().mockImplementation(async () => {
        events.push('count-held');
        return { _sum: { seatsBooked: held } };
      }),
    },
    ride: {
      update: jest.fn().mockImplementation(async () => {
        events.push('write-ride');
      }),
    },
  };
  // The helpers only touch the methods above; the cast stands in for a full client.
  const tx = mocks as unknown as SeatTransaction;
  return { tx, mocks, events };
}

describe('seat release', () => {
  it('locks the ride, frees the legs, then recomputes availableSeats from held bookings', async () => {
    const { tx, mocks, events } = fixture(1);
    await releaseSegmentSeats(tx, {
      rideId: 'ride',
      seatsBooked: 1,
      pickupPosition: 0,
      dropoffPosition: 1,
      totalSeats: 3,
    });
    expect(events).toEqual(['ride-lock', 'write-capacity', 'count-held', 'write-ride']);
    expect(mocks.ride.update).toHaveBeenCalledWith({ where: { id: 'ride' }, data: { availableSeats: 2 } });
    // Only seat-holding bookings are counted.
    expect(mocks.rideBooking.aggregate).toHaveBeenCalledWith({
      _sum: { seatsBooked: true },
      where: { rideId: 'ride', seatsReservedAt: { not: null } },
    });
  });

  it('never decrements a leg below zero', async () => {
    const { tx, mocks } = fixture();
    await releaseSegmentSeats(tx, { rideId: 'ride', seatsBooked: 2, pickupPosition: 0, dropoffPosition: 1, totalSeats: 3 });
    expect(mocks.rideSegmentCapacity.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ occupiedSeats: { gte: 2 } }) }),
    );
  });

  it('recomputes from bookings even without positions', async () => {
    const { tx, mocks, events } = fixture(0);
    await releaseSegmentSeats(tx, { rideId: 'ride', seatsBooked: 1, totalSeats: 3 });
    expect(events).toEqual(['ride-lock', 'count-held', 'write-ride']);
    expect(mocks.ride.update).toHaveBeenCalledWith({ where: { id: 'ride' }, data: { availableSeats: 3 } });
  });

  it('does not count or write while another reservation holds the ride lock', async () => {
    const { tx, mocks } = fixture();
    let unlock!: () => void;
    mocks.$queryRaw.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          unlock = resolve;
        }),
    );
    const release = releaseSegmentSeats(tx, { rideId: 'ride', seatsBooked: 1, pickupPosition: 0, dropoffPosition: 1, totalSeats: 3 });
    expect(mocks.rideBooking.aggregate).not.toHaveBeenCalled();
    unlock();
    await release;
    expect(mocks.ride.update).toHaveBeenCalledTimes(1);
  });

  it('does not update seats after a lock failure', async () => {
    const { tx, mocks } = fixture();
    mocks.$queryRaw.mockRejectedValueOnce(new Error('lock unavailable'));
    await expect(releaseSegmentSeats(tx, { rideId: 'ride', seatsBooked: 1, totalSeats: 3 })).rejects.toThrow('lock unavailable');
    expect(mocks.ride.update).not.toHaveBeenCalled();
  });
});

describe('seat reservation counts the whole ride', () => {
  it('refuses when held seats on any legs plus the request exceed totalSeats', async () => {
    // 3 riders hold A->B on a 3-seat ride; a B->C request must still be refused.
    const { tx, mocks } = fixture(3);
    await expect(
      reserveRideSeats(tx, { rideId: 'ride', seatsBooked: 1, pickupPosition: 1, dropoffPosition: 2, totalSeats: 3 }),
    ).rejects.toThrow('INSUFFICIENT_SEATS');
    expect(mocks.rideSegmentCapacity.updateMany).not.toHaveBeenCalled();
    expect(mocks.ride.update).not.toHaveBeenCalled();
  });

  it('takes the last seat and leaves availableSeats at zero', async () => {
    const { tx, mocks, events } = fixture(2);
    await reserveRideSeats(tx, { rideId: 'ride', seatsBooked: 1, pickupPosition: 0, dropoffPosition: 1, totalSeats: 3 });
    expect(events).toEqual(['ride-lock', 'count-held', 'write-capacity', 'write-ride']);
    expect(mocks.ride.update).toHaveBeenCalledWith({ where: { id: 'ride' }, data: { availableSeats: 0 } });
  });

  it('leaves the booking being reserved out of the held count', async () => {
    const { tx, mocks } = fixture(0);
    await reserveRideSeats(tx, { rideId: 'ride', seatsBooked: 1, pickupPosition: 0, dropoffPosition: 1, totalSeats: 1, bookingId: 'b1' });
    expect(mocks.rideBooking.aggregate).toHaveBeenCalledWith({
      _sum: { seatsBooked: true },
      where: { rideId: 'ride', seatsReservedAt: { not: null }, id: { not: 'b1' } },
    });
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
