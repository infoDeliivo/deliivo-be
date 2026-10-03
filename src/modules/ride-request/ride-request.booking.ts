import { Prisma } from '@prisma/client';
import { generateBookingOtp, hashOtp } from '../ride-booking/booking-otp.utils.js';
import { REQUEST_CHECKOUT_MS } from './ride-request.policy.js';
import { assertDriverHasNoOverlappingRide } from '../publish-ride/draft-ride.service.js';
import { bookingOtpExpiries } from '../ride-booking/booking-otp-expiry.js';
import { ensureRequestPayment } from './ride-request.payment.js';

export async function reserveRequestOffer(
  tx: Prisma.TransactionClient,
  offerId: string,
  riderId: string,
  rideId: string,
  seats: number,
) {
  const offer = await tx.rideRequestOffer.findUnique({
    where: { id: offerId },
    include: { request: true, ride: true },
  });
  const now = new Date();
  if (
    !offer ||
    offer.rideId !== rideId ||
    offer.request.riderId !== riderId ||
    offer.request.seats !== seats ||
    offer.status !== 'OPEN' ||
    offer.expiresAt <= now
  )
    throw new Error('OFFER_UNAVAILABLE');
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${offer.driverId} FOR UPDATE`;
  await assertDriverHasNoOverlappingRide(
    offer.driverId,
    offer.ride.departureDate,
    offer.ride.departureTime,
    offer.ride.routeDurationSeconds,
    tx,
    offer.rideId,
  );
  const changed = await tx.rideRequest.updateMany({
    where: { id: offer.requestId, riderId, status: 'OPEN', expiresAt: { gt: now } },
    data: {
      status: 'CHECKOUT_PENDING',
      checkoutExpiresAt: new Date(
        Math.min(now.getTime() + REQUEST_CHECKOUT_MS, offer.expiresAt.getTime()),
      ),
    },
  });
  if (changed.count !== 1) throw new Error('REQUEST_ALREADY_SELECTED');
  const selected = await tx.rideRequestOffer.updateMany({
    where: { id: offerId, status: 'OPEN' },
    data: { status: 'SELECTED' },
  });
  if (selected.count !== 1) throw new Error('OFFER_UNAVAILABLE');
}

/** Runs in the same transaction as payment confirmation, never from client input. */
export async function confirmRequestBooking(tx: Prisma.TransactionClient, bookingId: string) {
  const offer = await tx.rideRequestOffer.findUnique({
    where: { bookingId },
    include: { request: true, ride: true, booking: true },
  });
  if (!offer) return null;
  if (offer.status !== 'SELECTED' || offer.request.status !== 'CHECKOUT_PENDING')
    throw new Error('REQUEST_PAYMENT_REQUIRES_RECONCILIATION');
  const now = new Date();
  const departure = new Date(
    `${offer.ride.departureDate.toISOString().slice(0, 10)}T${offer.ride.departureTime}:00Z`,
  );
  if (departure <= now) throw new Error('REQUEST_PAYMENT_REQUIRES_RECONCILIATION');
  if (!offer.booking) throw new Error('REQUEST_BOOKING_NOT_FOUND');
  if (offer.booking.stripePaymentIntentId) await ensureRequestPayment(tx, offer.booking);
  const pickupOtp = generateBookingOtp();
  const dropOtp = generateBookingOtp();
  await tx.rideBooking.update({
    where: { id: bookingId },
    data: {
      status: 'CONFIRMED',
      driverDecisionAt: now,
      driverDecisionDeadlineAt: null,
      pickupOtp,
      dropOtp,
      pickupOtpHash: hashOtp(pickupOtp),
      dropOtpHash: hashOtp(dropOtp),
      ...bookingOtpExpiries(offer.ride, now),
      otpAttemptCount: 0,
    },
  });
  await tx.ride.update({ where: { id: offer.rideId }, data: { status: 'PUBLISHED' } });
  await tx.rideRequestOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED' } });
  await tx.rideRequest.update({
    where: { id: offer.requestId },
    data: { status: 'MATCHED', checkoutExpiresAt: null },
  });
  await tx.rideRequestOffer.updateMany({
    where: { requestId: offer.requestId, status: 'OPEN' },
    data: { status: 'CLOSED' },
  });
  return offer;
}
