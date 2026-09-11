// @ts-ignore - stripe v21 types bundled via package exports; not resolved by "Node" moduleResolution
import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { BookingStatus, Prisma, RideStatus } from '@prisma/client';
import { prisma } from '../../config/index.js';
import {
    buildSegmentPoints,
    resolveSegmentView,
    SegmentPointRef,
    SegmentRide,
} from '../search-ride/segment-view.utils.js';
import { decodeViewToken } from '../search-ride/view-token.utils.js';
import {
    cancelPaymentIntent,
    createBookingPaymentIntent,
    getStripeClient,
    refundPaymentIntent,
} from '../payments/stripe.service.js';
import { createNotification } from '../notification/notification.service.js';
import { DRIVER_DECISION_NOTIFICATION_TYPE, DRIVER_DECISION_WINDOW_MS } from '../payments/stripe.constants.js';
import {
    bookingPaymentWindowMs,
    enqueueDeadlineCheck,
    enqueuePaymentExpiryCheck,
    reschedulePaymentExpiryCheck,
} from '../../queue/deadline.queue.js';
import { calculateDeadline, EXPIRY_OPTIONS } from './request-expiry.utils.js';
import {
    CancelBookingResult,
    CreateBookingInput,
    BookingListResponse,
    BookingPaymentInfo,
    BookingResponse,
    ListBookingsQuery,
    PriceBreakdown,
    PricePreviewInput,
    PricePreviewResponse,
} from './ride-booking.types.js';
import {
    getRiderRefundAmount,
    getRiderRefundPercent,
    isConfirmedCancellationWindowClosed,
    toMinorCurrencyUnits,
} from './booking-cancellation-policy.js';
import { calculateBookingPrice, MAX_SEATS_PER_BOOKING } from './booking-price.js';
import { resolvePaymentSplit } from './booking-payment-split.js';
import { resolveRideFeeTerms, type ServiceFeeTerms } from '../pricing/pricing.service.js';
import { recordProviderFeeExpense } from '../ledger/ledger.service.js';
import { isBypassBookingPaymentMode } from './booking-payment-mode.js';
import { releaseBookingSeats } from './segment-capacity.utils.js';
import {
    createPayment,
    markBookingPaymentPaid,
    markBookingPaymentRefunded,
    markPaymentPaid,
    PAYMENT_STATUSES,
} from '../payments/payment.service.js';
import { emitToUsers } from '../../socket/index.js';
import { calculateAgeYears, MINIMUM_BOOKING_AGE_YEARS } from '../../utils/age.js';
import { formatBookingReference } from '../../utils/booking-reference.js';
import { isBookingWindowClosed } from './booking-window.js';
import { logError } from '../../utils/logger.js';

type RideWaypointDetails = {
    id: string;
    placeId: string;
    address: string;
    lat: number;
    lng: number;
    waypointType: string;
    orderIndex: number;
    pricePerSeat: number | null;
    estimatedArrivalTime: string | null;
};

type RideWithDetails = {
    id: string;
    driverId: string;
    status?: RideStatus;
    originPlaceId: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationPlaceId: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    routePolyline: string | null;
    routeDistanceMeters: number | null;
    routeDurationSeconds: number | null;
    departureDate: Date;
    departureTime: string;
    totalSeats: number;
    availableSeats: number;
    basePricePerSeat: number;
    currency: string;
    driver: {
        id: string;
        firstName: string | null;
        avatarUrl: string | null;
    };
    vehicle?: {
        id: string;
        brand: string | null;
        model_num: string | null;
        model_name: string | null;
        type: string | null;
        color: string | null;
        year: number | null;
        imageUrl: string | null;
        isVerified: boolean;
    } | null;
    waypoints?: RideWaypointDetails[];
};

type BookingWithRideDetails = {
    id: string;
    rideId: string;
    passengerId: string;
    seatsBooked: number;
    totalPrice: number;
    status: BookingStatus;
    pickupWaypointId: string | null;
    dropoffWaypointId: string | null;
    createdAt: Date;
    updatedAt: Date;
    stripePaymentIntentId: string | null;
    paymentCurrency: string | null;
    ride: RideWithDetails;
    ratings?: Array<{
        id: string;
        stars: number;
        reviewText: string | null;
        createdAt: Date;
    }>;
};

/**
 * A rider may hold only one booking in these statuses per ride.
 *
 * Mirrored by the partial unique index `RideBooking_active_rider_ride_key`
 * (prisma/migrations/20260910120000_ride_booking_active_unique) — keep both lists
 * in sync, or concurrent requests will fail in a way the API cannot explain.
 *
 * PAYMENT_PENDING is deliberately absent: an unpaid booking holds no seats and must
 * not lock the rider out of the ride. Booking that ride again resumes or replaces the
 * unpaid one — see `resolvePendingBookingReentry`.
 */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.IN_PROGRESS,
];

/**
 * Withdrawing is "take my request back": allowed while the driver has not answered, and
 * while the rider has not paid. The unpaid case is why the webapp's Withdraw button on a
 * PAYMENT_PENDING booking used to 404.
 */
const WITHDRAWABLE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
];

const CANCELLABLE_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.PAYMENT_PENDING,
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
];


const validateBookingSeats = (seatsBooked: number) => {
    if (seatsBooked < 1) {
        throw new Error('MINIMUM_ONE_SEAT_REQUIRED');
    }

    if (seatsBooked > MAX_SEATS_PER_BOOKING) {
        throw new Error('MAXIMUM_SEATS_EXCEEDED');
    }
};

const toMajorUnits = (amountMinor: number | null | undefined): number | null => {
    if (typeof amountMinor !== 'number') return null;
    return Number((amountMinor / 100).toFixed(2));
};

/**
 * Records what Stripe charged us to process a payment, from the charge's balance transaction.
 *
 * The platform is merchant of record here (no destination charges), so this cost is ours and was
 * previously missing from the ledger entirely — the STRIPE_FEE_EXPENSE entry type existed but was
 * never written. Best-effort by design: the payment design document says "stored when available from
 * provider balance transaction", and a bookkeeping gap must never fail a webhook that already took
 * the rider's money.
 */
const recordProviderFeeForIntent = async (intent: Stripe.PaymentIntent, bookingId: string) => {
    try {
        const payment = await prisma.payment.findFirst({
            where: { bookingId },
            select: { id: true, currency: true },
        });
        if (!payment) return;

        const chargeId =
            typeof intent.latest_charge === 'string' ? intent.latest_charge : intent.latest_charge?.id;
        if (!chargeId) return;

        const stripe = getStripeClient();
        const charge = await stripe.charges.retrieve(chargeId, { expand: ['balance_transaction'] });
        const balanceTransaction = charge.balance_transaction;
        if (!balanceTransaction || typeof balanceTransaction === 'string') return;

        await recordProviderFeeExpense({
            paymentId: payment.id,
            bookingId,
            feeAmount: balanceTransaction.fee / 100,
            currency: (balanceTransaction.currency || payment.currency).toUpperCase(),
        });
    } catch (error) {
        logError('Could not record Stripe processing fee for booking', error, { bookingId });
    }
};

/**
 * Cancels the PaymentIntent behind a booking that was abandoned before payment.
 *
 * Best-effort: the booking is already in its terminal state by the time this runs, so a
 * Stripe failure must not undo that. It is logged instead, because the consequence of a
 * missed cancellation is a live intent that could still capture money.
 */
const releaseUnpaidPaymentIntent = async (bookingId: string, paymentIntentId: string): Promise<void> => {
    try {
        await cancelPaymentIntent(paymentIntentId);
    } catch (error) {
        logError('Could not cancel the PaymentIntent of an unpaid booking', error, {
            bookingId,
            paymentIntentId,
        });
    }
};

/**
 * The rider paid, but by the time the payment landed the ride had no seats left.
 *
 * Unpaid bookings hold no seats, which is what lets two riders race for the last one.
 * The loser must not be left out of pocket, so the money goes straight back and the
 * booking gets its own terminal status — RIDE_FULL_REFUNDED rather than PAYMENT_FAILED,
 * because money did move here and support needs to tell the two cases apart.
 */
const refundRideFullPayment = async (bookingId: string, intent: Stripe.PaymentIntent): Promise<void> => {
    // Claim the booking first, so a concurrent confirm/webhook cannot refund twice.
    const claimed = await prisma.rideBooking.updateMany({
        where: { id: bookingId, status: BookingStatus.PAYMENT_PENDING },
        data: {
            status: BookingStatus.RIDE_FULL_REFUNDED,
            stripePaymentIntentId: intent.id,
            paymentCapturedAt: new Date(),
            refundPercent: 100,
        },
    });

    if (claimed.count === 0) return;

    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    originAddress: true,
                    destinationAddress: true,
                },
            },
        },
    });

    if (!booking) return;

    const refundAmount = booking.paymentAmount ?? booking.totalPrice;

    try {
        await refundPaymentIntent(intent.id, toMinorCurrencyUnits(refundAmount));
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { refundedAt: new Date(), refundAmount },
        });
    } catch (error) {
        // The rider is owed money and the API call failed. Record it loudly: this needs
        // a human, and reconciliation is where unresolved payment issues are picked up.
        logError('Ride filled up after payment but the refund could not be issued', error, {
            bookingId,
            paymentIntentId: intent.id,
            refundAmount,
        });

        try {
            await prisma.reconciliationIssue.create({
                data: {
                    bookingId,
                    issueType: 'STRIPE_MISMATCH',
                    severity: 'CRITICAL',
                    description: 'Ride was full when payment succeeded; automatic refund failed',
                    stripeState: intent.status,
                    internalState: BookingStatus.RIDE_FULL_REFUNDED,
                },
            });
        } catch (issueError) {
            logError('Failed to record reconciliation issue for a failed ride-full refund', issueError, {
                bookingId,
            });
        }
    }

    try {
        // Money in, then money out — the ledger has to show both legs.
        await markBookingPaymentPaid(bookingId, booking.ride.driverId);
        await markBookingPaymentRefunded(bookingId, booking.ride.driverId, refundAmount);
    } catch (error) {
        logError('Ride-full refund issued but local payment state sync failed', error, { bookingId });
    }

    try {
        await createNotification({
            userId: booking.passengerId,
            type: 'booking.ride_full_refunded',
            title: 'Ride filled up',
            body: 'The last seat went while your payment was going through. You have not been charged — the refund is on its way.',
            data: {
                bookingId,
                rideId: booking.ride.id,
                status: BookingStatus.RIDE_FULL_REFUNDED,
                originAddress: booking.ride.originAddress,
                destinationAddress: booking.ride.destinationAddress,
                refundAmount: String(refundAmount),
                deepLink: `app://booking/${bookingId}`,
            },
        });
    } catch (error) {
        logError('Ride-full refund notification failed', error, { bookingId });
    }
};

