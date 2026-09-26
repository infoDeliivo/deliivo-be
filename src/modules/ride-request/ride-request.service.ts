import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/index.js';
import { googleService } from '../maps/google.service.js';
import { assertDriverCanPublish } from '../publish-ride/driver-eligibility.service.js';
import {
  validateBalticPlace,
  validateEuropeanDestinationPlace,
  assertDriverHasNoOverlappingRide,
  detectBlockedRoute,
} from '../publish-ride/draft-ride.service.js';
import { validateAndSnapshotPricing } from '../pricing/pricing.service.js';
import { createNotification } from '../notification/notification.service.js';
import { calculateAgeYears, MINIMUM_BOOKING_AGE_YEARS } from '../../utils/age.js';
import {
  createBooking,
  getBookingById,
  applyStripePaymentSucceededToBooking,
  calculateBookingPrice,
} from '../ride-booking/ride-booking.service.js';
import { cancelPaymentIntent, getStripeClient } from '../payments/stripe.service.js';
import { releaseSegmentSeats } from '../ride-booking/segment-capacity.utils.js';
import { assertRequestWindow, assertOfferFits } from './ride-request.policy.js';
import { ensureRequestPayment } from './ride-request.payment.js';

export const requestSchema = z.object({
  originPlaceId: z.string().min(1).max(255),
  destinationPlaceId: z.string().min(1).max(255),
  departureAfter: z.string().datetime(),
  departureBefore: z.string().datetime(),
  seats: z.number().int().min(1).max(4),
  luggage: z.number().int().min(0).max(10).default(0),
  budgetPerSeat: z.number().positive().max(1000).optional(),
  notes: z.string().trim().max(500).default(''),
});
export const offerSchema = z.object({
  vehicleId: z.string().uuid(),
  departureAt: z.string().datetime(),
  totalSeats: z.number().int().min(1).max(8),
  pricePerSeat: z
    .number()
    .positive()
    .max(1000)
    .refine(
      (n) => Math.abs(n * 100 - Math.round(n * 100)) < 0.00001,
      'Use at most two decimal places.',
    ),
  expiresInHours: z.number().int().min(1).max(48).default(24),
  acceptsSharedJourney: z.literal(true),
});
const person = { id: true, firstName: true, avatarUrl: true } as const;
const offerInclude = {
  driver: { select: person },
  ride: {
    include: { vehicle: { select: { id: true, brand: true, model_name: true, color: true } } },
  },
} satisfies Prisma.RideRequestOfferInclude;

async function notify(userId: string, requestId: string, title: string, body: string) {
  try {
    await createNotification({
      userId,
      type: 'ride_request.updated',
      title,
      body,
      data: { requestId, deepLink: `app://ride-requests/${requestId}` },
    });
  } catch (error) {
    console.warn('Ride request notification failed', error);
  }
}

async function assertActiveUser(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (
    !user ||
    user.isBanned ||
    !user.tosAcceptedAt ||
    !user.privacyAcceptedAt ||
    !user.dob ||
    calculateAgeYears(user.dob) < MINIMUM_BOOKING_AGE_YEARS
  ) {
    throw new Error('Complete your profile and accept the terms before using ride requests.');
  }
}

