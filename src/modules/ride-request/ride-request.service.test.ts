const mockDb = {
  user: { findUnique: jest.fn() },
  rideRequestOffer: { findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn() },
  rideRequest: { updateMany: jest.fn() },
  rideBooking: { updateMany: jest.fn(), findUnique: jest.fn() },
  ride: { update: jest.fn() },
  $transaction: jest.fn(),
};
const mockRetrieve = jest.fn();
jest.mock('./ride-request.payment.js', () => ({ ensureRequestPayment: jest.fn() }));
jest.mock('../../config/index.js', () => ({ prisma: mockDb }));
jest.mock('../maps/google.service.js', () => ({ googleService: {} }));
jest.mock('../publish-ride/driver-eligibility.service.js', () => ({
  assertDriverCanPublish: jest.fn(),
}));
jest.mock('../publish-ride/draft-ride.service.js', () => ({}));
jest.mock('../pricing/pricing.service.js', () => ({ validateAndSnapshotPricing: jest.fn() }));
jest.mock('../notification/notification.service.js', () => ({ createNotification: jest.fn() }));
jest.mock('../ride-booking/ride-booking.service.js', () => ({
  createBooking: jest.fn(),
  getBookingById: jest.fn(),
  applyStripePaymentSucceededToBooking: jest.fn(),
  calculateBookingPrice: jest.fn(),
}));
jest.mock('../payments/stripe.service.js', () => ({
  cancelPaymentIntent: jest.fn(),
  getStripeClient: () => ({ paymentIntents: { retrieve: mockRetrieve } }),
}));
jest.mock('../ride-booking/segment-capacity.utils.js', () => ({ releaseSegmentSeats: jest.fn() }));

import {
  expireRequestCheckouts,
  checkoutOffer,
  listRequests,
  requestSchema,
  createOffer,
  createRequest,
} from './ride-request.service';
import { assertDriverCanPublish } from '../publish-ride/driver-eligibility.service.js';
import { cancelPaymentIntent } from '../payments/stripe.service.js';
import {
  applyStripePaymentSucceededToBooking,
  createBooking,
} from '../ride-booking/ride-booking.service.js';
import { releaseSegmentSeats } from '../ride-booking/segment-capacity.utils.js';
import { ensureRequestPayment } from './ride-request.payment.js';
import { getBookingById } from '../ride-booking/ride-booking.service.js';

describe('ride request account requirements', () => {
  const activeUser = {
    isBanned: false,
    dob: new Date('1990-01-01'),
    tosAcceptedAt: new Date(),
    privacyAcceptedAt: new Date(),
  };
  const offer = {
    vehicleId: 'vehicle', departureAt: '2030-01-01T12:00:00Z', totalSeats: 3,
    pricePerSeat: 20, expiresInHours: 24, acceptsSharedJourney: true as const,
  };
  const request = {
    originPlaceId: 'riga', destinationPlaceId: 'tallinn',
    departureAfter: '2030-01-01T12:00:00Z', departureBefore: '2030-01-01T12:00:00Z',
    seats: 1, luggage: 0, notes: '',
  };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [null, 'Sign in'],
    [{ ...activeUser, isBanned: true }, 'account is blocked'],
    [{ ...activeUser, dob: null }, 'date of birth'],
    [{ ...activeUser, dob: new Date() }, 'at least 8 years old'],
    [{ ...activeUser, tosAcceptedAt: null }, 'Terms of Service and Privacy Policy'],
    [{ ...activeUser, privacyAcceptedAt: null }, 'Terms of Service and Privacy Policy'],
  ])('rejects an ineligible account with an actionable reason: %j', async (user, reason) => {
    mockDb.user.findUnique.mockResolvedValue(user);
    await expect(createOffer('request', 'driver', offer)).rejects.toThrow(reason as string);
    await expect(createRequest('rider', request)).rejects.toThrow(reason as string);
    expect(assertDriverCanPublish).not.toHaveBeenCalled();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
  });

  it('continues to driver eligibility after consent is recorded', async () => {
    mockDb.user.findUnique.mockResolvedValue(activeUser);
    (assertDriverCanPublish as jest.Mock).mockRejectedValueOnce(new Error('DRIVER_CHECK'));
    await expect(createOffer('request', 'driver', offer)).rejects.toThrow('DRIVER_CHECK');
    expect(assertDriverCanPublish).toHaveBeenCalledWith('driver', 'vehicle');
  });
});