export const applyStripePaymentSucceededToBooking = async (intent: Stripe.PaymentIntent) => {
    const bookingId = intent.metadata?.bookingId;
    if (!bookingId) return false;

    const latestChargeId = typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : intent.latest_charge?.id ?? null;
    const capturedAmount = intent.amount_received > 0 ? intent.amount_received : intent.amount;
    const now = new Date();
    const fallbackDecisionDeadlineAt = new Date(now.getTime() + DRIVER_DECISION_WINDOW_MS);

    // The seats are taken here, not when the booking was created: an unpaid booking
    // holds nothing. Status flip and reservation share one transaction, so a ride that
    // filled up in the meantime rolls the whole thing back instead of overselling.
    let claimed: 'CLAIMED' | 'ALREADY_APPLIED' | 'RIDE_FULL';
    try {
        claimed = await prisma.$transaction(async (tx) => {
            const updateResult = await tx.rideBooking.updateMany({
                where: {
                    id: bookingId,
                    status: BookingStatus.PAYMENT_PENDING,
                },
                data: {
                    status: BookingStatus.DRIVER_PENDING,
                    stripePaymentIntentId: intent.id,
                    stripeChargeId: latestChargeId,
                    paymentAmount: toMajorUnits(capturedAmount),
                    paymentCurrency: intent.currency.toUpperCase(),
                    paymentCapturedAt: now,
                    seatsReservedAt: now,
                    driverDecisionDeadlineAt: fallbackDecisionDeadlineAt,
                },
            });

            // Not in PAYMENT_PENDING: the webhook and the confirm endpoint both land
            // here, so whichever arrives second is a no-op. This guard is what makes
            // the whole path idempotent — do not weaken it.
            if (updateResult.count === 0) {
                return 'ALREADY_APPLIED';
            }

            const reserving = await tx.rideBooking.findUniqueOrThrow({
                where: { id: bookingId },
                select: {
                    rideId: true,
                    seatsBooked: true,
                    pickupPosition: true,
                    dropoffPosition: true,
                    ride: { select: { totalSeats: true } },
                },
            });

            await reserveSeatsForBooking(tx, {
                rideId: reserving.rideId,
                totalSeats: reserving.ride.totalSeats,
                seatsBooked: reserving.seatsBooked,
                pickupPosition: reserving.pickupPosition,
                dropoffPosition: reserving.dropoffPosition,
            });

            return 'CLAIMED';
        }, BOOKING_TRANSACTION_OPTIONS);
    } catch (error) {
        if (error instanceof Error && error.message === 'INSUFFICIENT_SEATS') {
            claimed = 'RIDE_FULL';
        } else {
            throw error;
        }
    }

    if (claimed === 'ALREADY_APPLIED') {
        return false;
    }

    if (claimed === 'RIDE_FULL') {
        // We hold the rider's money for a ride they cannot travel on. Give it back.
        // Runs outside the transaction above, which has already rolled back.
        await refundRideFullPayment(bookingId, intent);
        return false;
    }

    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            passenger: {
                select: {
                    firstName: true,
                    avatarUrl: true,
                },
            },
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    originAddress: true,
                    destinationAddress: true,
                    departureDate: true,
                    departureTime: true,
                    currency: true,
                    waypoints: {
                        select: {
                            id: true,
                            address: true,
                        },
                    },
                },
            },
        },
    });

    if (!booking) {
        return true;
    }

    const departureAt = combineDepartureDateTimeUtc(
        booking.ride.departureDate,
        booking.ride.departureTime
    );
    const { deadlineAt: decisionDeadlineAt, expiryHours } = calculateDeadline(
        booking.responseExpiryOption ?? undefined,
        departureAt,
        now
    );

    await prisma.rideBooking.update({
        where: { id: booking.id },
        data: {
            driverDecisionDeadlineAt: decisionDeadlineAt,
            responseExpiryHours: expiryHours,
        },
    });

    await recordProviderFeeForIntent(intent, booking.id);

    try {
        await markBookingPaymentPaid(booking.id, booking.ride.driverId);
    } catch (error) {
        // The booking now reads as paid while its Payment row does not. Record it so
        // hourly reconciliation repairs the payment state instead of leaving the two
        // state machines out of step forever.
        logError('Booking moved to DRIVER_PENDING but local payment state sync failed', error, {
            bookingId: booking.id,
            paymentIntentId: intent.id,
        });

        try {
            await prisma.reconciliationIssue.create({
                data: {
                    bookingId: booking.id,
                    issueType: 'MISSING_WEBHOOK',
                    severity: 'HIGH',
                    description: 'Booking advanced on Stripe success but Payment.status was not updated',
                    stripeState: intent.status,
                    internalState: PAYMENT_STATUSES.PAYMENT_PENDING,
                },
            });
        } catch (issueError) {
            logError('Failed to record reconciliation issue for payment state drift', issueError, {
                bookingId: booking.id,
            });
        }
    }

    const originAddress = resolveSegmentAddress(
        booking.ride.originAddress,
        booking.pickupWaypointId,
        booking.ride.waypoints
    );
    const destinationAddress = resolveSegmentAddress(
        booking.ride.destinationAddress,
        booking.dropoffWaypointId,
        booking.ride.waypoints
    );

    try {
        await createNotification({
            userId: booking.ride.driverId,
            type: DRIVER_DECISION_NOTIFICATION_TYPE,
            title: 'New ride request',
            body: `${booking.passenger.firstName ?? 'Rider'} wants ${originAddress} to ${destinationAddress}`,
            data: {
                bookingId: booking.id,
                rideId: booking.ride.id,
                passengerName: booking.passenger.firstName ?? 'Rider',
                passengerAvatarUrl: booking.passenger.avatarUrl ?? '',
                originAddress,
                destinationAddress,
                seatsBooked: String(booking.seatsBooked),
                totalPrice: String(booking.totalPrice),
                currency: booking.paymentCurrency ?? booking.ride.currency,
                decisionDeadlineAt: decisionDeadlineAt.toISOString(),
                decisionTimeRemainingSeconds: String(
                    Math.max(0, Math.floor((decisionDeadlineAt.getTime() - Date.now()) / 1000))
                ),
                deepLink: `app://driver/booking-request/${booking.id}`,
            },
        });

        await createNotification({
            userId: booking.passengerId,
            type: 'booking.request.sent',
            title: 'Booking request sent',
            body: 'Payment received. Your request was sent to the driver.',
            data: {
                bookingId: booking.id,
                rideId: booking.ride.id,
                status: BookingStatus.DRIVER_PENDING,
                originAddress,
                destinationAddress,
                departureDate: booking.ride.departureDate.toISOString(),
                departureTime: booking.ride.departureTime,
                decisionDeadlineAt: decisionDeadlineAt.toISOString(),
                deepLink: `app://booking/${booking.id}`,
            },
        });

        await emitToUsers([booking.ride.driverId], 'booking:updated', {
            bookingId: booking.id,
            rideId: booking.ride.id,
            passengerId: booking.passengerId,
            status: BookingStatus.DRIVER_PENDING,
            previousStatus: BookingStatus.PAYMENT_PENDING,
            actor: 'rider',
            action: 'booking.requested',
            updatedAt: new Date().toISOString(),
        });

        const deadlineDelayMs = Math.max(0, decisionDeadlineAt.getTime() - Date.now());
        await enqueueDeadlineCheck(booking.id, deadlineDelayMs);
    } catch (error) {
        logError('Stripe payment success side effects failed after booking was moved to DRIVER_PENDING', error, {
            bookingId: booking.id,
        });
    }

    return true;
};

const mapRideInfo = (ride: RideWithDetails) => ({
    id: ride.id,
    status: ride.status,
    originPlaceId: ride.originPlaceId,
    originAddress: ride.originAddress,
    originLat: ride.originLat,
    originLng: ride.originLng,
    destinationPlaceId: ride.destinationPlaceId,
    destinationAddress: ride.destinationAddress,
    destinationLat: ride.destinationLat,
    destinationLng: ride.destinationLng,
    routePolyline: ride.routePolyline,
    routeDistanceMeters: ride.routeDistanceMeters,
    routeDurationSeconds: ride.routeDurationSeconds,
    departureDate: ride.departureDate,
    departureTime: ride.departureTime,
    totalSeats: ride.totalSeats,
    availableSeats: ride.availableSeats,
    basePricePerSeat: ride.basePricePerSeat,
    currency: ride.currency,
    waypoints: (ride.waypoints || []).map((waypoint) => ({
        id: waypoint.id,
        placeId: waypoint.placeId,
        address: waypoint.address,
        lat: waypoint.lat,
        lng: waypoint.lng,
        waypointType: waypoint.waypointType,
        orderIndex: waypoint.orderIndex,
        pricePerSeat: waypoint.pricePerSeat,
        estimatedArrivalTime: waypoint.estimatedArrivalTime,
    })),
    driver: ride.driver,
    vehicle: ride.vehicle ? {
        id: ride.vehicle.id,
        brand: ride.vehicle.brand,
        model_num: ride.vehicle.model_num,
        model_name: ride.vehicle.model_name,
        type: ride.vehicle.type,
        color: ride.vehicle.color,
        year: ride.vehicle.year,
        imageUrl: ride.vehicle.imageUrl,
        isVerified: ride.vehicle.isVerified,
    } : null,
});

const LEGACY_BOOKING_STATUS_ALIASES: Record<string, BookingStatus> = {
    PENDING: BookingStatus.DRIVER_PENDING,
    ACCEPTED: BookingStatus.CONFIRMED,
    WITHDRAWN: BookingStatus.CANCELLED,
    REJECTED: BookingStatus.CANCELLED,
    EXPIRED: BookingStatus.CANCELLED,
};

const normalizeBookingStatusFilter = (status: unknown): BookingStatus[] => {
    if (!status) return [];
    const validStatuses = new Set(Object.values(BookingStatus));
    return Array.from(new Set(
        String(status)
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => LEGACY_BOOKING_STATUS_ALIASES[item] || item)
            .filter((item): item is BookingStatus => validStatuses.has(item as BookingStatus))
    ));
};

const mapSegmentRideInfo = (
    ride: RideWithDetails,
    pickupWaypointId: string | null,
    dropoffWaypointId: string | null
) => {
    if (!ride.waypoints) {
        return null;
    }

    const pickupRef: SegmentPointRef = pickupWaypointId
        ? `waypoint:${pickupWaypointId}`
        : 'origin';
    const dropRef: SegmentPointRef = dropoffWaypointId
        ? `waypoint:${dropoffWaypointId}`
        : 'destination';

    const rideForSegment: SegmentRide = {
        ...ride,
        waypoints: ride.waypoints,
    };

    const points = buildSegmentPoints(rideForSegment);
    const riderView = resolveSegmentView(rideForSegment, points, pickupRef, dropRef);
    if (!riderView) {
        return null;
    }

    return {
        ...mapRideInfo(ride),
        originPlaceId: riderView.originPlaceId,
        originAddress: riderView.originAddress,
        originLat: riderView.originLat,
        originLng: riderView.originLng,
        destinationPlaceId: riderView.destinationPlaceId,
        destinationAddress: riderView.destinationAddress,
        destinationLat: riderView.destinationLat,
        destinationLng: riderView.destinationLng,
        basePricePerSeat: riderView.basePricePerSeat,
        bookingContext: riderView.bookingContext,
        segment: riderView.segment,
    };
};