export async function createRequest(riderId: string, input: z.infer<typeof requestSchema>) {
  await assertActiveUser(riderId);
  const departureAfter = new Date(input.departureAfter),
    departureBefore = new Date(input.departureBefore);
  assertRequestWindow(departureAfter, departureBefore);
  if (input.originPlaceId === input.destinationPlaceId)
    throw new Error('Choose different pickup and destination locations.');
  await validateBalticPlace(input.originPlaceId);
  await validateEuropeanDestinationPlace(input.destinationPlaceId);
  const origin = await googleService.placeDetails(input.originPlaceId);
  const destination = await googleService.placeDetails(input.destinationPlaceId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${riderId} FOR UPDATE`;
    const count = await tx.rideRequest.count({
      where: {
        riderId,
        status: { in: ['OPEN', 'CHECKOUT_PENDING'] },
        expiresAt: { gt: new Date() },
      },
    });
    if (count >= 5) throw new Error('You can have up to five open requests.');
    return tx.rideRequest.create({
      data: {
        ...input,
        riderId,
        departureAfter,
        departureBefore,
        expiresAt: new Date(departureAfter.getTime() - 30 * 60000),
        originAddress: origin.formatted_address,
        originLat: origin.geometry.location.lat,
        originLng: origin.geometry.location.lng,
        destinationAddress: destination.formatted_address,
        destinationLat: destination.geometry.location.lat,
        destinationLng: destination.geometry.location.lng,
      },
    });
  });
}

export async function listRequests(
  userId: string,
  query: {
    view: 'browse' | 'mine' | 'offers' | 'admin';
    page: number;
    from?: string;
    to?: string;
    date?: string;
    seats?: number;
  },
  admin = false,
) {
  if (query.view === 'admin' && !admin) throw new Error('FORBIDDEN');
  const where: Prisma.RideRequestWhereInput = {
    ...(query.view === 'mine'
      ? { riderId: userId }
      : query.view === 'offers'
        ? { offers: { some: { driverId: userId } } }
        : query.view === 'admin'
          ? {}
          : {
              status: 'OPEN',
              expiresAt: { gt: new Date() },
              riderId: { not: userId },
              rider: { isBanned: false },
              NOT: {
                OR: [
                  { rider: { blocksInitiated: { some: { blockedId: userId } } } },
                  { rider: { blocksReceived: { some: { blockerId: userId } } } },
                ],
              },
            }),
    ...(query.from ? { originAddress: { contains: query.from, mode: 'insensitive' } } : {}),
    ...(query.to ? { destinationAddress: { contains: query.to, mode: 'insensitive' } } : {}),
    ...(query.date
      ? {
          departureAfter: {
            gte: new Date(query.date),
            lt: new Date(new Date(query.date).getTime() + 86400000),
          },
        }
      : {}),
    ...(query.seats ? { seats: { lte: query.seats } } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.rideRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * 20,
      take: 20,
      select: {
        id: true,
        riderId: true,
        rider: { select: person },
        originAddress: true,
        destinationAddress: true,
        departureAfter: true,
        departureBefore: true,
        seats: true,
        luggage: true,
        budgetPerSeat: true,
        status: true,
        expiresAt: true,
        _count: {
          select: { offers: { where: { status: 'OPEN', expiresAt: { gt: new Date() } } } },
        },
      },
    }),
    prisma.rideRequest.count({ where }),
  ]);
  return {
    items: items.map((item) => ({
      ...item,
      originAddress: item.originAddress.split(',')[0],
      destinationAddress: item.destinationAddress.split(',')[0],
      status: item.status === 'OPEN' && item.expiresAt < new Date() ? 'EXPIRED' : item.status,
    })),
    total,
    page: query.page,
    totalPages: Math.max(1, Math.ceil(total / 20)),
  };
}

export async function requestDetails(id: string, userId: string, admin = false) {
  const request = await prisma.rideRequest.findUnique({
    where: { id },
    include: {
      rider: { select: person },
      offers: { include: offerInclude, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!request) throw new Error('NOT_FOUND');
  const owner = request.riderId === userId;
  const ownOffers = request.offers.filter((offer) => offer.driverId === userId);
  if (!owner && !admin) {
    const blocked = await prisma.userBlock.count({
      where: {
        OR: [
          { blockerId: userId, blockedId: request.riderId },
          { blockerId: request.riderId, blockedId: userId },
        ],
      },
    });
    if (blocked || (request.status !== 'OPEN' && !ownOffers.length)) throw new Error('NOT_FOUND');
  }
  return {
    ...request,
    isOwner: owner,
    status:
      request.status === 'OPEN' && request.expiresAt < new Date() ? 'EXPIRED' : request.status,
    offers: (owner || admin ? request.offers : ownOffers).map((offer) => ({
      ...offer,
      status: offer.status === 'OPEN' && offer.expiresAt < new Date() ? 'EXPIRED' : offer.status,
      price: calculateBookingPrice(
        offer.ride.basePricePerSeat,
        request.seats,
        request.luggage,
        offer.ride.currency,
      ),
    })),
  };
}

export async function createOffer(
  requestId: string,
  driverId: string,
  input: z.infer<typeof offerSchema>,
) {
  await assertActiveUser(driverId);
  await assertDriverCanPublish(driverId, input.vehicleId);
  const request = await requestDetails(requestId, driverId);
  if (request.riderId === driverId || request.status !== 'OPEN' || request.expiresAt <= new Date())
    throw new Error('REQUEST_UNAVAILABLE');
  const departure = new Date(input.departureAt);
  assertRequestWindow(departure, departure);
  assertOfferFits(request, departure, input.totalSeats);
  const routeOptions = await googleService.computeMultiRoute({
    origin: { latitude: request.originLat, longitude: request.originLng },
    destination: { latitude: request.destinationLat, longitude: request.destinationLng },
    travelMode: 'DRIVE',
  });
  const route = routeOptions[0];
  if (!detectBlockedRoute(route).isPublishable) throw new Error('NON_ROAD_ROUTE_NOT_ALLOWED');
  const duration = Number.parseInt(route?.duration ?? '', 10);
  if (
    !route?.polyline?.encodedPolyline ||
    !route.distanceMeters ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new Error('A drivable route could not be calculated.');
  const departureDate = new Date(`${input.departureAt.slice(0, 10)}T00:00:00Z`),
    departureTime = departure.toISOString().slice(11, 16);
  const offer = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "RideRequest" WHERE "id" = ${requestId} FOR UPDATE`;
    const current = await tx.rideRequest.findUnique({ where: { id: requestId } });
    if (!current || current.status !== 'OPEN' || current.expiresAt <= new Date())
      throw new Error('REQUEST_UNAVAILABLE');
    if (
      await tx.rideRequestOffer.count({
        where: { requestId, driverId, status: 'OPEN', expiresAt: { gt: new Date() } },
      })
    )
      throw new Error('Withdraw your existing offer before sending another.');
    await assertDriverHasNoOverlappingRide(driverId, departureDate, departureTime, duration, tx);
    const ride = await tx.ride.create({
      data: {
        driverId,
        vehicleId: input.vehicleId,
        originPlaceId: request.originPlaceId,
        originAddress: request.originAddress,
        originLat: request.originLat,
        originLng: request.originLng,
        destinationPlaceId: request.destinationPlaceId,
        destinationAddress: request.destinationAddress,
        destinationLat: request.destinationLat,
        destinationLng: request.destinationLng,
        departureDate,
        departureTime,
        totalSeats: input.totalSeats,
        availableSeats: input.totalSeats,
        basePricePerSeat: input.pricePerSeat,
        currency: 'EUR',
        maxLuggagePerPerson: Math.ceil(request.luggage / request.seats),
        routePolyline: route.polyline.encodedPolyline,
        routeDistanceMeters: route.distanceMeters,
        routeDurationSeconds: duration,
        status: 'DRAFT',
        notes:
          'Shared ride arranged from a rider request. The journey does not depend on additional riders joining.',
        segmentCapacity: { create: { fromPosition: 0, toPosition: 1, occupiedSeats: 0 } },
      },
    });
    const pricing = await validateAndSnapshotPricing({
      rideId: ride.id,
      distanceKm: route.distanceMeters / 1000,
      selectedPricePerSeat: input.pricePerSeat,
      tx,
    });
    if (!pricing.valid) throw new Error(pricing.reason || 'PRICE_OUT_OF_RANGE');
    return tx.rideRequestOffer.create({
      data: {
        requestId,
        driverId,
        rideId: ride.id,
        expiresAt: new Date(
          Math.min(request.expiresAt.getTime(), Date.now() + input.expiresInHours * 3600000),
        ),
      },
      include: offerInclude,
    });
  });
  await notify(
    request.riderId,
    requestId,
    'New driver offer',
    'A driver offered your requested ride. Review the vehicle, schedule and total before paying.',
  );
  return offer;
}

