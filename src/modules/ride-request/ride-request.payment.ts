import type { Prisma, RideBooking } from '@prisma/client';
import type { prisma } from '../../config/index.js';

type PaymentBooking = Pick<
  RideBooking,
  'id' | 'rideId' | 'passengerId' | 'totalPrice' | 'paymentCurrency' | 'stripePaymentIntentId'
> & Partial<Pick<RideBooking, 'serviceFeeAmount'>>;

/** Repair interrupted checkout without overwriting an existing fee snapshot or paid status. */
export async function ensureRequestPayment(
  db: Pick<Prisma.TransactionClient, 'payment'> | Pick<typeof prisma, 'payment'>,
  booking: PaymentBooking,
) {
  if (!booking.stripePaymentIntentId) throw new Error('REQUEST_PAYMENT_NOT_INITIALIZED');
  if (!booking.paymentCurrency) throw new Error('REQUEST_PAYMENT_CURRENCY_MISSING');
  const feePercent = Number(process.env.PLATFORM_FEE_PERCENT || '0');
  if (booking.serviceFeeAmount == null && (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100))
    throw new Error('INVALID_PLATFORM_FEE');
  // Preserve the checkout snapshot; the environment fallback is only for legacy bookings.
  const platformFeeAmount = booking.serviceFeeAmount ?? Math.round(booking.totalPrice * feePercent) / 100;
  if (!Number.isFinite(platformFeeAmount) || platformFeeAmount < 0 || platformFeeAmount > booking.totalPrice)
    throw new Error('INVALID_PLATFORM_FEE');
  const currency = booking.paymentCurrency.toUpperCase();
  const payment = await db.payment.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      rideId: booking.rideId,
      riderId: booking.passengerId,
      amountTotal: booking.totalPrice,
      currency,
      fareAmount: Math.round((booking.totalPrice - platformFeeAmount) * 100) / 100,
      platformFeeAmount,
      stripePaymentIntentId: booking.stripePaymentIntentId,
      status: 'PAYMENT_PENDING',
    },
    update: { bookingId: booking.id },
  });
  if (
    payment.rideId !== booking.rideId ||
    payment.riderId !== booking.passengerId ||
    payment.amountTotal !== booking.totalPrice ||
    payment.currency.toUpperCase() !== currency ||
    (payment.stripePaymentIntentId &&
      payment.stripePaymentIntentId !== booking.stripePaymentIntentId)
  ) {
    throw new Error('REQUEST_PAYMENT_RECORD_MISMATCH');
  }
  if (!payment.stripePaymentIntentId) {
    const linked = await db.payment.updateMany({
      where: { id: payment.id, stripePaymentIntentId: null },
      data: { stripePaymentIntentId: booking.stripePaymentIntentId },
    });
    if (!linked.count) throw new Error('REQUEST_PAYMENT_LINK_CHANGED');
  }
  return payment;
}