/**
 * Rebuilds the rider's price breakdown from the persisted booking row.
 *
 * `getBookingById` and `getMyBookings` map a booking without a breakdown, so a rider revisiting
 * their own booking saw a fare summary with no fee lines at all. With a real service fee that is a
 * receipt defect, so the stored columns are used to reconstruct it. Returns undefined for bookings
 * predating those columns rather than inventing a zero fee.
 */
const reconstructPriceBreakdown = (booking: {
    seatsBooked: number;
    totalPrice: number;
    segmentFare?: number | null;
    serviceFeeAmount?: number | null;
    serviceFeePercent?: number | null;
    paymentCurrency?: string | null;
    ride?: { currency?: string | null } | null;
}): PriceBreakdown | undefined => {
    if (booking.serviceFeeAmount === null || booking.serviceFeeAmount === undefined) {
        return undefined;
    }

    const cents = (value: number) => Math.round(value * 100);
    const subtotalCents = cents(booking.totalPrice) - cents(booking.serviceFeeAmount);
    const seats = booking.seatsBooked > 0 ? booking.seatsBooked : 1;
    // Only the percentage is stored, so the flat component is whatever the charged fee exceeds it by.
    // Reporting a hardcoded 0 made a flat-fee receipt describe terms that could not produce its own
    // total. Both fields are descriptive; `serviceFee` remains the charged amount.
    const serviceFeePercent = booking.serviceFeePercent ?? 0;
    const percentFeeCents = Math.round((subtotalCents * serviceFeePercent) / 100);
    const flatFeeCents = Math.max(0, cents(booking.serviceFeeAmount) - percentFeeCents);

    return {
        basePricePerSeat: booking.segmentFare ?? subtotalCents / 100 / seats,
        seatsBooked: booking.seatsBooked,
        subtotal: subtotalCents / 100,
        luggageFee: 0,
        serviceFee: booking.serviceFeeAmount,
        totalPrice: booking.totalPrice,
        currency: booking.paymentCurrency ?? booking.ride?.currency ?? 'EUR',
        serviceFeePercent,
        serviceFeeFlat: flatFeeCents / 100,
    };
};

const mapBookingResponse = (
    booking: BookingWithRideDetails & { 
        driverDecisionDeadlineAt?: Date | null;
        deadlineExtendedAt?: Date | null;
    },
    options?: {
        luggageCount?: number;
        notes?: string | null;
        payment?: BookingPaymentInfo | null;
        priceBreakdown?: PriceBreakdown;
    }
): BookingResponse => {
    const now = new Date();
    let decisionDeadline = null;

    // Add decision deadline info for DRIVER_PENDING bookings
    if (booking.status === BookingStatus.DRIVER_PENDING && booking.driverDecisionDeadlineAt) {
        const deadlineTime = new Date(booking.driverDecisionDeadlineAt).getTime();
        const currentTime = now.getTime();
        const timeRemainingMs = deadlineTime - currentTime;
        const isExpired = timeRemainingMs <= 0;
        
        // Calculate auto-cancel time (1 hour after initial deadline if extended, or at deadline if not extended)
        const hasBeenExtended = booking.deadlineExtendedAt !== null && booking.deadlineExtendedAt !== undefined;
        const autoCancelAt = hasBeenExtended 
            ? booking.driverDecisionDeadlineAt  // If extended, auto-cancel at the extended deadline
            : null;  // If not extended, no auto-cancel yet (rider can extend)
        
        const autoCancelTimeRemainingMs = autoCancelAt 
            ? Math.max(0, autoCancelAt.getTime() - currentTime)
            : null;
        
        decisionDeadline = {
            deadlineAt: booking.driverDecisionDeadlineAt,
            timeRemainingMs: Math.max(0, timeRemainingMs),
            timeRemainingSeconds: Math.max(0, Math.floor(timeRemainingMs / 1000)),
            isExpired,
            canExtend: isExpired && !hasBeenExtended,  // Can extend only if expired and not yet extended
            hasBeenExtended,
            autoCancelAt,
            autoCancelTimeRemainingMs,
            autoCancelTimeRemainingSeconds: autoCancelTimeRemainingMs !== null 
                ? Math.floor(autoCancelTimeRemainingMs / 1000) 
                : null,
        };
    }

    // Calculate display status for RIDER perspective
    let displayStatus: string | undefined;
    
    if (booking.status === BookingStatus.DRIVER_PENDING) {
        displayStatus = 'PENDING_DRIVER_DECISION';  // Rider is waiting for driver decision
    } else if (booking.status === BookingStatus.CONFIRMED) {
        displayStatus = 'UPCOMING';
    } else if (booking.status === BookingStatus.IN_PROGRESS) {
        displayStatus = 'ONGOING';
    } else if (booking.status === BookingStatus.COMPLETED) {
        displayStatus = 'COMPLETED';
    } else if (booking.status === BookingStatus.CANCELLED) {
        displayStatus = 'CANCELLED';
    } else if (booking.status === BookingStatus.PAYMENT_PENDING) {
        displayStatus = 'PAYMENT_PENDING';
    } else if (booking.status === BookingStatus.PAYMENT_FAILED) {
        displayStatus = 'PAYMENT_FAILED';
    }

    return {
        id: booking.id,
        bookingReference: formatBookingReference(booking.id),
        rideId: booking.rideId,
        passengerId: booking.passengerId,
        seatsBooked: booking.seatsBooked,
        luggageCount: options?.luggageCount ?? 0,
        totalPrice: booking.totalPrice,
        priceBreakdown: options?.priceBreakdown ?? reconstructPriceBreakdown(booking),
        status: booking.status,
        displayStatus,
        pickupWaypointId: booking.pickupWaypointId,
        dropoffWaypointId: booking.dropoffWaypointId,
        notes: options?.notes ?? null,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        decisionDeadline,
        payment: options?.payment
            ?? (booking.stripePaymentIntentId
                ? {
                    provider: 'stripe',
                    paymentIntentId: booking.stripePaymentIntentId,
                    currency: booking.paymentCurrency ?? booking.ride.currency,
                }
                : null),
        ride: mapRideInfo(booking.ride),
        fullRide: mapRideInfo(booking.ride),
        segmentRide: mapSegmentRideInfo(
            booking.ride,
            booking.pickupWaypointId,
            booking.dropoffWaypointId
        ),
    };
};

const combineDepartureDateTimeUtc = (departureDate: Date, departureTime: string): Date => {
    const [hoursRaw, minutesRaw] = departureTime.split(':');
    const hours = Number(hoursRaw);
    const minutes = Number(minutesRaw);

    if (
        !Number.isInteger(hours) ||
        !Number.isInteger(minutes) ||
        hours < 0 ||
        hours > 23 ||
        minutes < 0 ||
        minutes > 59
    ) {
        throw new Error('INVALID_RIDE_DEPARTURE_TIME');
    }

    return new Date(
        Date.UTC(
            departureDate.getUTCFullYear(),
            departureDate.getUTCMonth(),
            departureDate.getUTCDate(),
            hours,
            minutes,
            0,
            0
        )
    );
};

const resolveSegmentAddress = (
    defaultAddress: string,
    waypointId: string | null,
    waypoints: Array<{ id: string; address: string }>
): string => {
    if (!waypointId) return defaultAddress;
    return waypoints.find((waypoint) => waypoint.id === waypointId)?.address ?? defaultAddress;
};

const assertExplicitMeetingPointsSelected = (
    ride: { waypoints?: Array<{ waypointType: string }> },
    resolvedPickupWaypointId: string | null,
    resolvedDropoffWaypointId: string | null
) => {
    const hasConcretePickup = ride.waypoints?.some((waypoint) => waypoint.waypointType === 'PICKUP') ?? false;
    const hasConcreteDropoff = ride.waypoints?.some((waypoint) => waypoint.waypointType === 'DROPOFF') ?? false;

    if (hasConcretePickup && !resolvedPickupWaypointId) {
        throw new Error('PICKUP_POINT_REQUIRED');
    }
    if (hasConcreteDropoff && !resolvedDropoffWaypointId) {
        throw new Error('DROPOFF_POINT_REQUIRED');
    }
};

const notifyRiderBookingState = async (params: {
    passengerId: string;
    bookingId: string;
    rideId: string;
    status: BookingStatus;
    originAddress: string;
    destinationAddress: string;
    departureDate: Date;
    departureTime: string;
    decisionDeadlineAt?: Date | null;
}) => {
    const isDriverPending = params.status === BookingStatus.DRIVER_PENDING;

    await createNotification({
        userId: params.passengerId,
        type: isDriverPending ? 'booking.request.sent' : 'booking.payment.pending',
        title: isDriverPending ? 'Booking request sent' : 'Payment required',
        body: isDriverPending
            ? 'Your request was sent to the driver. You will be notified when they respond.'
            : 'Complete payment to send your booking request to the driver.',
        data: {
            bookingId: params.bookingId,
            rideId: params.rideId,
            status: params.status,
            originAddress: params.originAddress,
            destinationAddress: params.destinationAddress,
            departureDate: params.departureDate.toISOString(),
            departureTime: params.departureTime,
            decisionDeadlineAt: params.decisionDeadlineAt?.toISOString() ?? '',
            deepLink: `app://booking/${params.bookingId}`,
        },
    });
};

/* ================= CREATE BOOKING ================= */

type BookingPlanRide = Prisma.RideGetPayload<{
    include: {
        driver: {
            select: {
                id: true;
                firstName: true;
                avatarUrl: true;
                stripeAccountId: true;
                stripeOnboardingComplete: true;
            };
        };
        waypoints: true;
    };
}>;

type BookingPlanPassenger = {
    firstName: string | null;
    avatarUrl: string | null;
    gender: string | null;
};

type BookingPlan = {
    ride: BookingPlanRide;
    passenger: BookingPlanPassenger | null;
    departureAt: Date;
    resolvedPickupWaypointId: string | null;
    resolvedDropoffWaypointId: string | null;
    pickupPosition: number;
    dropoffPosition: number;
    pickupAddress: string;
    dropoffAddress: string;
    segmentFare: number;
    priceBreakdown: PriceBreakdown;
    driverDecisionDeadlineAt: Date;
    expiryHours: number;
};

