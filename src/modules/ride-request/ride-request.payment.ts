import type { Prisma, RideBooking } from '@prisma/client';

type PaymentBooking = Pick<
  RideBooking,
  'id' | 'rideId' | 'passengerId' | 'totalPrice' | 'paymentCurrency' | 'stripePaymentIntentId'
>;

/** Repair interrupted checkout without overwriting an existing fee snapshot or paid status. */
export async function ensureRequestPayment(
  db: Pick<Prisma.TransactionClient, 'payment'>,
  booking: PaymentBooking,
) {
  if (!booking.stripePaymentIntentId) throw new Error('REQUEST_PAYMENT_NOT_INITIALIZED');
  if (!booking.paymentCurrency) throw new Error('REQUEST_PAYMENT_CURRENCY_MISSING');
  const feePercent = Number(process.env.PLATFORM_FEE_PERCENT || '0');
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100)
    throw new Error('INVALID_PLATFORM_FEE');
  const platformFeeAmount = Math.round(booking.totalPrice * feePercent) / 100;
  const currency = booking.paymentCurrency.toUpperCase();
  const payment = await db.payment.upsert({
    where: { bookingId: booking.id },
    create: {
      bookingId: booking.id,
      rideId: booking.rideId,
      riderId: booking.passengerId,
      amountTotal: booking.totalPrice,
      currency,
      fareAmount: booking.totalPrice - platformFeeAmount,
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