export async function checkoutOffer(offerId: string, riderId: string) {
  const offer = await prisma.rideRequestOffer.findUnique({
    where: { id: offerId },
    include: { request: true, ride: true },
  });
  if (!offer || offer.request.riderId !== riderId) throw new Error('NOT_FOUND');
  if (offer.bookingId && ['SELECTED', 'ACCEPTED'].includes(offer.status)) {
    const booking = await getBookingById(riderId, offer.bookingId);
    if (!booking) throw new Error('NOT_FOUND');
    if (offer.status === 'SELECTED' && offer.request.checkoutExpiresAt! <= new Date())
      throw new Error('Checkout expired. Refresh after the reservation is released.');
    const row = await prisma.rideBooking.findUnique({ where: { id: offer.bookingId } });
    if (row?.stripePaymentIntentId && row.status === 'PAYMENT_PENDING') {
      const intent = await getStripeClient().paymentIntents.retrieve(row.stripePaymentIntentId);
      if (intent.status === 'succeeded') {
        await applyStripePaymentSucceededToBooking(intent);
        return getBookingById(riderId, offer.bookingId);
      }
      await ensureRequestPayment(prisma, row);
      return {
        ...booking,
        payment: {
          provider: 'stripe',
          clientSecret: intent.client_secret,
          paymentIntentId: intent.id,
          currency: intent.currency,
        },
      };
    }
    return booking;
  }
  await assertActiveUser(riderId);
  await assertActiveUser(offer.driverId);
  await assertDriverCanPublish(offer.driverId, offer.ride.vehicleId!);
  return createBooking(
    riderId,
    { rideId: offer.rideId, seatsBooked: offer.request.seats, luggageCount: offer.request.luggage },
    offerId,
  );
}