/**
 * Reads and validates everything a booking needs, without writing anything.
 *
 * Called twice on purpose: once before the transaction (to know the amount to
 * charge, so the Stripe PaymentIntent exists before any row is written) and once
 * inside the transaction, where it is the authoritative check.
 */
const resolveBookingPlan = async (
    client: Prisma.TransactionClient,
    passengerId: string,
    input: CreateBookingInput,
    now: Date,
    bypassBookingPaymentMode: boolean,
    feeTerms: ServiceFeeTerms
): Promise<BookingPlan> => {
    const {
        rideId,
        segmentId,
        seatsBooked,
        luggageCount = 0,
        pickupWaypointId,
        dropoffWaypointId,
        responseExpiryOption,
    } = input;

    const ride = await client.ride.findFirst({
        where: {
            id: rideId,
            status: RideStatus.PUBLISHED,
        },
        include: {
            driver: {
                select: {
                    id: true,
                    firstName: true,
                    avatarUrl: true,
                    stripeAccountId: true,
                    stripeOnboardingComplete: true,
                },
            },
            waypoints: {
                orderBy: { orderIndex: 'asc' },
            },
        },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
    }

    const departureAt = combineDepartureDateTimeUtc(ride.departureDate, ride.departureTime);
    if (isBookingWindowClosed(departureAt, now)) {
        throw new Error('BOOKING_WINDOW_CLOSED');
    }

    if (ride.driverId === passengerId) {
        throw new Error('CANNOT_BOOK_OWN_RIDE');
    }

    // Check if either party has blocked the other
    const block = await client.userBlock.findFirst({
        where: {
            OR: [
                { blockerId: passengerId, blockedId: ride.driverId },
                { blockerId: ride.driverId, blockedId: passengerId },
            ],
        },
    });
    if (block) {
        throw new Error('USER_BLOCKED');
    }

    // Validate seat count (min/max)
    validateBookingSeats(seatsBooked);

    // Friendly duplicate check. The DB-level guarantee is the partial unique index
    // `RideBooking_active_rider_ride_key`, whose status list must match
    // ACTIVE_BOOKING_STATUSES above.
    const existingBooking = await client.rideBooking.findFirst({
        where: {
            rideId,
            passengerId,
            status: { in: ACTIVE_BOOKING_STATUSES },
        },
    });

    if (existingBooking) {
        throw new Error('BOOKING_ALREADY_EXISTS');
    }

    const passenger = await client.user.findUnique({
        where: { id: passengerId },
        select: {
            firstName: true,
            avatarUrl: true,
            gender: true,
        },
    });

    if (ride.femaleOnly) {
        if (passenger?.gender !== 'FEMALE') {
            throw new Error('FEMALE_ONLY_RIDE');
        }
    }

    let pickupRef: SegmentPointRef;
    let dropRef: SegmentPointRef;

    if (segmentId) {
        try {
            const payload = decodeViewToken(segmentId);
            if (payload.rideId !== rideId) {
                throw new Error('INVALID_BOOKING_SEGMENT');
            }

            pickupRef = payload.pickupRef;
            dropRef = payload.dropRef;
        } catch {
            throw new Error('INVALID_BOOKING_SEGMENT');
        }
    } else {
        pickupRef = pickupWaypointId
            ? `waypoint:${pickupWaypointId}`
            : 'origin';
        dropRef = dropoffWaypointId
            ? `waypoint:${dropoffWaypointId}`
            : 'destination';
    }

    const segmentRide = ride as unknown as SegmentRide;
    const points = buildSegmentPoints(segmentRide);
    const riderView = resolveSegmentView(segmentRide, points, pickupRef, dropRef);
    if (!riderView) {
        throw new Error('INVALID_BOOKING_SEGMENT');
    }

    const resolvedPickupWaypointId = riderView.bookingContext.pickupWaypointId;
    const resolvedDropoffWaypointId = riderView.bookingContext.dropoffWaypointId;
    assertExplicitMeetingPointsSelected(ride, resolvedPickupWaypointId, resolvedDropoffWaypointId);

    // Resolve segment positions for per-segment capacity tracking
    const pickupPoint = points.find(p => p.waypointId === resolvedPickupWaypointId && resolvedPickupWaypointId !== null)
        ?? points.find(p => p.ref === (resolvedPickupWaypointId ? `waypoint:${resolvedPickupWaypointId}` : 'origin'))!;
    const dropPoint = points.find(p => p.waypointId === resolvedDropoffWaypointId && resolvedDropoffWaypointId !== null)
        ?? points.find(p => p.ref === (resolvedDropoffWaypointId ? `waypoint:${resolvedDropoffWaypointId}` : 'destination'))!;

    // Calculate price with breakdown
    const priceBreakdown = calculateBookingPrice({
        basePricePerSeat: riderView.basePricePerSeat,
        seatsBooked,
        luggageCount,
        currency: ride.currency,
        serviceFeePercent: feeTerms.serviceFeePercent,
        serviceFeeFlat: feeTerms.serviceFeeFlat,
    });

    // Calculate rider-selected deadline
    const { deadlineAt: driverDecisionDeadlineAt, expiryHours } = bypassBookingPaymentMode
        ? calculateDeadline(responseExpiryOption, departureAt, now)
        : { deadlineAt: new Date(now.getTime() + DRIVER_DECISION_WINDOW_MS), expiryHours: Math.round(DRIVER_DECISION_WINDOW_MS / (60 * 60 * 1000)) };

    return {
        ride,
        passenger,
        departureAt,
        resolvedPickupWaypointId,
        resolvedDropoffWaypointId,
        pickupPosition: pickupPoint.position,
        dropoffPosition: dropPoint.position,
        pickupAddress: riderView.originAddress,
        dropoffAddress: riderView.destinationAddress,
        segmentFare: riderView.basePricePerSeat,
        priceBreakdown,
        driverDecisionDeadlineAt,
        expiryHours,
    };
};

/**
 * Compare-and-swap on the whole-ride seat count. Used when the booking has no segment
 * positions, or when the ride has no per-segment capacity rows at all.
 */
const reserveWholeRideSeats = async (
    tx: Prisma.TransactionClient,
    rideId: string,
    seatsBooked: number
): Promise<void> => {
    const seatUpdate = await tx.ride.updateMany({
        where: {
            id: rideId,
            availableSeats: { gte: seatsBooked },
            status: RideStatus.PUBLISHED,
        },
        data: { availableSeats: { decrement: seatsBooked } },
    });

    if (seatUpdate.count === 0) {
        throw new Error('INSUFFICIENT_SEATS');
    }
};

/**
 * Reserves seats for the booking. Throws INSUFFICIENT_SEATS so the surrounding
 * transaction rolls back rather than overselling.
 */
const reserveSeatsForBooking = async (
    tx: Prisma.TransactionClient,
    params: {
        rideId: string;
        totalSeats: number;
        seatsBooked: number;
        // Nullable to match the booking row these are read back from, and to mirror
        // releaseSegmentSeats: with no positions there are no edges to target, so both
        // sides fall back to the whole-ride seat count.
        pickupPosition: number | null;
        dropoffPosition: number | null;
    }
): Promise<void> => {
    const { rideId, totalSeats, seatsBooked, pickupPosition, dropoffPosition } = params;

    if (pickupPosition === null || dropoffPosition === null) {
        await reserveWholeRideSeats(tx, rideId, seatsBooked);
        return;
    }

    // Per-segment capacity check: verify all edges in the booked range have capacity
    const edgeCapacities = await tx.rideSegmentCapacity.findMany({
        where: {
            rideId,
            fromPosition: { gte: pickupPosition },
            toPosition: { lte: dropoffPosition },
        },
    });

    if (edgeCapacities.length === 0) {
        // Rides without segment capacity rows
        await reserveWholeRideSeats(tx, rideId, seatsBooked);
        return;
    }

    const maxOccupied = Math.max(...edgeCapacities.map(e => e.occupiedSeats));
    if (maxOccupied + seatsBooked > totalSeats) {
        throw new Error('INSUFFICIENT_SEATS');
    }

    // Increment occupied seats on all covered edges
    await tx.rideSegmentCapacity.updateMany({
        where: {
            rideId,
            fromPosition: { gte: pickupPosition },
            toPosition: { lte: dropoffPosition },
        },
        data: { occupiedSeats: { increment: seatsBooked } },
    });

    // Re-read after the increment: the pre-check above is not a lock, so a
    // concurrent booking may have taken the same seats. Rolling back here is
    // what keeps the ride from being oversold.
    const allEdges = await tx.rideSegmentCapacity.findMany({ where: { rideId } });
    const newMaxOccupied = Math.max(...allEdges.map(e => e.occupiedSeats));
    if (newMaxOccupied > totalSeats) {
        throw new Error('INSUFFICIENT_SEATS');
    }

    // Update denormalized availableSeats = totalSeats - max(occupiedSeats across ALL edges)
    await tx.ride.update({
        where: { id: rideId },
        data: { availableSeats: totalSeats - newMaxOccupied },
    });
};

const isUniqueConstraintError = (error: unknown): boolean =>
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

/**
 * Deliberately left at the Postgres default READ COMMITTED. Seat safety comes from
 * `reserveSeatsForBooking`, which re-reads after the increment: under READ COMMITTED
 * the increment blocks on the row lock and then applies to the concurrent writer's
 * committed value, so the re-read sees the true occupancy. Raising the level to
 * REPEATABLE READ would instead abort one of the two bookings with a serialization
 * error, which is a worse outcome for the same guarantee.
 *
 * The timeout is raised from the 5s default because the booking transaction does a
 * full re-validation before it writes.
 */
const BOOKING_TRANSACTION_OPTIONS = {
    timeout: 15_000,
} as const;

/** PaymentIntent states a rider can still pay from. */
const RESUMABLE_INTENT_STATUSES: Stripe.PaymentIntent.Status[] = [
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
];

type PendingBookingReentry =
    | { kind: 'NONE' }
    | { kind: 'REPLACE' }
    | { kind: 'APPLIED'; bookingId: string }
    | {
        kind: 'RESUME';
        bookingId: string;
        paymentIntentId: string;
        clientSecret: string | null;
        currency: string;
    };

/** Stripe's "that object doesn't exist" error, as opposed to the API being unreachable. */
const isMissingStripeResourceError = (error: unknown): boolean =>
    typeof error === 'object'
    && error !== null
    && (error as { code?: string }).code === 'resource_missing';

/**
 * Decides what to do when this rider already has an unpaid booking on this ride.
 *
 * An unpaid booking must never be a dead end. Stripe is the authority on whether its
 * PaymentIntent can still be paid: if it can, the rider gets that same booking back to
 * finish; if it cannot, the stale booking is closed out and a fresh one is created.
 * Creating a second booking behind a still-payable intent would risk charging twice.
 */
const resolvePendingBookingReentry = async (
    passengerId: string,
    rideId: string
): Promise<PendingBookingReentry> => {
    const pending = await prisma.rideBooking.findFirst({
        where: { rideId, passengerId, status: BookingStatus.PAYMENT_PENDING },
        orderBy: { createdAt: 'desc' },
        select: {
            id: true,
            stripePaymentIntentId: true,
            ride: { select: { status: true } },
        },
    });

    if (!pending) {
        return { kind: 'NONE' };
    }

    // The ride itself is no longer bookable, so resuming payment on it would be wrong.
    // Fall through to the normal create path, which reports why.
    if (pending.ride.status !== RideStatus.PUBLISHED) {
        await failBookingAndReleaseSeats(pending.id);
        return { kind: 'REPLACE' };
    }

    if (!pending.stripePaymentIntentId) {
        // A booking with no intent attached cannot be paid — nothing to resume.
        await failBookingAndReleaseSeats(pending.id);
        return { kind: 'REPLACE' };
    }

    let intent: Stripe.PaymentIntent;
    try {
        intent = await getStripeClient().paymentIntents.retrieve(pending.stripePaymentIntentId);
    } catch (error) {
        if (isMissingStripeResourceError(error)) {
            await failBookingAndReleaseSeats(pending.id);
            return { kind: 'REPLACE' };
        }

        // Stripe is down. Creating a second booking now could double-charge, so refuse
        // rather than guess.
        logError('Could not check the existing unpaid booking with Stripe', error, {
            bookingId: pending.id,
            paymentIntentId: pending.stripePaymentIntentId,
        });
        throw new Error('PAYMENT_VERIFICATION_UNAVAILABLE');
    }

    if (intent.status === 'succeeded') {
        // Paid already; the webhook just has not been applied yet.
        await applyStripePaymentSucceededToBooking(intent);
        return { kind: 'APPLIED', bookingId: pending.id };
    }

    if (RESUMABLE_INTENT_STATUSES.includes(intent.status)) {
        return {
            kind: 'RESUME',
            bookingId: pending.id,
            paymentIntentId: intent.id,
            clientSecret: intent.client_secret ?? null,
            currency: intent.currency.toUpperCase(),
        };
    }

    // Cancelled, or any future status that is not payable.
    await failBookingAndReleaseSeats(pending.id);
    return { kind: 'REPLACE' };
};

export const createBooking = async (
    passengerId: string,
    input: CreateBookingInput
): Promise<BookingResponse> => {
    // Guard: passenger must have accepted ToS and must not be banned
    const passengerAccount = await prisma.user.findUnique({
        where: { id: passengerId },
        select: { tosAcceptedAt: true, privacyAcceptedAt: true, isBanned: true, dob: true },
    });

    if (!passengerAccount?.tosAcceptedAt || !passengerAccount?.privacyAcceptedAt) {
        throw new Error('TOS_NOT_ACCEPTED');
    }

    if (passengerAccount.isBanned) {
        throw new Error('USER_BANNED');
    }

    if (!passengerAccount.dob || calculateAgeYears(passengerAccount.dob) < MINIMUM_BOOKING_AGE_YEARS) {
        throw new Error('PASSENGER_TOO_YOUNG');
    }

    const bypassBookingPaymentMode = isBypassBookingPaymentMode();
    const now = new Date();
    const paymentCapturedAt = bypassBookingPaymentMode ? now : null;
    const {
        rideId,
        seatsBooked,
        luggageCount = 0,
        requiresChildSeat = false,
        travelingWithChildUnderTwo = false,
        bringingOwnChildSeat = false,
        notes,
        responseExpiryOption,
    } = input;
    const childSeatDeclared = travelingWithChildUnderTwo || requiresChildSeat;
    if (childSeatDeclared && !bringingOwnChildSeat) {
        throw new Error('CHILD_SEAT_ACK_REQUIRED');
    }
    const normalizedNotes = [
        notes?.trim() || '',
        childSeatDeclared ? 'Rider is travelling with a child aged 2 or younger and will bring a child seat.' : '',
    ]
        .filter(Boolean)
        .join('\n')
        .slice(0, 300);

    // Resolved once, outside the transaction: the rate is frozen per ride, so this is a single read
    // and must not lengthen the seat-reservation critical section.
    const feeTerms = await resolveRideFeeTerms(rideId);
    const bookingId = randomUUID();

    const buildBookingData = (plan: BookingPlan): Prisma.RideBookingUncheckedCreateInput => ({
        id: bookingId,
        rideId,
        passengerId,
        seatsBooked,
        totalPrice: plan.priceBreakdown.totalPrice,
        pickupWaypointId: plan.resolvedPickupWaypointId,
        dropoffWaypointId: plan.resolvedDropoffWaypointId,
        pickupAddress: plan.pickupAddress,
        dropoffAddress: plan.dropoffAddress,
        segmentFare: plan.segmentFare,
        serviceFeeAmount: plan.priceBreakdown.serviceFee,
        serviceFeePercent: plan.priceBreakdown.serviceFeePercent,
        pickupPosition: plan.pickupPosition,
        dropoffPosition: plan.dropoffPosition,
        status: bypassBookingPaymentMode
            ? BookingStatus.DRIVER_PENDING
            : BookingStatus.PAYMENT_PENDING,
        // Bypass mode settles payment at creation, so its seats are taken here. In
        // stripe mode nothing is held until the payment confirms.
        seatsReservedAt: bypassBookingPaymentMode ? now : undefined,
        paymentAmount: bypassBookingPaymentMode ? plan.priceBreakdown.totalPrice : undefined,
        paymentCurrency: plan.ride.currency,
        paymentCapturedAt: paymentCapturedAt ?? undefined,
        driverDecisionDeadlineAt: plan.driverDecisionDeadlineAt,
        responseExpiryOption: responseExpiryOption ?? null,
        responseExpiryHours: plan.expiryHours,
    });

    const BOOKING_CREATE_INCLUDE = {
        ride: {
            include: {
                driver: {
                    select: {
                        id: true,
                        firstName: true,
                        avatarUrl: true,
                    },
                },
                waypoints: {
                    orderBy: { orderIndex: 'asc' as const },
                },
            },
        },
    };

    if (bypassBookingPaymentMode) {
        const seed = await prisma.$transaction(async (tx) => {
            const plan = await resolveBookingPlan(tx, passengerId, input, now, true, feeTerms);

            await reserveSeatsForBooking(tx, {
                rideId,
                totalSeats: plan.ride.totalSeats,
                seatsBooked,
                pickupPosition: plan.pickupPosition,
                dropoffPosition: plan.dropoffPosition,
            });

            const booking = await tx.rideBooking.create({
                data: buildBookingData(plan),
                include: BOOKING_CREATE_INCLUDE,
            });

            const split = resolvePaymentSplit(plan.priceBreakdown);

            const payment = await createPayment({
                tx,
                status: PAYMENT_STATUSES.PAYMENT_PENDING,
                bookingId: booking.id,
                rideId: booking.rideId,
                riderId: passengerId,
                amountTotal: split.amountTotal,
                fareAmount: split.fareAmount,
                platformFeeAmount: split.platformFeeAmount,
                currency: plan.ride.currency,
            });

            return { booking, plan, paymentId: payment.id };
        }, BOOKING_TRANSACTION_OPTIONS).catch((error: unknown) => {
            if (isUniqueConstraintError(error)) {
                throw new Error('BOOKING_ALREADY_EXISTS');
            }
            throw error;
        });

        const passengerName = seed.plan.passenger?.firstName ?? 'Rider';
        const originAddress = resolveSegmentAddress(
            seed.plan.ride.originAddress,
            seed.plan.resolvedPickupWaypointId,
            seed.plan.ride.waypoints ?? []
        );
        const destinationAddress = resolveSegmentAddress(
            seed.plan.ride.destinationAddress,
            seed.plan.resolvedDropoffWaypointId,
            seed.plan.ride.waypoints ?? []
        );

        try {
            // Ledger + outbox writes are not part of the booking transaction on purpose:
            // they must never roll back a paid booking, and they are replayable.
            await markPaymentPaid(seed.paymentId, seed.plan.ride.driverId);
        } catch (error) {
            logError('Bypass payment state sync failed after booking was created', error, {
                bookingId: seed.booking.id,
                paymentId: seed.paymentId,
            });
        }

        try {
            await notifyRiderBookingState({
                passengerId,
                bookingId: seed.booking.id,
                rideId: seed.booking.rideId,
                status: BookingStatus.DRIVER_PENDING,
                originAddress,
                destinationAddress,
                departureDate: seed.plan.ride.departureDate,
                departureTime: seed.plan.ride.departureTime,
                decisionDeadlineAt: seed.plan.driverDecisionDeadlineAt,
            });

            await createNotification({
                userId: seed.plan.ride.driverId,
                type: DRIVER_DECISION_NOTIFICATION_TYPE,
                title: 'New ride request',
                body: `${passengerName} wants ${originAddress} to ${destinationAddress}`,
                data: {
                    bookingId: seed.booking.id,
                    rideId: seed.booking.rideId,
                    passengerName,
                    passengerAvatarUrl: seed.plan.passenger?.avatarUrl ?? '',
                    originAddress,
                    destinationAddress,
                    seatsBooked: String(seed.booking.seatsBooked),
                    totalPrice: String(seed.booking.totalPrice),
                    currency: seed.booking.paymentCurrency ?? seed.plan.ride.currency,
                    decisionDeadlineAt: seed.plan.driverDecisionDeadlineAt.toISOString(),
                    decisionTimeRemainingSeconds: String(
                        Math.max(0, Math.floor((seed.plan.driverDecisionDeadlineAt.getTime() - Date.now()) / 1000))
                    ),
                    deepLink: `app://driver/booking-request/${seed.booking.id}`,
                },
            });

            await emitToUsers([seed.plan.ride.driverId], 'booking:updated', {
                bookingId: seed.booking.id,
                rideId: seed.booking.rideId,
                passengerId,
                status: BookingStatus.DRIVER_PENDING,
                actor: 'rider',
                action: 'booking.requested',
                updatedAt: new Date().toISOString(),
            });

            // Enqueue deadline check using rider-selected expiry time
            const deadlineDelayMs = Math.max(0, seed.plan.driverDecisionDeadlineAt.getTime() - Date.now());
            await enqueueDeadlineCheck(seed.booking.id, deadlineDelayMs);
        } catch (error) {
            logError('Bypass booking notification side effects failed; booking still succeeded', error, {
                bookingId: seed.booking.id,
            });
        }

        return mapBookingResponse(seed.booking as unknown as BookingWithRideDetails, {
            luggageCount,
            notes: normalizedNotes || null,
            priceBreakdown: seed.plan.priceBreakdown,
        });
    }

    // ---- Stripe mode ----
    // Pre-flight resolve so the PaymentIntent exists before any row is written.
    // Before anything is created: does this rider already have an unpaid booking here?
    const reentry = await resolvePendingBookingReentry(passengerId, rideId);

    if (reentry.kind === 'RESUME' || reentry.kind === 'APPLIED') {
        const existing = await getBookingById(passengerId, reentry.bookingId);

        if (existing) {
            if (reentry.kind === 'RESUME') {
                // The rider is paying now, so the window restarts from now. The original job was
                // scheduled at creation and would otherwise expire the booking mid-checkout.
                await reschedulePaymentExpiryCheck(reentry.bookingId, bookingPaymentWindowMs());
            }

            return {
                ...existing,
                resumed: true,
                ...(reentry.kind === 'RESUME'
                    ? {
                        payment: {
                            provider: 'stripe' as const,
                            paymentIntentId: reentry.paymentIntentId,
                            clientSecret: reentry.clientSecret ?? undefined,
                            currency: reentry.currency,
                        },
                    }
                    : {}),
            };
        }
        // The booking vanished between the two reads; fall through and create one.
    }

    // Nothing here writes, so a failure leaves no booking and no seat hold.
    const preflightPlan = await resolveBookingPlan(prisma, passengerId, input, now, false, feeTerms);

    const riderPaymentMethod = await prisma.paymentMethod.findFirst({
        where: {
            userId: passengerId,
            status: 'ACTIVE',
        },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
        select: {
            stripeCustomerId: true,
        },
    });

    let paymentIntent: Awaited<ReturnType<typeof createBookingPaymentIntent>>;
    try {
        const driverStripeAccountId = preflightPlan.ride.driver.stripeOnboardingComplete
            ? preflightPlan.ride.driver.stripeAccountId ?? null
            : null;

        paymentIntent = await createBookingPaymentIntent({
            bookingId,
            rideId,
            passengerId,
            amountMajor: preflightPlan.priceBreakdown.totalPrice,
            currency: preflightPlan.ride.currency,
            customerId: riderPaymentMethod?.stripeCustomerId ?? null,
            driverStripeAccountId,
        });
    } catch (error) {
        logError('Stripe PaymentIntent creation failed before booking was written', error, {
            bookingId,
            rideId,
        });
        throw new Error('PAYMENT_INITIALIZATION_FAILED');
    }

    let seed: { booking: Awaited<ReturnType<typeof prisma.rideBooking.create>>; plan: BookingPlan };
    try {
        seed = await prisma.$transaction(async (tx) => {
            const plan = await resolveBookingPlan(tx, passengerId, input, now, false, feeTerms);

            // The intent was created for the pre-flight amount. If the fare moved in
            // between, fail rather than charge an amount the rider never saw.
            if (plan.priceBreakdown.totalPrice !== preflightPlan.priceBreakdown.totalPrice) {
                throw new Error('BOOKING_PRICE_CHANGED');
            }

            // No seat reservation here on purpose. An unpaid booking holds nothing, so
            // it cannot lock a seat away from a rider who is ready to pay. The seats are
            // taken in applyStripePaymentSucceededToBooking, which is allowed to fail if
            // the ride filled up in the meantime.
            const booking = await tx.rideBooking.create({
                data: {
                    ...buildBookingData(plan),
                    stripePaymentIntentId: paymentIntent.paymentIntentId,
                    paymentAmount: plan.priceBreakdown.totalPrice,
                    paymentCurrency: paymentIntent.currency,
                },
                include: BOOKING_CREATE_INCLUDE,
            });

            const split = resolvePaymentSplit(plan.priceBreakdown);

            await createPayment({
                tx,
                status: PAYMENT_STATUSES.PAYMENT_PENDING,
                bookingId: booking.id,
                rideId: booking.rideId,
                riderId: passengerId,
                amountTotal: split.amountTotal,
                fareAmount: split.fareAmount,
                platformFeeAmount: split.platformFeeAmount,
                currency: paymentIntent.currency,
                stripePaymentIntentId: paymentIntent.paymentIntentId,
            });

            return { booking, plan };
        }, BOOKING_TRANSACTION_OPTIONS);
    } catch (error) {
        // The transaction rolled back, so there is no booking and no payment row to
        // compensate — only the Stripe intent to release.
        try {
            await cancelPaymentIntent(paymentIntent.paymentIntentId);
        } catch (cancelError) {
            logError('Failed to cancel PaymentIntent after booking transaction rollback', cancelError, {
                bookingId,
                paymentIntentId: paymentIntent.paymentIntentId,
            });
        }

        if (isUniqueConstraintError(error)) {
            throw new Error('BOOKING_ALREADY_EXISTS');
        }
        throw error;
    }

    const originAddress = resolveSegmentAddress(
        seed.plan.ride.originAddress,
        seed.plan.resolvedPickupWaypointId,
        seed.plan.ride.waypoints ?? []
    );
    const destinationAddress = resolveSegmentAddress(
        seed.plan.ride.destinationAddress,
        seed.plan.resolvedDropoffWaypointId,
        seed.plan.ride.waypoints ?? []
    );

    try {
        // Close the booking out if the rider never comes back to pay. No seat is at
        // stake, but its PaymentIntent stays payable until something cancels it.
        await enqueuePaymentExpiryCheck(seed.booking.id, bookingPaymentWindowMs());
    } catch (error) {
        logError('Could not schedule the payment expiry check for a new booking', error, {
            bookingId: seed.booking.id,
        });
    }

    try {
        await notifyRiderBookingState({
            passengerId,
            bookingId: seed.booking.id,
            rideId: seed.booking.rideId,
            status: BookingStatus.PAYMENT_PENDING,
            originAddress,
            destinationAddress,
            departureDate: seed.plan.ride.departureDate,
            departureTime: seed.plan.ride.departureTime,
            decisionDeadlineAt: seed.plan.driverDecisionDeadlineAt,
        });
    } catch (error) {
        logError('Booking created but rider notification failed', error, {
            bookingId: seed.booking.id,
        });
    }

    return mapBookingResponse(seed.booking as unknown as BookingWithRideDetails, {
        luggageCount,
        notes: normalizedNotes || null,
        priceBreakdown: seed.plan.priceBreakdown,
        payment: {
            provider: 'stripe',
            paymentIntentId: paymentIntent.paymentIntentId,
            clientSecret: paymentIntent.clientSecret,
            currency: paymentIntent.currency,
        },
    });
};

/* ================= EXTEND WAIT FOR DRIVER ================= */
const EXTENDED_DEADLINE_MS = 60 * 60 * 1000; // 1 hour

export const extendWaitForDriver = async (
    passengerId: string,
    bookingId: string
) => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: BookingStatus.DRIVER_PENDING,
        },
        include: {
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    originAddress: true,
                    destinationAddress: true,
                },
            },
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    if (booking.status !== BookingStatus.DRIVER_PENDING) {
        throw new Error('BOOKING_NOT_DRIVER_PENDING');
    }

    // Check if deadline has expired
    if (!booking.driverDecisionDeadlineAt || booking.driverDecisionDeadlineAt > new Date()) {
        throw new Error('DEADLINE_NOT_EXPIRED');
    }

    // Check if already extended
    if (booking.deadlineExtendedAt) {
        throw new Error('ALREADY_EXTENDED');
    }

    const newDeadline = new Date(Date.now() + EXTENDED_DEADLINE_MS);

    const updated = await prisma.rideBooking.update({
        where: { id: bookingId },
        data: {
            driverDecisionDeadlineAt: newDeadline,
            deadlineExtendedAt: new Date(),
        },
        select: {
            id: true,
            driverDecisionDeadlineAt: true,
            status: true,
        },
    });

    // Notify driver again
    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.rider.extended_wait',
        title: 'Rider is still waiting',
        body: 'The rider extended the waiting period. Please respond within 1 hour.',
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            newDeadline: newDeadline.toISOString(),
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });

    return {
        bookingId: updated.id,
        status: updated.status,
        newDeadline: updated.driverDecisionDeadlineAt,
        extendedBy: 'rider',
    };
};

