import Stripe from 'stripe';
import { BookingStatus, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import {
    DRIVER_DECISION_NOTIFICATION_TYPE,
    DRIVER_DECISION_WINDOW_MS,
    STRIPE_METADATA_KEYS,
} from './stripe.constants.js';
import { constructStripeEvent } from './stripe.service.js';

const getHeaderValue = (value: string | string[] | undefined): string | null => {
    if (!value) return null;
    return Array.isArray(value) ? value[0] : value;
};

const toMajorUnits = (amountMinor: number | null | undefined): number | null => {
    if (typeof amountMinor !== 'number') return null;
    return Number((amountMinor / 100).toFixed(2));
};

const resolveSegmentAddress = (
    defaultAddress: string,
    waypointId: string | null,
    waypoints: Array<{ id: string; address: string }>
): string => {
    if (!waypointId) return defaultAddress;
    return waypoints.find((waypoint) => waypoint.id === waypointId)?.address ?? defaultAddress;
};

const applyPaymentIntentSucceeded = async (intent: Stripe.PaymentIntent) => {
    const bookingId = intent.metadata?.[STRIPE_METADATA_KEYS.bookingId];
    if (!bookingId) return;

    const latestChargeId = typeof intent.latest_charge === 'string'
        ? intent.latest_charge
        : intent.latest_charge?.id ?? null;
    const capturedAmount = intent.amount_received > 0 ? intent.amount_received : intent.amount;
    const now = new Date();
    const decisionDeadlineAt = new Date(now.getTime() + DRIVER_DECISION_WINDOW_MS);

    const updateResult = await prisma.rideBooking.updateMany({
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
            driverDecisionDeadlineAt: decisionDeadlineAt,
        },
    });

    if (updateResult.count === 0) return;

    const booking = await prisma.rideBooking.findUnique({
        where: { id: bookingId },
        include: {
            passenger: {
                select: {
                    name: true,
                    avatarUrl: true,
                },
            },
            ride: {
                select: {
                    id: true,
                    driverId: true,
                    originAddress: true,
                    destinationAddress: true,
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

    if (!booking) return;

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

    await createNotification({
        userId: booking.ride.driverId,
        type: DRIVER_DECISION_NOTIFICATION_TYPE,
        title: 'New ride request',
        body: `${booking.passenger.name ?? 'Rider'} wants ${originAddress} to ${destinationAddress}`,
        data: {
            bookingId: booking.id,
            rideId: booking.ride.id,
            passengerName: booking.passenger.name ?? 'Rider',
            passengerAvatarUrl: booking.passenger.avatarUrl ?? '',
            originAddress,
            destinationAddress,
            seatsBooked: String(booking.seatsBooked),
            totalPrice: String(booking.totalPrice),
            currency: booking.paymentCurrency ?? booking.ride.currency,
            decisionDeadlineAt: booking.driverDecisionDeadlineAt?.toISOString() ?? '',
            deepLink: `app://driver/booking-request/${booking.id}`,
        },
    });
};

const applyPaymentIntentFailed = async (intent: Stripe.PaymentIntent) => {
    const bookingId = intent.metadata?.[STRIPE_METADATA_KEYS.bookingId];
    if (!bookingId) return;

    await prisma.$transaction(async (tx) => {
        const booking = await tx.rideBooking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                rideId: true,
                seatsBooked: true,
                status: true,
            },
        });

        if (!booking || booking.status !== BookingStatus.PAYMENT_PENDING) {
            return;
        }

        await tx.rideBooking.update({
            where: { id: bookingId },
            data: {
                status: BookingStatus.PAYMENT_FAILED,
            },
        });

        await tx.ride.update({
            where: { id: booking.rideId },
            data: {
                availableSeats: { increment: booking.seatsBooked },
            },
        });
    });
};

const applyChargeRefunded = async (charge: Stripe.Charge) => {
    const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;

    if (!paymentIntentId) return;

    const latestRefund = charge.refunds?.data?.[0];
    await prisma.rideBooking.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: {
            refundId: latestRefund?.id,
            refundAmount: toMajorUnits(charge.amount_refunded),
            refundedAt: charge.refunded ? new Date() : undefined,
        },
    });
};

const applyRefundUpdated = async (refund: Stripe.Refund) => {
    const paymentIntentId = typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;

    if (!paymentIntentId) return;

    await prisma.rideBooking.updateMany({
        where: { stripePaymentIntentId: paymentIntentId },
        data: {
            refundId: refund.id,
            refundAmount: toMajorUnits(refund.amount),
            refundedAt: refund.status === 'succeeded' ? new Date() : undefined,
        },
    });
};

const processStripeEvent = async (event: Stripe.Event) => {
    switch (event.type) {
        case 'payment_intent.succeeded': {
            await applyPaymentIntentSucceeded(event.data.object as Stripe.PaymentIntent);
            return;
        }
        case 'payment_intent.payment_failed': {
            await applyPaymentIntentFailed(event.data.object as Stripe.PaymentIntent);
            return;
        }
        case 'charge.refunded': {
            await applyChargeRefunded(event.data.object as Stripe.Charge);
            return;
        }
        case 'refund.created':
        case 'refund.updated': {
            await applyRefundUpdated(event.data.object as Stripe.Refund);
            return;
        }
        default:
            return;
    }
};

export const handleStripeWebhook = async (req: Request, res: Response) => {
    const signature = getHeaderValue(req.headers['stripe-signature']);
    if (!signature) {
        return res.status(400).send('Missing stripe signature');
    }

    const rawPayload = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? '');

    let event: Stripe.Event;
    try {
        event = constructStripeEvent(rawPayload, signature);
    } catch {
        return res.status(400).send('Invalid stripe signature');
    }

    const existing = await prisma.stripeWebhookEvent.findUnique({
        where: { stripeEventId: event.id },
    });
    if (existing) {
        return res.status(200).json({ received: true, duplicate: true });
    }

    try {
        await prisma.stripeWebhookEvent.create({
            data: {
                stripeEventId: event.id,
                eventType: event.type,
                paymentIntentId: (event.data.object as { id?: string }).id ?? null,
                payload: event as unknown as Prisma.InputJsonValue,
            },
        });
    } catch (error) {
        if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
        ) {
            return res.status(200).json({ received: true, duplicate: true });
        }
        throw error;
    }

    await processStripeEvent(event);
    return res.status(200).json({ received: true });
};