export async function closeRequest(id: string, userId: string, admin = false) {
  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.rideRequest.updateMany({
      where: { id, ...(admin ? {} : { riderId: userId }), status: 'OPEN' },
      data: { status: 'CANCELLED' },
    });
    if (!updated.count)
      throw new Error(
        'Only an open request can be cancelled. For a confirmed journey, cancel the booking instead.',
      );
    await tx.rideRequestOffer.updateMany({
      where: { requestId: id, status: 'OPEN' },
      data: { status: 'CLOSED' },
    });
    return { cancelled: true };
  });
  return result;
}

export async function withdrawOffer(id: string, driverId: string) {
  const updated = await prisma.rideRequestOffer.updateMany({
    where: { id, driverId, status: 'OPEN' },
    data: { status: 'WITHDRAWN' },
  });
  if (!updated.count) throw new Error('This offer is already selected or closed.');
  return { withdrawn: true };
}

/** Never release a payment reservation until Stripe proves the intent cannot succeed. */
export async function expireRequestCheckouts() {
  const now = new Date();
  const pending = await prisma.rideRequestOffer.findMany({
    where: { status: 'SELECTED', request: { checkoutExpiresAt: { lte: now } } },
    include: { booking: { include: { payment: true, ride: true } } },
    take: 100,
  });
  for (const offer of pending) {
    try {
      const booking = offer.booking;
      const intentId = booking?.stripePaymentIntentId || booking?.payment?.stripePaymentIntentId;
      if (intentId) {
        const intent = await getStripeClient().paymentIntents.retrieve(intentId);
        if (intent.status === 'succeeded') {
          await applyStripePaymentSucceededToBooking(intent);
          continue;
        }
        if (intent.status !== 'canceled') await cancelPaymentIntent(intentId);
      }
      await prisma.$transaction(async (tx) => {
        if (booking) {
          const updated = await tx.rideBooking.updateMany({
            // Initialization can link an intent after the scan. Only release the
            // exact payment snapshot reconciled above; otherwise retry next pass.
            where: {
              id: booking.id,
              status: 'PAYMENT_PENDING',
              stripePaymentIntentId: booking.stripePaymentIntentId,
              payment: booking.payment
                ? {
                    is: {
                      id: booking.payment.id,
                      stripePaymentIntentId: booking.payment.stripePaymentIntentId,
                    },
                  }
                : { is: null },
            },
            data: {
              status: 'CANCELLED',
              cancelledAt: now,
              cancellationReason: 'Ride request checkout expired',
            },
          });
          if (updated.count)
            await releaseSegmentSeats(tx, {
              rideId: booking.rideId,
              seatsBooked: booking.seatsBooked,
              pickupPosition: booking.pickupPosition,
              dropoffPosition: booking.dropoffPosition,
              totalSeats: booking.ride.totalSeats,
            });
          else if (!['PAYMENT_FAILED', 'CANCELLED'].includes(booking.status)) return;
        }
        const expired = await tx.rideRequestOffer.updateMany({
          where: { id: offer.id, status: 'SELECTED' },
          data: { status: 'EXPIRED' },
        });
        if (!expired.count) return;
        await tx.ride.update({ where: { id: offer.rideId }, data: { status: 'CANCELLED' } });
        await tx.rideRequest.updateMany({
          where: { id: offer.requestId, status: 'CHECKOUT_PENDING' },
          data: { status: 'OPEN', checkoutExpiresAt: null },
        });
      });
    } catch (error) {
      console.warn('Request checkout reconciliation will retry', { offerId: offer.id, error });
    }
  }
  await prisma.rideRequest.updateMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  await prisma.rideRequestOffer.updateMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
}