/* ================= RIDER CANCEL BOOKING ================= */
export const cancelBooking = async (
    passengerId: string,
    bookingId: string,
    reason?: string
): Promise<CancelBookingResult> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: { in: CANCELLABLE_BOOKING_STATUSES },
        },
        include: {
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    departureDate: true,
                    departureTime: true,
                    originAddress: true,
                    destinationAddress: true,
                },
            },
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    const departureAt = combineDepartureDateTimeUtc(
        booking.ride.departureDate,
        booking.ride.departureTime
    );

    // Check if deadline expired (driver didn't respond)
    const isDeadlineExpired = booking.driverDecisionDeadlineAt 
        && booking.driverDecisionDeadlineAt < new Date()
        && booking.status === BookingStatus.DRIVER_PENDING;

    if (
        booking.status === BookingStatus.CONFIRMED
        && isConfirmedCancellationWindowClosed(departureAt, new Date())
    ) {
        throw new Error('CANCELLATION_WINDOW_CLOSED');
    }

    const isPaymentCaptured = Boolean(booking.paymentCapturedAt && booking.stripePaymentIntentId);
    
    // If deadline expired, give 100% refund regardless of time
    const refundPercent = isDeadlineExpired 
        ? 100 
        : (isPaymentCaptured ? getRiderRefundPercent(departureAt, new Date()) : 0);
    
    const refundAmount = isPaymentCaptured
        ? getRiderRefundAmount(booking.paymentAmount ?? booking.totalPrice, refundPercent)
        : 0;

    const cancellationReason = isDeadlineExpired
        ? 'DRIVER_NO_RESPONSE'
        : (reason?.trim() || 'PASSENGER_CANCELLED');

    let refundInitiated = false;

    const updated = await prisma.$transaction(async (tx) => {
        const current = await tx.rideBooking.findFirst({
            where: {
                id: bookingId,
                passengerId,
                status: { in: CANCELLABLE_BOOKING_STATUSES },
            },
            select: {
                id: true,
                rideId: true,
                seatsBooked: true,
                pickupPosition: true,
                dropoffPosition: true,
                ride: { select: { totalSeats: true } },
            },
        });

        if (!current) {
            throw new Error('BOOKING_NOT_CANCELLABLE');
        }

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'PASSENGER',
                cancellationReason,
                refundPercent,
                refundAmount,
            },
        });

        await releaseBookingSeats(tx, {
            bookingId: current.id,
            rideId: current.rideId,
            seatsBooked: current.seatsBooked,
            pickupPosition: current.pickupPosition,
            dropoffPosition: current.dropoffPosition,
            totalSeats: current.ride.totalSeats,
        });

        return current;
    });

    // Stripe is called only after the transaction commits. A network call inside an
    // interactive transaction can blow the transaction timeout and roll back a refund
    // Stripe has already accepted.
    if (isPaymentCaptured && refundAmount > 0 && booking.stripePaymentIntentId) {
        await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(refundAmount)
        );
        refundInitiated = true;
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { refundedAt: new Date() },
        });
    } else if (!isPaymentCaptured && booking.stripePaymentIntentId) {
        // Nothing was captured, so there is nothing to refund — but the PaymentIntent is
        // still live. Left alone, the rider could authorise it later and the money would
        // be taken for a booking that no longer exists (the webhook only applies to a
        // PAYMENT_PENDING booking, so it would land nowhere).
        await releaseUnpaidPaymentIntent(bookingId, booking.stripePaymentIntentId);
    }

    if (refundInitiated && refundAmount > 0) {
        try {
            await markBookingPaymentRefunded(bookingId, booking.ride.driverId, refundAmount);
        } catch (error) {
            logError('Rider cancellation refund succeeded, but local payment refund sync failed', error, {
                bookingId,
            });
        }
    }

    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.rider.cancelled',
        title: 'Booking cancelled by rider',
        body: 'A rider cancelled their booking.',
        data: {
            bookingId: booking.id,
            rideId: booking.rideId,
            originAddress: booking.ride.originAddress,
            destinationAddress: booking.ride.destinationAddress,
            departureDate: booking.ride.departureDate.toISOString(),
            departureTime: booking.ride.departureTime,
            cancellationReason,
            refundPercent: String(refundPercent),
            refundAmount: String(refundAmount),
            refundInitiated: refundInitiated ? 'true' : 'false',
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });

    return {
        bookingId: updated.id,
        rideId: updated.rideId,
        refundPercent,
        refundAmount,
        refundInitiated,
    };
};

