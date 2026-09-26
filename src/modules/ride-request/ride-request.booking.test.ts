jest.mock('../publish-ride/draft-ride.service.js', () => ({
  assertDriverHasNoOverlappingRide: jest.fn().mockResolvedValue(undefined),
}));
import { reserveRequestOffer, confirmRequestBooking } from './ride-request.booking';
import { Prisma } from '@prisma/client';

function fixture() {
  const offer = {
    id: 'offer',
    requestId: 'request',
    driverId: 'driver',
    rideId: 'ride',
    status: 'OPEN',
    expiresAt: new Date(Date.now() + 3600000),
    request: { riderId: 'rider', seats: 2, status: 'OPEN' },
    booking: {
      id: 'booking',
      rideId: 'ride',
      passengerId: 'rider',
      totalPrice: 20,
      paymentCurrency: 'EUR',
      stripePaymentIntentId: 'pi_test',
    },
    ride: {
      departureDate: new Date(Date.now() + 86400000),
      departureTime: '16:00',
      routeDurationSeconds: 3600,
    },
  };
  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    rideRequestOffer: {
      findUnique: jest.fn().mockResolvedValue(offer),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn(),
    },
    rideRequest: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), update: jest.fn() },
    ride: { update: jest.fn() },
    rideBooking: { update: jest.fn() },
    payment: {
      upsert: jest.fn().mockImplementation(async ({ create }) => ({ id: 'payment', ...create })),
    },
  };
  return { offer, tx, db: tx as unknown as Prisma.TransactionClient };
}
describe('request checkout transaction', () => {
  it('reserves the original party and sets a bounded checkout deadline', async () => {
    const { tx, db } = fixture();
    await reserveRequestOffer(db, 'offer', 'rider', 'ride', 2);
    expect(tx.rideRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'OPEN', riderId: 'rider' }),
        data: expect.objectContaining({
          status: 'CHECKOUT_PENDING',
          checkoutExpiresAt: expect.any(Date),
        }),
      }),
    );
  });
  it.each([
    ['someone-else', 'ride', 2],
    ['rider', 'wrong-ride', 2],
    ['rider', 'ride', 1],
  ])('rejects a forged checkout %s %s %s', async (rider, ride, seats) => {
    const { db, tx } = fixture();
    await expect(
      reserveRequestOffer(db, 'offer', String(rider), String(ride), Number(seats)),
    ).rejects.toThrow('OFFER_UNAVAILABLE');
    expect(tx.rideRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rejects duplicate or competing selection', async () => {
    const { db, tx } = fixture();
    tx.rideRequest.updateMany.mockResolvedValue({ count: 0 });
    await expect(reserveRequestOffer(db, 'offer', 'rider', 'ride', 2)).rejects.toThrow(
      'REQUEST_ALREADY_SELECTED',
    );
    expect(tx.rideRequestOffer.updateMany).not.toHaveBeenCalled();
  });
  it('rejects an expired offer', async () => {
    const { db, offer } = fixture();
    offer.expiresAt = new Date(0);
    await expect(reserveRequestOffer(db, 'offer', 'rider', 'ride', 2)).rejects.toThrow();
  });
  it('leaves normal bookings on the existing workflow', async () => {
    const { db, tx } = fixture();
    tx.rideRequestOffer.findUnique.mockResolvedValue(null as never);
    expect(await confirmRequestBooking(db, 'booking')).toBeNull();
    expect(tx.ride.update).not.toHaveBeenCalled();
  });
  it('confirms booking, issues OTPs, publishes ride, matches request and closes competing offers', async () => {
    const { db, tx, offer } = fixture();
    offer.status = 'SELECTED';
    offer.request.status = 'CHECKOUT_PENDING';
    await confirmRequestBooking(db, 'booking');
    expect(tx.rideBooking.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'CONFIRMED',
          pickupOtpHash: expect.any(String),
          dropOtpHash: expect.any(String),
          driverDecisionDeadlineAt: null,
        }),
      }),
    );
    expect(tx.ride.update).toHaveBeenCalledWith({
      where: { id: 'ride' },
      data: { status: 'PUBLISHED' },
    });
    expect(tx.rideRequest.update).toHaveBeenCalledWith({
      where: { id: 'request' },
      data: { status: 'MATCHED', checkoutExpiresAt: null },
    });
    expect(tx.rideRequestOffer.updateMany).toHaveBeenCalledWith({
      where: { requestId: 'request', status: 'OPEN' },
      data: { status: 'CLOSED' },
    });
  });
  it('does not revive a closed request on a late payment event', async () => {
    const { db, tx, offer } = fixture();
    offer.status = 'EXPIRED';
    await expect(confirmRequestBooking(db, 'booking')).rejects.toThrow(
      'REQUEST_PAYMENT_REQUIRES_RECONCILIATION',
    );
    expect(tx.ride.update).not.toHaveBeenCalled();
  });
  it('repairs the payment record before confirming or publishing', async () => {
    const { db, tx, offer } = fixture();
    offer.status = 'SELECTED';
    offer.request.status = 'CHECKOUT_PENDING';
    await confirmRequestBooking(db, 'booking');
    expect(tx.payment.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bookingId: 'booking' } }),
    );
    expect(tx.payment.upsert.mock.invocationCallOrder[0]).toBeLessThan(
      tx.ride.update.mock.invocationCallOrder[0],
    );
  });
  it('does not confirm a ride if repairing its payment record fails', async () => {
    const { db, tx, offer } = fixture();
    offer.status = 'SELECTED';
    offer.request.status = 'CHECKOUT_PENDING';
    tx.payment.upsert.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(confirmRequestBooking(db, 'booking')).rejects.toThrow('database unavailable');
    expect(tx.rideBooking.update).not.toHaveBeenCalled();
    expect(tx.ride.update).not.toHaveBeenCalled();
  });
  it('sets OTP expiry after departure for a booking paid days in advance', async () => {
    const { db, tx, offer } = fixture();
    offer.status = 'SELECTED';
    offer.request.status = 'CHECKOUT_PENDING';
    offer.ride.departureDate = new Date(Date.now() + 30 * 86400000);
    await confirmRequestBooking(db, 'booking');
    const data = tx.rideBooking.update.mock.calls[0][0].data;
    const departure = new Date(`${offer.ride.departureDate.toISOString().slice(0, 10)}T16:00:00Z`);
    expect(data.pickupOtpExpiresAt.getTime()).toBe(departure.getTime() + 6 * 3600000);
    expect(data.dropOtpExpiresAt.getTime()).toBe(departure.getTime() + 25 * 3600000);
  });
  it('requires reconciliation rather than publishing a journey in the past', async () => {
    const { db, tx, offer } = fixture();
    offer.status = 'SELECTED';
    offer.request.status = 'CHECKOUT_PENDING';
    offer.ride.departureDate = new Date(0);
    await expect(confirmRequestBooking(db, 'booking')).rejects.toThrow(
      'REQUEST_PAYMENT_REQUIRES_RECONCILIATION',
    );
    expect(tx.ride.update).not.toHaveBeenCalled();
  });
});