describe('request checkout reconciliation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.$transaction.mockImplementation((callback) => callback(mockDb));
    mockDb.rideBooking.updateMany.mockResolvedValue({ count: 1 });
    mockDb.rideRequestOffer.updateMany.mockResolvedValue({ count: 1 });
    mockDb.rideRequestOffer.findMany.mockResolvedValue([
      {
        id: 'offer',
        requestId: 'request',
        rideId: 'ride',
        booking: {
          id: 'booking',
          status: 'PAYMENT_PENDING',
          stripePaymentIntentId: 'pi_test',
          rideId: 'ride',
          seatsBooked: 2,
          pickupPosition: 0,
          dropoffPosition: 1,
          ride: { totalSeats: 3 },
        },
      },
    ]);
    mockRetrieve.mockResolvedValue({ id: 'pi_test', status: 'requires_payment_method' });
    (cancelPaymentIntent as jest.Mock).mockResolvedValue({ status: 'canceled' });
  });
  it('cancels the payment before releasing seats and reopening the request', async () => {
    await expireRequestCheckouts();
    expect(cancelPaymentIntent).toHaveBeenCalledWith('pi_test');
    expect((cancelPaymentIntent as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mockDb.$transaction.mock.invocationCallOrder[0],
    );
    expect(releaseSegmentSeats).toHaveBeenCalledTimes(1);
    expect(mockDb.ride.update).toHaveBeenCalledWith({
      where: { id: 'ride' },
      data: { status: 'CANCELLED' },
    });
    expect(mockDb.rideRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'OPEN', checkoutExpiresAt: null } }),
    );
  });
  it('reconciles successful payment instead of releasing its seats', async () => {
    mockRetrieve.mockResolvedValue({ id: 'pi_test', status: 'succeeded' });
    await expireRequestCheckouts();
    expect(applyStripePaymentSucceededToBooking).toHaveBeenCalledWith({
      id: 'pi_test',
      status: 'succeeded',
    });
    expect(cancelPaymentIntent).not.toHaveBeenCalled();
    expect(releaseSegmentSeats).not.toHaveBeenCalled();
  });
  it('keeps reservations when Stripe cancellation is inconclusive', async () => {
    (cancelPaymentIntent as jest.Mock).mockRejectedValueOnce(new Error('Stripe unavailable'));
    const warning = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expireRequestCheckouts();
    expect(mockDb.$transaction).not.toHaveBeenCalled();
    expect(releaseSegmentSeats).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });
  it('releases already-cancelled intents without cancelling twice', async () => {
    mockRetrieve.mockResolvedValue({ id: 'pi_test', status: 'canceled' });
    await expireRequestCheckouts();
    expect(cancelPaymentIntent).not.toHaveBeenCalled();
    expect(releaseSegmentSeats).toHaveBeenCalledTimes(1);
  });
  it('does not release seats twice when another worker won the booking transition', async () => {
    mockDb.rideBooking.updateMany.mockResolvedValue({ count: 0 });
    await expireRequestCheckouts();
    expect(releaseSegmentSeats).not.toHaveBeenCalled();
    expect(mockDb.ride.update).not.toHaveBeenCalled();
  });
  it('cleans up failed initialization without a payment intent', async () => {
    mockDb.rideRequestOffer.findMany.mockResolvedValue([
      {
        id: 'offer',
        requestId: 'request',
        rideId: 'ride',
        booking: {
          id: 'booking',
          status: 'PAYMENT_PENDING',
          stripePaymentIntentId: null,
          rideId: 'ride',
          seatsBooked: 1,
          ride: { totalSeats: 3 },
        },
      },
    ]);
    await expireRequestCheckouts();
    expect(mockRetrieve).not.toHaveBeenCalled();
    expect(releaseSegmentSeats).toHaveBeenCalledTimes(1);
  });
  it('rejects checkout by a different rider before invoking payment', async () => {
    mockDb.rideRequestOffer.findUnique.mockResolvedValue({ request: { riderId: 'owner' } });
    await expect(checkoutOffer('offer', 'stranger')).rejects.toThrow('NOT_FOUND');
    expect(createBooking).not.toHaveBeenCalled();
  });
  it('does not release seats when initialization links an intent after the expiry scan', async () => {
    const booking = {
      id: 'booking',
      status: 'PAYMENT_PENDING',
      stripePaymentIntentId: null,
      payment: null,
      rideId: 'ride',
      seatsBooked: 1,
      ride: { totalSeats: 3 },
    };
    mockDb.rideRequestOffer.findMany.mockResolvedValueOnce([
      { id: 'offer', requestId: 'request', rideId: 'ride', booking },
    ]);
    // The database row now has an intent, although the scan returned null.
    mockDb.rideBooking.updateMany.mockImplementationOnce(async ({ where }) => ({
      count: where.stripePaymentIntentId === 'pi_linked_after_scan' ? 1 : 0,
    }));
    await expireRequestCheckouts();
    expect(mockDb.rideBooking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripePaymentIntentId: null, payment: { is: null } }),
      }),
    );
    expect(releaseSegmentSeats).not.toHaveBeenCalled();
    expect(mockDb.ride.update).not.toHaveBeenCalled();
    // On retry the intent is visible and must be cancelled before release.
    mockDb.rideRequestOffer.findMany.mockResolvedValueOnce([
      {
        id: 'offer',
        requestId: 'request',
        rideId: 'ride',
        booking: { ...booking, stripePaymentIntentId: 'pi_linked_after_scan' },
      },
    ]);
    await expireRequestCheckouts();
    expect(cancelPaymentIntent).toHaveBeenCalledWith('pi_linked_after_scan');
    expect(releaseSegmentSeats).toHaveBeenCalledTimes(1);
  });
  it('also compares the fallback payment-record intent before releasing seats', async () => {
    mockDb.rideRequestOffer.findMany.mockResolvedValueOnce([
      {
        id: 'offer',
        requestId: 'request',
        rideId: 'ride',
        booking: {
          id: 'booking',
          status: 'PAYMENT_PENDING',
          stripePaymentIntentId: null,
          payment: { id: 'payment', stripePaymentIntentId: 'pi_fallback' },
          ride: { totalSeats: 3 },
        },
      },
    ]);
    await expireRequestCheckouts();
    expect(cancelPaymentIntent).toHaveBeenCalledWith('pi_fallback');
    expect(mockDb.rideBooking.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          payment: { is: { id: 'payment', stripePaymentIntentId: 'pi_fallback' } },
        }),
      }),
    );
  });
  it.each([false, true])(
    'repairs missing payment bookkeeping before resume (repair failure: %s)',
    async (fail) => {
      mockDb.rideRequestOffer.findUnique.mockResolvedValueOnce({
        bookingId: 'booking',
        status: 'SELECTED',
        request: { riderId: 'rider', checkoutExpiresAt: new Date(Date.now() + 60000) },
      });
      const row = { id: 'booking', status: 'PAYMENT_PENDING', stripePaymentIntentId: 'pi_test' };
      mockDb.rideBooking.findUnique.mockResolvedValueOnce(row);
      (getBookingById as jest.Mock).mockResolvedValueOnce({ id: 'booking', payment: null });
      mockRetrieve.mockResolvedValueOnce({
        id: 'pi_test',
        status: 'requires_payment_method',
        client_secret: 'secret',
      });
      if (fail)
        (ensureRequestPayment as jest.Mock).mockRejectedValueOnce(new Error('repair failed'));
      const result = checkoutOffer('offer', 'rider');
      if (fail) await expect(result).rejects.toThrow('repair failed');
      else await expect(result).resolves.toMatchObject({ payment: { clientSecret: 'secret' } });
      expect(ensureRequestPayment).toHaveBeenCalledWith(mockDb, row);
    },
  );
  it('does not expose the admin listing to a normal user', async () => {
    await expect(listRequests('rider', { view: 'admin', page: 1 }, false)).rejects.toThrow(
      'FORBIDDEN',
    );
  });
  it('does not allow a requesting party larger than the existing booking limit', () => {
    expect(
      requestSchema.safeParse({
        originPlaceId: 'a',
        destinationPlaceId: 'b',
        departureAfter: '2026-10-01T12:00:00Z',
        departureBefore: '2026-10-01T12:00:00Z',
        seats: 5,
      }).success,
    ).toBe(false);
  });
});