/* ================= GET BOOKING BY ID ================= */
export const getBookingById = async (
    passengerId: string,
    bookingId: string
): Promise<BookingResponse | null> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
        },
        include: {
            ride: {
                include: {
                    driver: {
                        select: {
                            id: true,
                            firstName: true,
                            avatarUrl: true,
                        },
                    },
                    vehicle: {
                        select: {
                            id: true,
                            brand: true,
                            model_num: true,
                            model_name: true,
                            type: true,
                            color: true,
                            year: true,
                            imageUrl: true,
                            isVerified: true,
                        },
                    },
                    waypoints: {
                        orderBy: { orderIndex: 'asc' },
                    },
                },
            },
            ratings: {
                where: { raterId: passengerId },
                select: {
                    id: true,
                    stars: true,
                    reviewText: true,
                    createdAt: true,
                },
                take: 1,
            },
        },
    });

    if (!booking) return null;

    const response = mapBookingResponse(booking as unknown as BookingWithRideDetails);

    return {
        ...response,
        pickupOtp: (booking as any).pickupOtp ?? null,
        dropOtp: (booking as any).dropOtp ?? null,
        pickupOtpVerifiedAt: booking.pickupOtpVerifiedAt,
        dropOtpVerifiedAt: booking.dropOtpVerifiedAt,
        ratingByViewer: booking.ratings?.[0] ?? null,
    };
};

