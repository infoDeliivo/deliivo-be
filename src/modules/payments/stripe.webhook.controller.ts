// @ts-ignore — stripe v21 types bundled via package exports; not resolved by "Node" moduleResolution
import Stripe from 'stripe';
import { BookingStatus, Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { prisma } from '../../config/index.js';
import { createNotification } from '../notification/notification.service.js';
import { STRIPE_METADATA_KEYS } from './stripe.constants.js';
import { constructStripeEvent } from './stripe.service.js';
import { logInfo, logError, logWarn, logDebug } from '../../utils/logger.js';
import { applyStripePaymentSucceededToBooking } from '../ride-booking/ride-booking.service.js';

const getHeaderValue = (value: string | string[] | undefined): string | null => {
    if (!value) return null;
    return Array.isArray(value) ? value[0] : value;
};

const toMajorUnits = (amountMinor: number | null | undefined): number | null => {
    if (typeof amountMinor !== 'number') return null;
    return Number((amountMinor / 100).toFixed(2));
};

const applyPaymentIntentSucceeded = async (intent: Stripe.PaymentIntent) => {
    const applied = await applyStripePaymentSucceededToBooking(intent);
    if (!applied) {
        logWarn('No booking updated - booking may not be in PAYMENT_PENDING status');
    } else {
        logInfo('Booking updated to DRIVER_PENDING', {
            bookingId: intent.metadata?.[STRIPE_METADATA_KEYS.bookingId],
        });
    }
};

const applyPaymentIntentFailed = async (intent: Stripe.PaymentIntent) => {
    const bookingId = intent.metadata?.[STRIPE_METADATA_KEYS.bookingId];
    if (!bookingId) return;

    const failedBooking = await prisma.$transaction(async (tx) => {
        const booking = await tx.rideBooking.findUnique({
            where: { id: bookingId },
            select: {
                id: true,
                rideId: true,
                passengerId: true,
                seatsBooked: true,
                status: true,
                ride: {
                    select: {
                        id: true,
                        originAddress: true,
                        destinationAddress: true,
                        departureDate: true,
                        departureTime: true,
                    },
                },
            },
        });

        if (!booking || booking.status !== BookingStatus.PAYMENT_PENDING) {
            return null;
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

        return booking;
    });

    if (!failedBooking) return;

    await createNotification({
        userId: failedBooking.passengerId,
        type: 'booking.payment.failed',
        title: 'Payment failed',
        body: 'Payment could not be completed for your booking request.',
        data: {
            bookingId: failedBooking.id,
            rideId: failedBooking.ride.id,
            status: BookingStatus.PAYMENT_FAILED,
            originAddress: failedBooking.ride.originAddress,
            destinationAddress: failedBooking.ride.destinationAddress,
            departureDate: failedBooking.ride.departureDate.toISOString(),
            departureTime: failedBooking.ride.departureTime,
            deepLink: `app://booking/${failedBooking.id}`,
        },
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
    logDebug('Stripe webhook received');

    const signature = getHeaderValue(req.headers['stripe-signature']);
    if (!signature) {
        logWarn('Webhook missing stripe-signature header');
        return res.status(400).send('Missing stripe signature');
    }

    // Check if body is already parsed (wrong middleware order)
    if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        logError('Webhook body already parsed as JSON - check middleware order');
        return res.status(500).send('Server configuration error: body must be raw');
    }

    const rawPayload = Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(req.body ?? '', 'utf8');

    logDebug('Webhook payload received', { size: rawPayload.length });
    logDebug('Webhook signature present');

    let event: Stripe.Event;
    try {
        event = constructStripeEvent(rawPayload, signature);
        logInfo('Webhook signature verified', { eventType: event.type });
    } catch (error: any) {
        logError('Webhook signature verification failed', error);
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