/**
 * Stripe PaymentIntent statuses that are *not* a confirmed payment, mapped to the
 * error code the API surfaces. Booking intents are created with
 * `capture_method: 'automatic'`, so `succeeded` is the only confirmed state and
 * `requires_capture` cannot occur on this path.
 */
const UNCONFIRMED_INTENT_STATUS_CODES: Record<string, string> = {
    requires_payment_method: 'PAYMENT_METHOD_REQUIRED',
    requires_confirmation: 'PAYMENT_NOT_CONFIRMED',
    requires_action: 'PAYMENT_REQUIRES_ACTION',
    processing: 'PAYMENT_PROCESSING',
    canceled: 'PAYMENT_CANCELLED',
};

/** Booking statuses that mean the payment already went through. */
const PAYMENT_SETTLED_BOOKING_STATUSES: BookingStatus[] = [
    BookingStatus.DRIVER_PENDING,
    BookingStatus.CONFIRMED,
    BookingStatus.WAITING_FOR_PICKUP,
    BookingStatus.DRIVER_ARRIVED,
    BookingStatus.OTP_PENDING,
    BookingStatus.ONBOARD,
    BookingStatus.DROP_PENDING,
    BookingStatus.DRIVER_DROPPED,
    BookingStatus.IN_PROGRESS,
    BookingStatus.COMPLETED,
    BookingStatus.DISPUTED,
];

/**
 * Marks a booking as failed. Used when Stripe reports the intent is gone.
 *
 * Any seats it holds are released, though in stripe mode an unpaid booking holds none —
 * `releaseBookingSeats` no-ops in that case.
 */
const failBookingAndReleaseSeats = async (bookingId: string): Promise<void> => {
    await prisma.$transaction(async (tx) => {
        const existing = await tx.rideBooking.findUnique({
            where: { id: bookingId },
            select: {
                rideId: true,
                seatsBooked: true,
                pickupPosition: true,
                dropoffPosition: true,
                ride: { select: { totalSeats: true } },
            },
        });

        if (!existing) return;

        const failed = await tx.rideBooking.updateMany({
            where: { id: bookingId, status: BookingStatus.PAYMENT_PENDING },
            data: { status: BookingStatus.PAYMENT_FAILED },
        });

        // Someone else (webhook, expiry) already moved it — do not release twice.
        if (failed.count === 0) return;

        await releaseBookingSeats(tx, {
            bookingId,
            rideId: existing.rideId,
            seatsBooked: existing.seatsBooked,
            pickupPosition: existing.pickupPosition,
            dropoffPosition: existing.dropoffPosition,
            totalSeats: existing.ride.totalSeats,
        });
    });
};

/**
 * Confirms a booking's payment against Stripe.
 *
 * This is a validation endpoint, not a fetch: it only returns a booking when the
 * payment is actually confirmed. Every other state throws a typed code that the
 * controller turns into a 4xx with an actionable message, so the client can never
 * mistake an unpaid booking for a booked ride.
 */
export const confirmBookingPayment = async (
    passengerId: string,
    bookingId: string
): Promise<BookingResponse | null> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
        },
        select: {
            status: true,
            stripePaymentIntentId: true,
        },
    });

    if (!booking) {
        return null;
    }

    // Already paid for — confirming again is a no-op success, so the client can
    // safely retry the call.
    if (PAYMENT_SETTLED_BOOKING_STATUSES.includes(booking.status)) {
        return getBookingById(passengerId, bookingId);
    }

    if (booking.status !== BookingStatus.PAYMENT_PENDING) {
        // PAYMENT_FAILED, CANCELLED, NO_SHOW, ... — nothing left to confirm.
        throw new Error('BOOKING_NOT_PAYABLE');
    }

    if (isBypassBookingPaymentMode()) {
        // Payment is bypassed, so a PAYMENT_PENDING booking here means the booking
        // write itself never finished. There is nothing to verify with Stripe.
        throw new Error('PAYMENT_NOT_INITIALIZED');
    }

    if (!booking.stripePaymentIntentId) {
        throw new Error('PAYMENT_NOT_INITIALIZED');
    }

    let intent: Stripe.PaymentIntent;
    try {
        const stripe = getStripeClient();
        intent = await stripe.paymentIntents.retrieve(booking.stripePaymentIntentId);
    } catch (error) {
        // Never swallow this: a Stripe outage must not read as "payment not done".
        logError('Failed to verify booking payment status with Stripe', error, {
            bookingId,
            paymentIntentId: booking.stripePaymentIntentId,
        });
        throw new Error('PAYMENT_VERIFICATION_UNAVAILABLE');
    }

    if (intent.status !== 'succeeded') {
        if (intent.status === 'canceled') {
            await failBookingAndReleaseSeats(bookingId);
        }

        throw new Error(UNCONFIRMED_INTENT_STATUS_CODES[intent.status] ?? 'PAYMENT_NOT_CONFIRMED');
    }

    await applyStripePaymentSucceededToBooking(intent);

    return getBookingById(passengerId, bookingId);
};

/* ================= LIST USER BOOKINGS ================= */
/**
 * Hands a rider back the means to finish paying for an existing booking.
 *
 * The Stripe client secret is only ever produced when a booking is created, so a rider
 * who closed the app mid-checkout had no way back to it — the booking sat unpaid with no
 * payable route. This is that route, addressed by booking id alone.
 */
export const resumeBookingPayment = async (
    passengerId: string,
    bookingId: string
): Promise<BookingResponse | null> => {
    const booking = await prisma.rideBooking.findFirst({
        where: { id: bookingId, passengerId },
        select: { status: true, stripePaymentIntentId: true },
    });

    if (!booking) {
        return null;
    }

    // Already paid for: nothing to resume, and saying so with an error would be wrong.
    if (PAYMENT_SETTLED_BOOKING_STATUSES.includes(booking.status)) {
        return getBookingById(passengerId, bookingId);
    }

    if (booking.status !== BookingStatus.PAYMENT_PENDING) {
        throw new Error('BOOKING_NOT_PAYABLE');
    }

    if (isBypassBookingPaymentMode() || !booking.stripePaymentIntentId) {
        throw new Error('PAYMENT_NOT_INITIALIZED');
    }

    let intent: Stripe.PaymentIntent;
    try {
        intent = await getStripeClient().paymentIntents.retrieve(booking.stripePaymentIntentId);
    } catch (error) {
        logError('Could not load the PaymentIntent to resume a booking payment', error, {
            bookingId,
            paymentIntentId: booking.stripePaymentIntentId,
        });
        throw new Error('PAYMENT_VERIFICATION_UNAVAILABLE');
    }

    if (intent.status === 'succeeded') {
        await applyStripePaymentSucceededToBooking(intent);
        return getBookingById(passengerId, bookingId);
    }

    if (!RESUMABLE_INTENT_STATUSES.includes(intent.status)) {
        // Dead intent. Close the booking out so the rider can book the ride again.
        await failBookingAndReleaseSeats(bookingId);
        throw new Error('PAYMENT_CANCELLED');
    }

    const resumable = await getBookingById(passengerId, bookingId);
    if (!resumable) return null;

    // Restart the window: the rider is back in checkout, and the job enqueued at creation would
    // otherwise expire the booking while they are entering card details.
    await reschedulePaymentExpiryCheck(bookingId, bookingPaymentWindowMs());

    return {
        ...resumable,
        resumed: true,
        payment: {
            provider: 'stripe',
            paymentIntentId: intent.id,
            clientSecret: intent.client_secret ?? undefined,
            currency: intent.currency.toUpperCase(),
        },
    };
};

export const listUserBookings = async (
    passengerId: string,
    query: ListBookingsQuery
): Promise<BookingListResponse> => {
    const { status, page = 1, limit = 10 } = query;
    const statuses = normalizeBookingStatusFilter(status);

    // An unpaid booking is not a booked ride, so it does not belong in the default list —
    // showing it there is what made a pending payment look like a confirmed seat. It is
    // still returned when asked for by name (the app's "pending" tab does exactly that)
    // and always by GET /bookings/:id, so checkout stays resumable.
    const where: Prisma.RideBookingWhereInput = {
        passengerId,
        ...(statuses.length === 1 ? { status: statuses[0] } : {}),
        ...(statuses.length > 1 ? { status: { in: statuses } } : {}),
        ...(statuses.length === 0 ? { status: { not: BookingStatus.PAYMENT_PENDING } } : {}),
    };

    const [allBookings, total] = await Promise.all([
        prisma.rideBooking.findMany({
            where,
            include: {
                ride: {
                    include: {
                        driver: {
                            select: {
                                id: true,
                                firstName: true,
                                avatarUrl: true,
                            },
                        },
                        vehicle: {
                            select: {
                                id: true,
                                brand: true,
                                model_num: true,
                                model_name: true,
                                type: true,
                                color: true,
                                year: true,
                                imageUrl: true,
                                isVerified: true,
                            },
                        },
                        waypoints: {
                            orderBy: { orderIndex: 'asc' },
                        },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        }),
        prisma.rideBooking.count({ where }),
    ]);

    const sortedBookings = allBookings.sort((a, b) => {
        const aTime = a.ride?.departureDate ? new Date(a.ride.departureDate).getTime() : 0;
        const bTime = b.ride?.departureDate ? new Date(b.ride.departureDate).getTime() : 0;
        if (aTime !== bTime) return aTime - bTime;
        return b.createdAt.getTime() - a.createdAt.getTime();
    });

    const skip = (page - 1) * limit;
    const bookings = sortedBookings.slice(skip, skip + limit);

    return {
        bookings: bookings.map((booking) =>
            mapBookingResponse(booking as unknown as BookingWithRideDetails)
        ),
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
        },
    };
};

/* ================= PRICE PREVIEW ================= */
export const getBookingPricePreview = async (
    passengerId: string,
    input: PricePreviewInput
): Promise<PricePreviewResponse> => {
    const {
        rideId,
        segmentId,
        seatsBooked,
        luggageCount = 0,
        requiresChildSeat = false,
        travelingWithChildUnderTwo = false,
        bringingOwnChildSeat = false,
        pickupWaypointId,
        dropoffWaypointId,
    } = input;
    const childSeatDeclared = travelingWithChildUnderTwo || requiresChildSeat;

    if (childSeatDeclared && !bringingOwnChildSeat) {
        throw new Error('CHILD_SEAT_ACK_REQUIRED');
    }

    const passenger = await prisma.user.findUnique({
        where: { id: passengerId },
        select: { dob: true },
    });

    if (!passenger?.dob || calculateAgeYears(passenger.dob) < MINIMUM_BOOKING_AGE_YEARS) {
        throw new Error('PASSENGER_TOO_YOUNG');
    }

    const ride = await prisma.ride.findFirst({
        where: {
            id: rideId,
            status: RideStatus.PUBLISHED,
        },
        include: {
            waypoints: {
                orderBy: { orderIndex: 'asc' },
            },
        },
    });

    if (!ride) {
        throw new Error('RIDE_NOT_FOUND');
    }

    if (ride.driverId === passengerId) {
        throw new Error('CANNOT_BOOK_OWN_RIDE');
    }

    // Validate seat count (min/max) and availability
    validateBookingSeats(seatsBooked);
    if (seatsBooked > ride.availableSeats) {
        throw new Error('INSUFFICIENT_SEATS');
    }

    let pickupRef: SegmentPointRef;
    let dropRef: SegmentPointRef;
    let segmentRide: { originAddress: string; destinationAddress: string; basePricePerSeat: number } | null = null;

    if (segmentId) {
        try {
            const payload = decodeViewToken(segmentId);
            if (payload.rideId !== rideId) {
                throw new Error('INVALID_BOOKING_SEGMENT');
            }

            pickupRef = payload.pickupRef;
            dropRef = payload.dropRef;
        } catch {
            throw new Error('INVALID_BOOKING_SEGMENT');
        }
    } else {
        pickupRef = pickupWaypointId
            ? `waypoint:${pickupWaypointId}`
            : 'origin';
        dropRef = dropoffWaypointId
            ? `waypoint:${dropoffWaypointId}`
            : 'destination';
    }

    const points = buildSegmentPoints(ride);
    const riderView = resolveSegmentView(ride, points, pickupRef, dropRef);
    if (!riderView) {
        throw new Error('INVALID_BOOKING_SEGMENT');
    }
    assertExplicitMeetingPointsSelected(
        ride,
        riderView.bookingContext.pickupWaypointId,
        riderView.bookingContext.dropoffWaypointId
    );

    // Calculate price breakdown
    const feeTerms = await resolveRideFeeTerms(ride.id);
    const priceBreakdown = calculateBookingPrice({
        basePricePerSeat: riderView.basePricePerSeat,
        seatsBooked,
        luggageCount,
        currency: ride.currency,
        serviceFeePercent: feeTerms.serviceFeePercent,
        serviceFeeFlat: feeTerms.serviceFeeFlat,
    });

    // If it's a segment booking, provide segment details
    if (riderView.basePricePerSeat !== ride.basePricePerSeat) {
        segmentRide = {
            originAddress: riderView.originAddress,
            destinationAddress: riderView.destinationAddress,
            basePricePerSeat: riderView.basePricePerSeat,
        };
    }

    return {
        priceBreakdown,
        ride: {
            id: ride.id,
            originAddress: ride.originAddress,
            destinationAddress: ride.destinationAddress,
            basePricePerSeat: ride.basePricePerSeat,
            currency: ride.currency,
            availableSeats: ride.availableSeats,
        },
        segmentRide,
    };
};

/* ================= WITHDRAW BOOKING REQUEST ================= */
export const withdrawBooking = async (
    passengerId: string,
    bookingId: string,
    reason?: string
): Promise<{ bookingId: string; status: string; refundInitiated: boolean }> => {
    const booking = await prisma.rideBooking.findFirst({
        where: {
            id: bookingId,
            passengerId,
            status: { in: WITHDRAWABLE_BOOKING_STATUSES },
        },
        include: {
            ride: { select: { id: true, totalSeats: true, driverId: true } },
        },
    });

    if (!booking) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    const bypassPayment = isBypassBookingPaymentMode();
    let refundInitiated = false;

    const withdrawal = await prisma.$transaction(async (tx) => {
        // Guarded so two concurrent withdrawals cannot both release the seats.
        const cancelled = await tx.rideBooking.updateMany({
            where: { id: bookingId, status: { in: WITHDRAWABLE_BOOKING_STATUSES } },
            data: {
                status: BookingStatus.CANCELLED,
                cancelledAt: new Date(),
                cancelledByRole: 'PASSENGER',
                cancellationReason: reason ?? 'RIDER_WITHDRAWN',
                withdrawnAt: new Date(),
                withdrawnReason: reason ?? 'RIDER_WITHDRAWN',
                refundPercent: 100,
                refundAmount: booking.paymentAmount ?? booking.totalPrice,
            },
        });

        if (cancelled.count === 0) {
            return { cancelled: false };
        }

        await releaseBookingSeats(tx, {
            bookingId,
            rideId: booking.rideId,
            seatsBooked: booking.seatsBooked,
            pickupPosition: booking.pickupPosition,
            dropoffPosition: booking.dropoffPosition,
            totalSeats: booking.ride.totalSeats,
        });

        return { cancelled: true };
    });

    if (!withdrawal.cancelled) {
        throw new Error('BOOKING_NOT_FOUND');
    }

    // Refund after the transaction commits: a Stripe call inside an interactive
    // transaction can blow the transaction timeout and roll back a refund that
    // Stripe has already accepted.
    if (!bypassPayment && !booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        // Withdrawn before paying: nothing to refund, but the intent must not stay live.
        await releaseUnpaidPaymentIntent(bookingId, booking.stripePaymentIntentId);
    } else if (!bypassPayment && booking.paymentCapturedAt && booking.stripePaymentIntentId) {
        await refundPaymentIntent(
            booking.stripePaymentIntentId,
            toMinorCurrencyUnits(booking.paymentAmount ?? booking.totalPrice)
        );
        refundInitiated = true;
        await prisma.rideBooking.update({
            where: { id: bookingId },
            data: { refundedAt: new Date() },
        });
    } else if (bypassPayment) {
        refundInitiated = true;
    }

    if (refundInitiated) {
        try {
            await markBookingPaymentRefunded(
                bookingId,
                booking.ride.driverId,
                booking.paymentAmount ?? booking.totalPrice
            );
        } catch (error) {
            logError('Booking withdrawal refund succeeded, but local payment refund sync failed', error, {
                bookingId,
            });
        }
    }

    // Notify driver that rider withdrew
    await createNotification({
        userId: booking.ride.driverId,
        type: 'booking.rider.withdrawn',
        title: 'Booking request withdrawn',
        body: 'A rider has withdrawn their booking request.',
        data: {
            bookingId: booking.id,
            rideId: booking.rideId,
            deepLink: `app://driver/bookings`,
        },
    });

    return { bookingId, status: 'CANCELLED', refundInitiated };
};

/* ================= DRIVER RESPONSE METRICS ================= */
export const getDriverResponseMetrics = async (driverId: string) => {
    const bookings = await prisma.rideBooking.findMany({
        where: {
            ride: { driverId },
            driverDecisionDeadlineAt: { not: null },
        },
        select: {
            id: true,
            status: true,
            driverDecisionAt: true,
            driverDecisionDeadlineAt: true,
            autoCancelledAt: true,
            createdAt: true,
        },
    });

    const totalRequests = bookings.length;
    let accepted = 0;
    let rejected = 0;
    let expired = 0;
    let totalResponseTimeMs = 0;
    let respondedCount = 0;

    for (const b of bookings) {
        if (b.driverDecisionAt && b.status === BookingStatus.CONFIRMED) {
            accepted++;
            totalResponseTimeMs += b.driverDecisionAt.getTime() - b.createdAt.getTime();
            respondedCount++;
        } else if (b.driverDecisionAt && b.status === BookingStatus.CANCELLED) {
            rejected++;
            totalResponseTimeMs += b.driverDecisionAt.getTime() - b.createdAt.getTime();
            respondedCount++;
        } else if (b.autoCancelledAt) {
            expired++;
        }
    }

    return {
        driverId,
        totalRequests,
        accepted,
        rejected,
        expired,
        acceptRate: totalRequests > 0 ? Math.round((accepted / totalRequests) * 100) : 0,
        avgResponseTimeMs: respondedCount > 0 ? Math.round(totalResponseTimeMs / respondedCount) : null,
        avgResponseTimeMinutes: respondedCount > 0 ? Math.round(totalResponseTimeMs / respondedCount / 60000) : null,
    };
};
